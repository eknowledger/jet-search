import { Modal, Notice, type App } from "obsidian";
import type JetSearchPlugin from "../main";
import { refreshStats } from "../index-status";
import { collect } from "./collect";
import {
	buildReport,
	formatForGithub,
	formatReport,
	labelWidth,
	layout,
	NO_OPTIONS,
	type ReportOptions,
	type Snapshot,
} from "./report";

/** Put text on the clipboard; false when the platform will not let a plugin (then the text is selected for you). */
const copyText = async (text: string): Promise<boolean> => {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
};

/**
 * The support info on screen: exactly the text that a copy puts on the clipboard (labels coloured here,
 * plain in the copy), what the user may add to it, and an optional sentence on what happened. Nothing is
 * sent anywhere. It is read when the window opens and again when a tick box changes.
 */
export class SupportModal extends Modal {
	private opts: ReportOptions = { ...NO_OPTIONS };
	private snap: Snapshot;
	private pre!: HTMLElement;
	private what!: HTMLTextAreaElement;

	constructor(
		app: App,
		private readonly plugin: JetSearchPlugin,
	) {
		super(app);
		this.snap = collect(plugin);
	}

	onOpen(): void {
		this.modalEl.addClass("jet-support-modal");
		this.titleEl.setText("Support info");
		const body = this.contentEl;
		body.empty();
		const grid = body.createDiv({ cls: "jet-support-body" });
		this.pre = grid.createEl("pre", { cls: "jet-support-report", attr: { tabindex: "0" } });
		this.draw();
		// A running worker knows the index's size and age: ask, and draw again when it answers.
		if (this.plugin.client.running)
			void refreshStats(this.plugin).then(() => {
				if (!this.pre.isConnected) return;
				this.snap = collect(this.plugin, Date.now(), this.opts);
				this.draw();
			});

		const side = grid.createDiv({ cls: "jet-support-side" });
		side.createEl("h4", { text: "Add to the report" });
		side.createDiv({
			cls: "jet-support-hint",
			text: "Off by default. A ticked item appears in the text on the left.",
		});
		this.tick(side, "Scope names", "scopeNames");
		this.tick(side, "Names of enabled plugins", "pluginNames");
		this.tick(side, "Search text and note names (in the explanation)", "explainNames");
		side.createEl("h4", { cls: "jet-support-what-title", text: "What happened" });
		this.what = side.createEl("textarea", {
			cls: "jet-support-what",
			attr: { rows: "4", placeholder: "Optional: a sentence for the issue" },
		});

		const foot = body.createDiv({ cls: "jet-support-foot" });
		foot.createSpan({
			cls: "jet-support-note",
			text: "Nothing leaves this device. You paste it where you choose.",
		});
		const buttons = foot.createDiv({ cls: "jet-support-buttons" });
		buttons
			.createEl("button", { text: "Copy as plain text" })
			.addEventListener("click", () => void this.copy(false));
		buttons
			.createEl("button", { cls: "mod-cta", text: "Copy for GitHub" })
			.addEventListener("click", () => void this.copy(true));
	}

	private tick(parent: HTMLElement, label: string, key: keyof ReportOptions): void {
		const row = parent.createEl("label", { cls: "jet-support-tick" });
		const box = row.createEl("input", { attr: { type: "checkbox" } });
		row.createSpan({ text: label });
		box.addEventListener("change", () => {
			this.opts[key] = box.checked;
			this.snap = collect(this.plugin, Date.now(), this.opts);
			this.draw();
		});
	}

	/** The report in the window: its text is the same as `text(false)`, with the labels and warnings coloured. */
	private draw(): void {
		this.pre.empty();
		const sections = buildReport(this.snap);
		// A long line that wraps goes back under its text, not under the heading.
		this.pre.setCssProps({ "--jet-label": `${labelWidth(sections)}ch` });
		for (const r of layout(sections)) {
			const line = this.pre.createDiv({ cls: "jet-support-line" });
			if (r.first) line.createSpan({ cls: "jet-support-key", text: r.label });
			else line.appendText(r.label);
			if (r.warn) line.createSpan({ cls: "jet-support-warn", text: r.text });
			else line.appendText(r.text);
		}
	}

	/** What a copy puts on the clipboard. */
	text(github: boolean): string {
		return github ? formatForGithub(this.snap, this.what.value) : formatReport(this.snap);
	}

	async copy(github: boolean): Promise<void> {
		if (await copyText(this.text(github))) {
			new Notice("Support info copied");
			return;
		}
		// Selected, so Ctrl/Cmd+C finishes it.
		const range = activeDocument.createRange();
		range.selectNodeContents(this.pre);
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
		new Notice("Jet could not copy by itself. The text is selected: press Ctrl/Cmd+C.");
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
