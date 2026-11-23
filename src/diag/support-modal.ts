import { Modal, Notice, type App } from "obsidian";
import type JetSearchPlugin from "../main";
import { refreshStats } from "../index-status";
import { collect } from "./collect";
import { issueFacts, issueLink } from "./issue";
import { trace } from "./trace";
import { TraceBox } from "./trace-ui";
import {
	buildReport,
	formatForGithub,
	formatForIssue,
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
 * Open a web page in the browser. A link that is clicked is the one way every platform opens (and
 * Obsidian hands to the browser itself); window.open does nothing on desktop Obsidian.
 */
const openLink = (url: string): void => {
	const a = activeDocument.body.createEl("a", { attr: { href: url, target: "_blank", rel: "noopener" } });
	a.click();
	a.remove();
};

/**
 * The support info on screen: exactly the text that a copy puts on the clipboard (labels coloured here,
 * plain in the copy), what the user may add to it, and an optional sentence on what happened. Nothing is
 * sent anywhere. It is read when the window opens and again when a tick box changes.
 */
export class SupportModal extends Modal {
	private opts: ReportOptions = { ...NO_OPTIONS, traceTimeline: true };
	private snap: Snapshot;
	private pre!: HTMLElement;
	private what!: HTMLTextAreaElement;
	private traceBox: TraceBox | null = null;
	private offTrace: (() => void) | null = null;

	constructor(
		app: App,
		private readonly plugin: JetSearchPlugin,
		/** An explanation was just added: say so, and mark its lines. */
		private readonly added = false,
	) {
		super(app);
		this.snap = collect(plugin, Date.now(), this.opts);
	}

	onOpen(): void {
		this.modalEl.addClass("jet-support-modal");
		this.titleEl.setText("Report issue");
		const body = this.contentEl;
		body.empty();
		const card = body.createDiv({ cls: "jet-support-what-card" });
		card.createEl("h4", { text: "What happened" });
		this.what = card.createEl("textarea", {
			cls: "jet-support-what",
			attr: { rows: "3", placeholder: "Optional: a sentence for the issue" },
		});
		if (this.added)
			body.createDiv({
				cls: "jet-support-added",
				text: "Added: the explanation is in the report, marked below.",
			});
		const grid = body.createDiv({ cls: "jet-support-body" });
		this.pre = grid.createEl("pre", { cls: "jet-support-report", attr: { tabindex: "0" } });
		this.draw();
		if (this.added)
			window.requestAnimationFrame(() =>
				this.pre.querySelector(".is-added")?.scrollIntoView?.({ block: "nearest" }),
			);
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
		this.traceBox = new TraceBox(side, this.plugin, {
			get: () => this.opts.traceTimeline,
			set: (on) => {
				this.opts.traceTimeline = on;
				this.again();
			},
		});
		// A trace that starts or ends (by itself too) changes the box and the report.
		this.offTrace = trace.onChange(() => {
			if (!this.pre.isConnected) return;
			this.traceBox?.update();
			this.again();
		});

		const foot = body.createDiv({ cls: "jet-support-foot" });
		const buttons = foot.createDiv({ cls: "jet-support-buttons" });
		buttons.createEl("button", { text: "Copy" }).addEventListener("click", () => void this.copy());
		buttons
			.createEl("button", { cls: "mod-cta", text: "Open on GitHub" })
			.addEventListener("click", () => void this.reportOnGithub());
	}

	/** Read the report again and draw it. */
	private again(): void {
		this.snap = collect(this.plugin, Date.now(), this.opts);
		this.draw();
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
		// The label is a column of its own, so a long line that wraps goes back under its text, not under the heading.
		this.pre.setCssProps({ "--jet-label": `${labelWidth(sections)}ch` });
		for (const r of layout(sections)) {
			const line = this.pre.createDiv({
				cls: `jet-support-line${this.added && r.section === "Explain" ? " is-added" : ""}`,
			});
			line.createSpan({
				cls: r.first ? "jet-support-label jet-support-key" : "jet-support-label",
				text: r.label,
			});
			line.createSpan({ cls: r.warn ? "jet-support-text jet-support-warn" : "jet-support-text", text: r.text });
		}
	}

	/** What a copy puts on the clipboard. */
	text(): string {
		return formatReport(this.snap);
	}

	/**
	 * Open a new bug report on GitHub in the browser with the form filled in. Jet posts nothing: the person
	 * reads the page and presses Submit. A report too long for the link goes on the clipboard instead.
	 */
	async reportOnGithub(): Promise<void> {
		const { url, filled } = issueLink({
			...issueFacts(this.snap),
			what: this.what.value,
			support: formatForIssue(this.snap),
		});
		openLink(url);
		if (filled.support) {
			new Notice("GitHub is open with the report filled in. Press Submit when ready.");
			return;
		}
		// What is not in the link goes on the clipboard, for the person to paste into the form.
		const text = filled.what ? formatForGithub(this.snap, "") : formatForGithub(this.snap, this.what.value);
		if (await copyText(text)) {
			new Notice(
				"GitHub is open. The report is too long for the link, so it is copied: paste it into the Support info box.",
			);
			return;
		}
		this.selectReport(
			"Could not copy. The text is selected: press Ctrl/Cmd+C, then paste it into the Support info box on GitHub.",
		);
	}

	async copy(): Promise<void> {
		if (await copyText(this.text())) {
			new Notice("Report copied");
			return;
		}
		this.selectReport("Could not copy. The text is selected: press Ctrl/Cmd+C.");
	}

	/** Select the report in the window, so Ctrl/Cmd+C finishes a copy the platform would not allow. */
	private selectReport(message: string): void {
		// Selected, so Ctrl/Cmd+C finishes it.
		const range = activeDocument.createRange();
		range.selectNodeContents(this.pre);
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
		new Notice(message);
	}

	onClose(): void {
		// Asked to close twice (a second window opening, Jet unloading): the second finds nothing to undo.
		this.offTrace?.();
		this.offTrace = null;
		this.traceBox?.stop();
		this.traceBox = null;
		this.contentEl.empty();
	}
}
