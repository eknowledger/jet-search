import { Modal, Notice, type App } from "obsidian";
import type JetSearchPlugin from "../main";
import { collect } from "./collect";
import { formatForGithub, formatReport, type Snapshot } from "./report";

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
 * The support info on screen: exactly the text that a copy puts on the clipboard, and an optional sentence on
 * what happened. Nothing is sent anywhere. Read when the window opens; "Refresh" reads it again.
 */
export class SupportModal extends Modal {
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
		body.createDiv({
			cls: "jet-support-lead",
			text: "This is everything the copy contains. It names no notes, folders or scopes, and nothing leaves this device until you paste it.",
		});
		this.pre = body.createEl("pre", { cls: "jet-support-report", attr: { tabindex: "0" } });
		this.pre.setText(formatReport(this.snap));
		body.createEl("label", { cls: "jet-support-label", text: "What happened (optional)" });
		this.what = body.createEl("textarea", {
			cls: "jet-support-what",
			attr: { rows: "3", placeholder: "A sentence for the issue: what you did and what you expected" },
		});
		const buttons = body.createDiv({ cls: "modal-button-container" });
		buttons.createEl("button", { text: "Refresh" }).addEventListener("click", () => this.refresh());
		buttons
			.createEl("button", { text: "Copy as plain text" })
			.addEventListener("click", () => void this.copy(false));
		buttons
			.createEl("button", { cls: "mod-cta", text: "Copy for GitHub" })
			.addEventListener("click", () => void this.copy(true));
	}

	/** Read the state again (after something was tried while this window was open). */
	refresh(): void {
		this.snap = collect(this.plugin);
		this.pre.setText(formatReport(this.snap));
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
