/**
 * The settings for search by meaning (general examples, not a real vault's). Off by default; turning it on asks first
 * (the model's source, size and checksum), then downloads it or takes the two files you have.
 */
import { type App, Modal, Notice, Platform, setIcon } from "obsidian";
import { fileUrl } from "../meaning/install";
import { MODEL } from "../meaning/model";
import type { Meaning } from "../meaning/control";

export const MEANING_WHAT =
	"Finds notes about what you ask, even when they use other words. “How do we ship a release?” finds a note " +
	"titled “Deployment checklist”; “what did we decide about pricing” finds the meeting where it was settled; " +
	"“recipes without dairy” finds “Vegan dinners”. Word searches like “deployment checklist” are unchanged. " +
	"Off: nothing is downloaded and Jet works exactly as before.";

/** What "A question shows" does; `key` is the switch's key as you set it (⌘J). */
export const questionsText = (key: string): string =>
	"A question starts with how, why, what, when, where, who, which, can, should, does, is… or ends with “?” " +
	"(“why did the build fail on Monday”). Both: by words and by meaning at once. By meaning: only meaning. " +
	"By words: as any other search. A search that is not a question stays words. " +
	`${key} moves this search to words, meaning or both.`;

export const MEANING_LONG =
	"Searches of 6 words or more, even without a question word (for example a sentence pasted from a note), " +
	"are searched by meaning too. A quoted phrase or a filter keeps it a word search. Off by default.";

/** The confirm before anything is fetched. Resolves true once installed. */
export class MeaningConfirm extends Modal {
	private done = false;

	constructor(
		app: App,
		private readonly meaning: Meaning,
		private readonly notes: number,
		private readonly closed: (installed: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("Download the model?");
		// A two-column table, buttons with icons on one line.
		this.modalEl.addClass("jet-mconfirm-modal");
		const c = this.contentEl;
		c.addClass("jet-mconfirm");
		c.createEl("p", {
			text:
				"Search by meaning needs a small language model. Jet downloads it once, checks it, and keeps it in its " +
				"folder. Nothing else goes over the network, and nothing is sent: your notes stay on this device.",
		});
		const t = c.createEl("table");
		const row = (k: string, v: string, code = false): void => {
			const r = t.createEl("tr");
			r.createEl("td", { text: k });
			const d = r.createEl("td");
			if (code) d.createEl("code", { text: v });
			else d.setText(v);
		};
		row("Model", `${MODEL.id} (Model2Vec, static, ${MODEL.licence})`);
		row(
			"Download",
			`~${MODEL.downloadMB} MB, once · kept as about 8 MB` +
				(Platform.isMobile ? ". Use Wi-Fi: it counts against mobile data." : ""),
		);
		row("From", `huggingface.co/${MODEL.repo}`, true);
		row("Checked against", "its SHA-256, pinned in Jet's code");
		row("Then", `${this.notes.toLocaleString()} notes given their meaning in a few seconds`);
		const status = c.createEl("p", { cls: "jet-mstatus" });
		const btns = c.createDiv({ cls: "jet-mbtns" });
		const button = (text: string, icon: string | null, cta = false): HTMLButtonElement => {
			const b = btns.createEl("button", { cls: cta ? "mod-cta" : "" });
			if (icon) setIcon(b.createSpan({ cls: "jet-mbi" }), icon);
			b.createSpan({ text });
			return b;
		};
		const cancel = button("Cancel", null);
		const files = button("Use files…", "file");
		const go = button("Download", "download", true);
		// Never shown: "Use files…" opens it.
		const picker = c.createEl("input", {
			cls: "jet-mpicker",
			attr: { type: "file", multiple: "", accept: ".safetensors,.json" },
		});
		const lock = (on: boolean): void => {
			for (const b of [cancel, files, go]) b.disabled = on;
		};
		const run = (task: () => Promise<void>): Promise<void> =>
			(this.task = (async () => {
				lock(true);
				const tick = window.setInterval(() => status.setText(this.meaning.busy ?? ""), 200);
				try {
					await task();
					this.done = true;
					if (!this.shut) this.close();
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e);
					// Closed meanwhile (Esc): the message would land in a dialog nobody sees.
					if (this.shut) new Notice(`Search by meaning was not installed: ${message}`);
					status.setText(message);
					lock(false);
				} finally {
					window.clearInterval(tick);
					this.task = null;
				}
			})());
		cancel.addEventListener("click", () => this.close());
		go.addEventListener("click", () => void run(() => this.meaning.install()));
		files.addEventListener("click", () => picker.click());
		picker.addEventListener("change", () => {
			const list = [...(picker.files ?? [])];
			const named = (n: string): File | undefined => list.find((f) => f.name === n);
			const st = named("model.safetensors");
			const tok = named("tokenizer.json");
			if (!st || !tok) {
				status.setText(`Pick both files from ${fileUrl("")}: model.safetensors and tokenizer.json.`);
				return;
			}
			void run(async () =>
				this.meaning.install({
					"model.safetensors": await st.arrayBuffer(),
					"tokenizer.json": await tok.arrayBuffer(),
				}),
			);
		});
	}

	/** The download or install under way, if any. */
	private task: Promise<void> | null = null;
	private shut = false;

	onClose(): void {
		this.contentEl.empty();
		this.shut = true;
		// Closed (Esc, ✕) while it downloads: the outcome is told once it is known.
		const t = this.task;
		if (t) void t.then(() => this.closed(this.done));
		else this.closed(this.done);
	}
}
