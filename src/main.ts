import { debounce, MarkdownView, Plugin, TFile } from "obsidian";
import { BUILD_ID } from "./build-id";
import { type JetData, movePath, normalizeData, recordOpen } from "./data";
import { JetHost } from "./host";
import { Feeder } from "./index/feeder";
import { indexStatus, rebuild } from "./index-status";
import { addCommandAs, hasCommand, removeCommand, shiftOwnedElsewhere, vaultId } from "./internals";
import { InNoteHost } from "./innote";
import { JetModal } from "./modal/jet-modal";
import { ScopeKeeper } from "./scopes/keeper";
import { obsidianSnapshot } from "./scopes/snapshot-obsidian";
import { ScopeWatcher } from "./scopes/watcher";
import { Search } from "./search";
import { JetSettingTab } from "./settings-tab";
import { DoubleTap } from "./shift";
import { JetClient } from "./worker/jet-client";

/** The first build starts this long after the layout is ready, the first time (within 5 s). */
const FIRST_BUILD_DELAY_MS = 3000;
/** The worker stops after this long without a search; the next search reloads it. */
const SLEEP_AFTER_MS = 10 * 60_000;

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
	readonly client = new JetClient();
	feeder!: Feeder;
	search!: Search;
	scopes!: ScopeKeeper;
	/** "When new ones appear": generates again when idle after structural changes. */
	watcher!: ScopeWatcher;
	/** A note's frontmatter and tags as last seen, so only real changes wake the watcher. */
	private readonly shapes = new Map<string, string>();
	/** Obsidian keeps the tab's definitions from its last update(): call it when settings change elsewhere. */
	settingTab!: JetSettingTab;
	private sleepTimer: number | null = null;
	private readonly standIns: string[] = [];
	readonly save = debounce(() => void this.saveData(this.data), 1000, true);

	async onload(): Promise<void> {
		this.data = normalizeData(await this.loadData());
		this.feeder = new Feeder(
			this.app,
			this.client,
			vaultId(this.app),
			() => this.data.settings.exclude,
			() => this.data.settings.stemming,
		);
		this.search = new Search(this.app, this.client, this.feeder, () => this.data);
		this.scopes = new ScopeKeeper(this.app, this.client, () => this.data.scopes);
		this.watcher = new ScopeWatcher({
			mode: () => this.data.settings.scopesWhenNew,
			scopes: () => this.data.scopes,
			setScopes: (scopes) => {
				this.data.scopes = scopes;
				this.scopes.reset();
			},
			save: () => this.save(),
			snapshot: () => obsidianSnapshot(this.app, this.data.settings.exclude),
			noticed: () => this.settingTab.refresh(),
			timers: { set: (fn, ms) => window.setTimeout(fn, ms), clear: (h) => window.clearTimeout(h as number) },
			now: () => Date.now(),
		});
		this.feeder.onReady = () => {
			// The worker (re)opened: it has no scope sets yet.
			this.scopes.resend();
			if (this.data.indexedAt === null) {
				this.data.indexedAt = Date.now();
				this.save();
			}
		};
		this.client.onCrash = () => this.feeder.reset();
		this.feeder.onChanged = () => this.search.refresh();
		this.host = new JetHost(
			this.app,
			() => this.data,
			() => this.save(),
			() => this.data.settings.newTab,
			() => {
				this.wake();
				return this.search;
			},
			{ status: () => indexStatus(this), rebuild: () => rebuild(this) },
		);
		this.addCommand({ id: "open", name: "Search notes", callback: () => this.open() });
		this.addCommand({ id: "open-in-note", name: "Search in this note", callback: () => this.openInNote() });
		this.settingTab = new JetSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.app.workspace.onLayoutReady(() => this.listen());
	}

	onunload(): void {
		for (const id of this.standIns) removeCommand(this.app, id);
		this.modal?.close();
		this.feeder.stop();
		this.watcher.stop();
		if (this.sleepTimer !== null) window.clearTimeout(this.sleepTimer);
		this.client.stop();
	}

	/** A search is coming: keep the worker awake, and let it sleep after a quiet while. */
	private wake(): void {
		if (this.sleepTimer !== null) window.clearTimeout(this.sleepTimer);
		this.sleepTimer = window.setTimeout(() => {
			this.sleepTimer = null;
			if (!this.client.running) return;
			void this.client
				.call({ op: "save" })
				.catch(() => {})
				.finally(() => {
					this.client.stop();
					this.feeder.reset();
				});
		}, SLEEP_AFTER_MS);
	}

	/** Open Jet (from the command, Shift-Shift or a stand-in id); a short selection in the editor prefills it. */
	open(text = this.selection()): void {
		this.modal?.close();
		const modal = new JetModal(this.app, this.host, text);
		this.modal = modal;
		modal.open();
		// Scope members, one tick after the modal is painted (a few ms, once a session).
		if (this.data.scopes.length) window.setTimeout(() => this.scopes.ensure(), 0);
	}

	/** Search in the open note; without a note, the vault search. */
	openInNote(text = this.selection()): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view?.file) {
			this.open(text);
			return;
		}
		this.modal?.close();
		const modal = new JetModal(this.app, new InNoteHost(this.app, view.file, view), text);
		this.modal = modal;
		modal.open();
	}

	private selection(): string {
		const sel = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor.getSelection() ?? "";
		return sel.length <= 100 && !sel.includes("\n") ? sel.trim() : "";
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
		if (!hasCommand(this.app, STAND_INS.inNote))
			if (
				addCommandAs(this.app, {
					id: STAND_INS.inNote,
					name: "Jet Search: Search in this note",
					callback: () => this.openInNote(),
				})
			)
				this.standIns.push(STAND_INS.inNote);
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
		// The index follows the vault: names in the same frame, text within 100 ms, the
		// note being typed in 300 ms after typing pauses.
		const vault = this.app.vault;
		this.registerEvent(
			vault.on("create", (f) => {
				if (f instanceof TFile) this.search.nameChanged(f);
				this.feeder.touch(f, "upsert");
				this.watcher.changed();
			}),
		);
		this.registerEvent(vault.on("modify", (f) => this.feeder.touch(f, "upsert")));
		this.registerEvent(
			vault.on("rename", (f, old) => {
				movePath(this.data, old, f.path);
				this.save();
				if (f instanceof TFile) {
					this.search.nameRenamed(f, old);
					this.scopes.renamed(f, old);
				}
				this.feeder.rename(f, old);
				this.watcher.changed();
			}),
		);
		this.registerEvent(
			vault.on("delete", (f) => {
				movePath(this.data, f.path, null);
				this.save();
				this.search.nameDeleted(f.path);
				this.scopes.deleted(f.path);
				this.feeder.touch(f, "delete");
				this.shapes.delete(f.path);
				this.watcher.changed();
			}),
		);
		this.registerEvent(
			this.app.metadataCache.on("changed", (f) => {
				this.search.nameChanged(f);
				this.scopes.changed(f);
				this.feeder.touch(f, "upsert");
				// Only a change to frontmatter or tags can make a new scope (typing text does not).
				const cache = this.app.metadataCache.getFileCache(f);
				const shape = JSON.stringify([cache?.frontmatter ?? null, (cache?.tags ?? []).map((t) => t.tag)]);
				if (this.shapes.get(f.path) !== shape) {
					const seen = this.shapes.has(f.path);
					this.shapes.set(f.path, shape);
					if (seen) this.watcher.changed();
				}
			}),
		);
		this.registerEvent(this.app.workspace.on("editor-change", () => this.feeder.typing()));
		// The first time Jet is enabled the index is built without waiting for a search.
		if (this.data.indexedAt === null)
			window.setTimeout(() => {
				if (this.data.indexedAt !== null) return;
				this.wake();
				void this.feeder.ensure().catch((e: unknown) => console.error("Jet Search: the first build failed", e));
			}, FIRST_BUILD_DELAY_MS);
	}
}
