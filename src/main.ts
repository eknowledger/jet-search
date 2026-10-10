import { type Command, debounce, MarkdownView, Plugin, TFile } from "obsidian";
import { BUILD_ID } from "./build-id";
import { type JetData, movePath, normalizeData, recordOpen } from "./data";
import { JetHost } from "./host";
import { JadeLink } from "./jade-link";
import { withModes } from "./scopes/model";
import { Meaning } from "./meaning/control";
import { importJadeSearch } from "./migrate";
import { Cancelled, Feeder } from "./index/feeder";
import { indexStatus, rebuild } from "./index-status";
import {
	addCommandAs,
	commandAt,
	hasCommand,
	openSettingsAt,
	plugin,
	removeCommand,
	shiftOwnedElsewhere,
	vaultId,
} from "./internals";
import { InNoteHost } from "./innote";
import { JetModal } from "./modal/jet-modal";
import { FilterSets } from "./filters/sets";
import { ambiguity } from "./scopes/auto";
import { coreQuery, createDetail, createTarget } from "./scopes/create";
import { noteFacts } from "./scopes/facts";
import { ScopeKeeper } from "./scopes/keeper";
import { matches } from "./scopes/members";
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
	/** Search by meaning. */
	meaning!: Meaning;
	scopes!: ScopeKeeper;
	/** The notes each filter keeps, from the metadata cache. */
	readonly filterSets = new FilterSets(this.app);
	/** "When new ones appear": generates again when idle after structural changes. */
	watcher!: ScopeWatcher;
	/** A note's frontmatter and tags as last seen, so only real changes wake the watcher. */
	private readonly shapes = new Map<string, string>();
	/** Obsidian keeps the tab's definitions from its last update(): call it when settings change elsewhere. */
	settingTab!: JetSettingTab;
	private sleepTimer: number | null = null;
	/** Jade, when it is there. */
	jade: JadeLink | null = null;
	/** Each scope's ambiguity, measured on demand; forgotten when scopes change. */
	private readonly ambiguities = new Map<string, { name: string; value: number; outside: number }>();
	private readonly measuring = new Set<string>();
	/** The Omnisearch ids Jet stands in for now, with the command it put there. */
	private readonly standIns = new Map<string, Command>();
	/** Set first thing at unload; `built` once onload has made everything onunload stops. */
	private unloaded = false;
	private built = false;
	readonly save = debounce(() => void this.saveData(this.data), 1000, true);

	async onload(): Promise<void> {
		const raw: unknown = await this.loadData();
		// Turned off while its data was read: nothing is made.
		if (this.unloaded) return;
		this.data = normalizeData(raw);
		// The first run: Jade's search settings, once. A file read only then.
		if (this.data.indexedAt === null && !this.data.imported.includes("jade-search")) {
			const jade = await this.readJadeData();
			if (this.unloaded) return;
			if (importJadeSearch(this.data, jade)) this.save();
		}
		this.feeder = new Feeder(
			this.app,
			this.client,
			vaultId(this.app),
			() => this.data.settings.exclude,
			() => this.data.settings.stemming,
		);
		this.scopes = new ScopeKeeper(this.app, this.client, () => this.data.scopes);
		this.search = new Search(
			this.app,
			this.client,
			this.feeder,
			() => this.data,
			{
				ensure: () => this.scopes.ensure(),
				membersOf: (id) => this.scopes.membersOf(id),
				describe: (id) => {
					const s = this.data.scopes.find((x) => x.id === id);
					return s
						? { name: s.name, create: createDetail(createTarget(s)), query: coreQuery(s) ?? undefined }
						: null;
				},
				via: (id, path) => {
					const s = this.data.scopes.find((x) => x.id === id);
					const file = this.app.vault.getFileByPath(path);
					if (!s || !file) return null;
					const facts = noteFacts(this.app, file);
					if (s.rules.some((r) => r.kind === "folder" && matches(r, facts))) return null;
					const r = s.rules.find((x) => matches(x, facts));
					return !r
						? null
						: r.kind === "tag"
							? `via ${r.tag}`
							: r.kind === "property"
								? `via ${r.key}`
								: null;
				},
			},
			this.filterSets,
		);
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
			{
				all: () => withModes(this.data.scopes, this.data.settings.scopeMode),
				ensure: () => this.scopes.ensure(),
				count: (id) => this.scopes.count(id),
				membersOf: (id) => this.scopes.membersOf(id),
				ruleCount: (r) => this.scopes.ruleCount(r),
				edit: (id) => {
					const s = this.data.scopes.find((x) => x.id === id);
					if (s) openSettingsAt(this.app, this.manifest.id, ["Scopes", s.name]);
				},
				ambiguity: (id) => this.ambiguityOf(id),
				measure: (id) => void this.measure(id),
			},
			this.filterSets,
		);
		this.host.inNote = () => this.openInNote("");
		this.meaning = new Meaning(
			this.app,
			this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`,
			() => this.data,
			async () => {
				this.save.cancel();
				await this.saveData(this.data);
			},
			this.feeder,
		);
		this.host.meaning = {
			available: () => this.meaning.available(),
			questions: () => this.data.settings.meaningQuestions,
			long: () => this.data.settings.meaningLong,
		};
		this.host.manageScopes = () => {
			this.modal?.close();
			openSettingsAt(this.app, this.manifest.id, ["Scopes"]);
		};
		this.addCommand({ id: "open", name: "Search notes", callback: () => this.open() });
		this.addCommand({ id: "open-in-note", name: "Search in this note", callback: () => this.openInNote() });
		this.settingTab = new JetSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		// Search by meaning's progress in its settings, while they are on screen (at most twice a second).
		let last = 0;
		let later: number | null = null;
		const show = (): void => {
			if (!this.settingTab.containerEl.isConnected) return;
			const wait = 500 - (Date.now() - last);
			if (wait > 0) {
				later ??= window.setTimeout(() => {
					later = null;
					show();
				}, wait);
				return;
			}
			last = Date.now();
			this.settingTab.refresh();
		};
		this.meaning.onChange = show;
		this.feeder.onMeaningProgress = show;
		this.register(() => later !== null && window.clearTimeout(later));
		this.built = true;
		// Jade's search module steps aside while Jet is on, and comes back when it goes.
		// Said before listen(): Jade frees the Omnisearch ids on its next tick, then Jet takes them.
		this.app.workspace.trigger("jet-search:on");
		this.app.workspace.onLayoutReady(() => this.listen());
	}

	/** Jade's saved data, or null (not installed, unreadable). */
	private async readJadeData(): Promise<unknown> {
		const path = `${this.app.vault.configDir}/plugins/jade/data.json`;
		try {
			if (!(await this.app.vault.adapter.exists(path))) return null;
			return JSON.parse(await this.app.vault.adapter.read(path)) as unknown;
		} catch {
			return null;
		}
	}

	onunload(): void {
		this.unloaded = true;
		this.app.workspace.trigger("jet-search:off");
		if (!this.built) return;
		// A change still waiting is written now, not a second later from a plugin that is gone.
		this.save.run();
		// Only the ids that still hold Jet's command: Omnisearch, turned on since, keeps its own.
		for (const [id, cmd] of this.standIns) if (commandAt(this.app, id) === cmd) removeCommand(this.app, id);
		this.standIns.clear();
		this.modal?.close();
		this.feeder.stop();
		this.watcher.stop();
		this.jade?.stop();
		if (this.sleepTimer !== null) window.clearTimeout(this.sleepTimer);
		this.client.stop();
	}

	/** A search is coming: keep the worker awake, and let it sleep after a quiet while. */
	wake(): void {
		if (this.sleepTimer !== null) window.clearTimeout(this.sleepTimer);
		this.sleepTimer = window.setTimeout(() => {
			this.sleepTimer = null;
			if (!this.client.running) return;
			// A first build, a Rebuild or a catch-up still running is not stopped: wait for it.
			if (this.feeder.busy) {
				this.wake();
				return;
			}
			void this.client
				.call({ op: "save" })
				.catch(() => {})
				.finally(() => {
					// A search came while it saved: it woke Jet again, so the worker stays.
					if (this.sleepTimer !== null || this.unloaded) return;
					this.client.stop();
					this.feeder.reset();
				});
		}, SLEEP_AFTER_MS);
	}

	/** A scope's ambiguity, or null before it is measured (or after its name changed). */
	ambiguityOf(id: string): number | null {
		return this.mentionsOf(id)?.value ?? null;
	}

	/** Its ambiguity and how many notes outside it mention its name (the scope's settings page). */
	mentionsOf(id: string): { value: number; outside: number } | null {
		const s = this.data.scopes.find((x) => x.id === id);
		const a = this.ambiguities.get(id);
		return s && a && a.name === s.name ? a : null;
	}

	/** Count the name's mentions with the worker (it loads the index if asleep); the settings redraw. */
	async measure(id: string): Promise<void> {
		const s = this.data.scopes.find((x) => x.id === id);
		if (!s || this.measuring.has(id)) return;
		this.measuring.add(id);
		try {
			this.wake();
			await this.feeder.ensure();
			this.scopes.ensure();
			const m = await this.client.call({ op: "mentions", text: s.name, scope: id });
			this.ambiguities.set(id, {
				name: s.name,
				value: ambiguity(m, this.scopes.count(id)),
				outside: m.notes - m.inside,
			});
		} catch (e) {
			console.error("Jet Search: counting mentions failed", e);
		} finally {
			this.measuring.delete(id);
			// One redraw once every scope asked for is measured, not one per scope.
			if (!this.measuring.size) this.settingTab.refresh();
		}
	}

	/** Open Jet (from the command, Shift-Shift or a stand-in id); a short selection in the editor prefills it. */
	open(text = this.selection()): void {
		// Open already with a scope: the same keys widen the search instead.
		// With nothing to widen, the search you typed stays.
		if (this.modal?.shown && (this.modal.widen() || this.modal.inputEl.value.trim())) return;
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
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return "";
		// Reading view: what is selected on screen, not the hidden editor's last selection.
		let sel = "";
		if (view.getMode() === "preview") {
			const s = view.containerEl.ownerDocument.getSelection();
			const node = s?.anchorNode ?? null;
			if (s && node && view.containerEl.contains(node)) sel = s.toString();
		} else sel = view.editor.getSelection();
		// A triple-clicked line ends with its line break: trimmed first, it is one line.
		sel = sel.trim();
		return sel.length <= 100 && !sel.includes("\n") ? sel : "";
	}

	private listen(): void {
		// The layout got ready after Jet was turned off (Obsidian's startup queue): nothing to do.
		if (this.unloaded) return;
		// Stand-ins for Omnisearch's ids, so its hotkeys and double-Shift bindings open Jet.
		// A tick later: Jet turned on while Jade's search runs, Jade frees the ids first (they are its stand-ins too).
		// Checked again on layout changes: Omnisearch turned off after Jet started frees them.
		const standIns = window.setTimeout(() => this.standIn(), 0);
		this.register(() => window.clearTimeout(standIns));
		// Shift-Shift, unless another plugin already owns double Shift.
		const tap = new DoubleTap(() => this.data.settings.shiftInterval);
		const watched = new Map<Document, () => void>();
		const watch = (doc: Document): void => {
			if (watched.has(doc)) return;
			const win: EventTarget = doc.defaultView ?? window;
			const down = (e: KeyboardEvent): void => tap.keydown(e.key, e.repeat, e.timeStamp);
			const up = (e: KeyboardEvent): void => {
				if (!tap.keyup(e.key, e.timeStamp)) return;
				// One owner: Jade says whether it owns a double Shift; else its settings are read.
				if (!this.data.settings.doubleShift) return;
				if (this.jade?.ownsShift() ?? shiftOwnedElsewhere(this.app)) return;
				this.open();
			};
			// A mouse press between taps is a Shift-click (selecting a range), not a double tap.
			const press = (): void => tap.cancel();
			const blur = (): void => tap.reset();
			doc.addEventListener("keydown", down, { capture: true });
			doc.addEventListener("keyup", up, { capture: true });
			doc.addEventListener("mousedown", press, { capture: true });
			win.addEventListener("blur", blur);
			watched.set(doc, () => {
				doc.removeEventListener("keydown", down, { capture: true });
				doc.removeEventListener("keyup", up, { capture: true });
				doc.removeEventListener("mousedown", press, { capture: true });
				win.removeEventListener("blur", blur);
			});
		};
		this.register(() => {
			for (const off of watched.values()) off();
			watched.clear();
		});
		// Every window with a leaf is watched: popouts already open when Jet starts too,
		// and a closed one is let go of at once. One layout-change listener does it all,
		// and checks Omnisearch's ids again, within the start budget of 9 listeners.
		const windows = (): void => {
			const docs = new Set<Document>([document]);
			this.app.workspace.iterateAllLeaves?.((leaf) => {
				const doc = (leaf as { getContainer?: () => { doc?: Document } }).getContainer?.().doc;
				if (doc) docs.add(doc);
			});
			for (const d of docs) watch(d);
			for (const [d, off] of watched)
				if (!docs.has(d)) {
					off();
					watched.delete(d);
				}
		};
		windows();
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				windows();
				this.standIn();
			}),
		);
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
				this.filterSets.invalidate();
				if (f instanceof TFile) this.search.nameChanged(f);
				this.feeder.touch(f, "upsert");
				this.watcher.changed();
			}),
		);
		this.registerEvent(vault.on("modify", (f) => this.feeder.touch(f, "upsert")));
		this.registerEvent(
			vault.on("rename", (f, old) => {
				this.filterSets.invalidate();
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
				this.filterSets.invalidate();
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
				this.filterSets.invalidate();
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
		// The timer goes with the plugin: turned off within the delay, nothing is built.
		if (this.data.indexedAt === null) {
			const first = window.setTimeout(() => {
				if (this.unloaded || this.data.indexedAt !== null) return;
				this.wake();
				void this.feeder.ensure().catch((e: unknown) => {
					if (!(e instanceof Cancelled)) console.error("Jet Search: the first build failed", e);
				});
			}, FIRST_BUILD_DELAY_MS);
			this.register(() => window.clearTimeout(first));
		}
		// Jade's partner API: its J panel and floating bar, whichever loads first.
		this.jade = new JadeLink(this.app, this, {
			open: (text) => this.open(text),
			status: () => {
				const p = this.feeder.progress;
				if (p) return `Indexing ${p.done} of ${p.total}…`;
				return this.data.indexedAt === null ? "Not built yet" : "Ready · it follows your edits";
			},
			rebuild: () => void rebuild(this),
			excerpts: {
				get: () => this.data.settings.excerpts,
				set: (v) => {
					this.data.settings.excerpts = v;
					this.save();
				},
			},
			persist: {
				get: () => this.data.settings.persistFilters,
				set: (v) => {
					this.data.settings.persistFilters = v;
					if (!v) this.data.last = null;
					this.save();
				},
			},
			doubleShift: () => this.data.settings.doubleShift,
			aliases: () => (plugin(this.app, "omnisearch") ? [] : [STAND_INS.open]),
		});
		// Last, and never in the way: a Jade that throws must not stop Jet listening.
		try {
			this.jade.start();
		} catch (e) {
			console.error("Jet Search: Jade could not be joined", e);
		}
	}

	/** Omnisearch's ids, taken while nothing holds them (Omnisearch off). */
	private standIn(): void {
		if (this.unloaded || plugin(this.app, "omnisearch")) return;
		const take = (id: string, name: string, run: () => void): void => {
			if (hasCommand(this.app, id)) return;
			const cmd: Command = { id, name, callback: run };
			if (addCommandAs(this.app, cmd)) this.standIns.set(id, cmd);
		};
		// Named apart from Jet's own two, so the palette and the Hotkeys page do not list them twice.
		take(STAND_INS.open, "Jet Search: Search notes (Omnisearch's shortcut)", () => this.open());
		take(STAND_INS.inNote, "Jet Search: Search in this note (Omnisearch's shortcut)", () => this.openInNote());
	}
}
