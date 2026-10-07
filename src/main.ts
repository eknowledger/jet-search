import { debounce, Plugin, TFile } from "obsidian";
import { BUILD_ID } from "./build-id";
import { type JetData, movePath, normalizeData, recordOpen } from "./data";
import { JetHost } from "./host";
import { addCommandAs, hasCommand, removeCommand, shiftOwnedElsewhere } from "./internals";
import { JetModal } from "./modal/jet-modal";
import { JetSettingTab } from "./settings-tab";
import { DoubleTap } from "./shift";

/** Omnisearch's command ids, which Jet answers while Omnisearch is off. */
const STAND_INS = { open: "omnisearch:show-modal", inNote: "omnisearch:show-modal-infile" } as const;

/**
 * Jet Search: the plugin entry point. Obsidian start pays only for what onload registers:
 * the commands and the settings tab. Listening starts when the layout is
 * ready; the index and the worker wait for the first search.
 */
export default class JetSearchPlugin extends Plugin {
	readonly buildId = BUILD_ID;
	data!: JetData;
	private host!: JetHost;
	private modal: JetModal | null = null;
	private readonly standIns: string[] = [];
	readonly save = debounce(() => void this.saveData(this.data), 1000, true);

	async onload(): Promise<void> {
		this.data = normalizeData(await this.loadData());
		this.host = new JetHost(
			this.app,
			() => this.data,
			() => this.save(),
			() => this.data.settings.newTab,
		);
		this.addCommand({ id: "open", name: "Search notes", callback: () => this.open() });
		this.addSettingTab(new JetSettingTab(this.app, this));
		this.app.workspace.onLayoutReady(() => this.listen());
	}

	onunload(): void {
		for (const id of this.standIns) removeCommand(this.app, id);
		this.modal?.close();
	}

	/** Open Jet (from the command, Shift-Shift or a stand-in id). */
	open(text = ""): void {
		this.modal?.close();
		const modal = new JetModal(this.app, this.host, text);
		this.modal = modal;
		modal.open();
	}

	private listen(): void {
		// Stand-ins for Omnisearch's ids, so its hotkeys and double-Shift bindings open Jet.
		if (!hasCommand(this.app, STAND_INS.open))
			if (
				addCommandAs(this.app, {
					id: STAND_INS.open,
					name: "Jet Search: Search notes",
					callback: () => this.open(),
				})
			)
				this.standIns.push(STAND_INS.open);
		// Shift-Shift, unless another plugin already owns double Shift.
		const tap = new DoubleTap(() => this.data.settings.shiftInterval);
		const watch = (doc: Document): void => {
			this.registerDomEvent(doc, "keydown", (e) => tap.keydown(e.key, e.repeat, e.timeStamp), { capture: true });
			this.registerDomEvent(
				doc,
				"keyup",
				(e) => {
					if (!tap.keyup(e.key, e.timeStamp)) return;
					if (this.data.settings.doubleShift && !shiftOwnedElsewhere(this.app)) this.open();
				},
				{ capture: true },
			);
			this.registerDomEvent(doc.defaultView ?? window, "blur", () => tap.reset());
		};
		watch(document);
		this.registerEvent(this.app.workspace.on("window-open", (w) => watch(w.doc)));
		// Recents and frecency: every note opened, however it was opened.
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				recordOpen(this.data, file.path, Date.now());
				this.save();
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (f, old) => {
				movePath(this.data, old, f.path);
				this.save();
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (f) => {
				movePath(this.data, f.path, null);
				this.save();
			}),
		);
	}
}
