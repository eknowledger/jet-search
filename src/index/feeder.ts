import { type App, MarkdownView, TFile, type TAbstractFile } from "obsidian";
import type { RawNote } from "../engine/fields";
import type { JetClient } from "../worker/jet-client";
import { excluder, gather, inboundCounts } from "./gather";
import { sliced } from "./slice";

/** Now if the app is in front, else when it comes back (a phone backgrounded, a window minimized). */
const whenVisible = (): Promise<void> =>
	typeof document === "undefined" || !document.hidden
		? Promise.resolve()
		: new Promise((resolve) => {
				const seen = (): void => {
					if (document.hidden) return;
					document.removeEventListener("visibilitychange", seen);
					resolve();
				};
				document.addEventListener("visibilitychange", seen);
			});

/** A build or catch-up stopped because the index was cleared or rebuilt meanwhile (not a failure). */
export class Cancelled extends Error {
	constructor() {
		super("Jet Search: the index was cleared or rebuilt meanwhile");
	}
}
const BATCH = 100;
/** The note being typed in: its text goes to the index this long after typing pauses. */
const TYPING_PAUSE_MS = 300;
/** Other changes are sent at once, coalesced over this window. */
const COALESCE_MS = 100;

export type Progress = { done: number; total: number } | null;

/**
 * Keeps the worker's index in step with the vault: the first build (newest notes
 * first, in batches, searchable as it goes), the catch-up by modified time when a saved index is
 * opened, and changes as they happen. Main-thread work is reading text and the metadata cache.
 */
export class Feeder {
	private ready: Promise<void> | null = null;
	private building = false;
	private readonly dirty = new Map<string, "upsert" | "delete">();
	private flushTimer: number | null = null;
	private typingTimer: number | null = null;
	progress: Progress = null;
	/** Search by meaning's packed model while it is on; null: off. Read when the worker opens. */
	meaningModel: (() => Promise<ArrayBuffer | null>) | null = null;
	/** Notes given vectors so far, while that runs (settings show it). */
	meaningProgress: Progress = null;
	onMeaningProgress: (() => void) | null = null;
	/** Called when the build makes progress or ends (the modal's status). */
	onProgress: (() => void) | null = null;
	/** Called once a build or catch-up finished: the index is current. */
	onReady: (() => void) | null = null;
	/** Called after changes reached the index (an open search re-runs, so results stay live). */
	onChanged: (() => void) | null = null;
	live = false;

	constructor(
		private readonly app: App,
		private readonly client: JetClient,
		private readonly vaultId: string,
		private readonly excludedFolders: () => readonly string[],
		private readonly stemming: () => readonly string[] = () => ["en"],
	) {}

	/** Open the saved index and catch up, or build it (once; again after a worker restart). */
	ensure(): Promise<void> {
		if (this.ready) return this.ready;
		const gen = this.gen;
		const p: Promise<void> = this.start(gen).catch((e: unknown) => {
			// Only this run's state: a reset meanwhile already started afresh.
			if (this.ready === p) {
				this.ready = null;
				this.building = false;
			}
			throw e;
		});
		this.ready = p;
		return p;
	}

	/** Bumped by reset: a build or catch-up of an older run stops at its next step. */
	private gen = 0;

	private alive(gen: number): void {
		if (gen !== this.gen) throw new Cancelled();
	}

	/** The worker stopped (asleep, crashed, cleared): the next search opens the index again. */
	reset(): void {
		this.gen++;
		this.ready = null;
		this.live = false;
		this.building = false;
		this.starting = false;
		this.progress = null;
		this.meaningLoaded = false;
		if (this.meaningProgress) {
			this.meaningProgress = null;
			this.onMeaningProgress?.();
		}
	}

	private notes(): TFile[] {
		const excluded = excluder(this.app, this.excludedFolders());
		return this.app.vault.getMarkdownFiles().filter((f) => !excluded(f.path));
	}

	/** True from the start of an open until the index is live (or the start failed). */
	private starting = false;

	private async start(gen: number): Promise<void> {
		this.starting = true;
		try {
			await this.open(gen);
		} finally {
			if (gen === this.gen) this.starting = false;
		}
	}

	private async open(gen: number): Promise<void> {
		const { loaded } = await this.client.call({
			op: "open",
			vaultId: this.vaultId,
			stemming: [...this.stemming()],
		});
		this.alive(gen);
		// A model the data says is installed but whose file is not here (another device): forgotten.
		await this.meaningCheck?.().catch(() => {});
		// Removed while the worker slept: its saved vectors go now.
		if (this.forgetOnOpen) {
			this.forgetOnOpen = false;
			await this.client.call({ op: "meaning:off", forget: true });
		}
		// The model is not read here: it loads on the first question of the session.
		if (loaded) await this.catchUp(gen);
		else await this.build(gen);
		this.alive(gen);
		this.live = true;
		this.onReady?.();
		// Turned on or off while the index was being built: done now.
		const p = this.meaningPending;
		this.meaningPending = null;
		if (p)
			void this.meaningChanged(p.on, p.forget).catch((e: unknown) =>
				console.warn("Jet Search: search by meaning", e),
			);
	}

	/** The model is in the worker (this session); a generation bumped by every on and off. */
	private meaningLoaded = false;
	private meaningGen = 0;
	private meaningPending: { on: boolean; forget: boolean } | null = null;
	private forgetOnOpen = false;

	/**
	 * The first question of a session: the model to the worker, then vectors for the notes
	 * that lack one, in the background. False when meaning is off or its model cannot be had.
	 */
	async ensureMeaning(): Promise<boolean> {
		if (this.meaningLoaded) return true;
		// Two questions in quick succession load the model once, and make the vectors once.
		this.meaningLoading ??= (async () => {
			try {
				if (!(await this.loadMeaning())) return false;
				void this.embedMissing().catch((e: unknown) =>
					console.warn("Jet Search: notes could not be given vectors", e),
				);
				return true;
			} finally {
				this.meaningLoading = null;
			}
		})();
		return this.meaningLoading;
	}

	private meaningLoading: Promise<boolean> | null = null;

	/**
	 * Send the model to the worker, if meaning is on and installed. A model file that cannot be read
	 * (truncated, an older format, a sync conflict) turns meaning off; words carry on.
	 * Turned off meanwhile: the model is not sent, or dropped again.
	 */
	private async loadMeaning(): Promise<boolean> {
		const gen = this.meaningGen;
		try {
			const buf = (await this.meaningModel?.()) ?? null;
			if (!buf || gen !== this.meaningGen) return false;
			await this.client.call({ op: "meaning:load", buf, model: "potion-base-8M" }, [buf]);
			if (gen !== this.meaningGen) return false;
			this.meaningLoaded = true;
			return true;
		} catch (e) {
			// The worker stopped meanwhile: that is not the model's fault.
			if (!this.client.running) throw e;
			console.warn("Jet Search: the meaning model could not be read; search by meaning is off", e);
			this.onMeaningBroken?.();
			return false;
		}
	}

	/** Checks the installed model's file is still there; set by the plugin. */
	meaningCheck: (() => Promise<void>) | null = null;

	/** The model file could not be used (the plugin forgets it, so the settings offer it again). */
	onMeaningBroken: (() => void) | null = null;

	/**
	 * Meaning turned on while Jet runs: the model to the worker, then vectors for every note.
	 * Off: the worker drops them; `forget` deletes the saved vectors too, now or when the worker next
	 * opens. While the index is built, the change waits for the build's end.
	 */
	async meaningChanged(on: boolean, forget = false): Promise<void> {
		this.meaningGen++;
		if (!this.client.running) {
			// Asleep: on loads at the next question; a forget is done when the worker opens.
			if (forget) this.forgetOnOpen = true;
			return;
		}
		if (!this.live) {
			this.meaningPending = { on, forget: forget || !!this.meaningPending?.forget };
			return;
		}
		if (!on) {
			this.meaningLoaded = false;
			await this.client.call({ op: "meaning:off", forget });
			return;
		}
		if (await this.loadMeaning()) await this.embedMissing();
	}

	/**
	 * Vectors for notes that lack one or whose vector is older than the note, newest first, in batches,
	 * with progress. Stops when meaning is turned off meanwhile; the progress always ends.
	 */
	async embedMissing(): Promise<void> {
		const gen = this.meaningGen;
		const missing = await this.client.call({ op: "meaning:missing" });
		if (!missing.length || gen !== this.meaningGen) return;
		const files = missing.map((p) => this.app.vault.getFileByPath(p)).filter((f): f is TFile => !!f);
		const inbound = inboundCounts(this.app);
		this.meaningProgress = { done: 0, total: files.length };
		this.onMeaningProgress?.();
		try {
			for (let i = 0; i < files.length && gen === this.meaningGen; i += BATCH) {
				// Paused while Obsidian is in the background, so a hidden app does no work.
				await whenVisible();
				if (gen !== this.meaningGen) break;
				const notes = await this.read(files.slice(i, i + BATCH), inbound);
				if (gen !== this.meaningGen) break;
				await this.client.call({ op: "meaning:embed", notes });
				this.meaningProgress = { done: Math.min(files.length, i + BATCH), total: files.length };
				this.onMeaningProgress?.();
			}
		} finally {
			this.meaningProgress = null;
			this.onMeaningProgress?.();
		}
	}

	/** The first build: newest notes first, so recent work is searchable soonest. */
	private async build(gen: number): Promise<void> {
		try {
			await this.building_(gen);
		} catch (e) {
			// A failed build leaves no "Building: 0 of N" behind.
			if (gen === this.gen) {
				this.progress = null;
				this.building = false;
				this.onProgress?.();
			}
			throw e;
		}
	}

	private async building_(gen: number): Promise<void> {
		this.building = true;
		const files = this.notes().sort((a, b) => b.stat.mtime - a.stat.mtime);
		const inbound = inboundCounts(this.app);
		this.progress = { done: 0, total: files.length };
		this.onProgress?.();
		for (let i = 0; i < files.length || i === 0; i += BATCH) {
			const slice = files.slice(i, i + BATCH);
			const notes = await this.read(slice, inbound);
			// Cleared or rebuilt meanwhile: a new worker must not be started by this old run.
			this.alive(gen);
			await this.client.call({ op: "batch", notes, last: i + BATCH >= files.length });
			this.alive(gen);
			this.progress = { done: Math.min(files.length, i + BATCH), total: files.length };
			this.onProgress?.();
			if (!files.length) break;
		}
		this.progress = null;
		this.building = false;
		this.onProgress?.();
	}

	/** After loading a saved index: what changed while Jet was not looking, by modified time. */
	private async catchUp(gen: number): Promise<void> {
		const known = new Map(await this.client.call({ op: "mtimes" }));
		this.alive(gen);
		const files = this.notes();
		const present = new Set(files.map((f) => f.path));
		const gone = [...known.keys()].filter((p) => !present.has(p));
		const stale = files.filter((f) => known.get(f.path) !== f.stat.mtime);
		if (gone.length) await this.client.call({ op: "delete", paths: gone });
		const inbound = inboundCounts(this.app);
		for (let i = 0; i < stale.length; i += BATCH) {
			const notes = await this.read(stale.slice(i, i + BATCH), inbound);
			this.alive(gen);
			await this.client.call({ op: "upsert", notes });
		}
	}

	/** The batch's text (read in parallel), then each note gathered in slices of ≤ 8 ms. */
	private async read(files: readonly TFile[], inbound: Map<string, number>): Promise<RawNote[]> {
		// A note deleted or synced away between the list and the read is left out, not a failure.
		const texts = await Promise.allSettled(files.map((f) => this.app.vault.cachedRead(f)));
		const ok = files.filter((_, i) => texts[i]?.status === "fulfilled");
		const text = (i: number): string => {
			const t = texts[i];
			return t?.status === "fulfilled" ? t.value : "";
		};
		const at = new Map(files.map((f, i) => [f, i]));
		return sliced(ok, (f) => gather(this.app, f, text(at.get(f) ?? -1), inbound.get(f.path) ?? 0));
	}

	// ── Freshness ──────────────────────────────────────────────

	/** A note was created, changed, renamed or deleted: queue it (sent within 100 ms, coalesced). */
	touch(file: TAbstractFile, kind: "upsert" | "delete"): void {
		if (!(file instanceof TFile) || file.extension !== "md") return;
		this.dirty.set(file.path, kind);
		this.schedule(COALESCE_MS);
	}

	rename(file: TAbstractFile, from: string): void {
		if (!(file instanceof TFile)) return;
		// Renamed to another extension (.md → .txt): it is no longer a note.
		if (file.extension !== "md") {
			if (from.toLowerCase().endsWith(".md")) {
				this.dirty.set(from, "delete");
				this.schedule(COALESCE_MS);
			}
			return;
		}
		// During the first build or a catch-up: the old path out and the new one in, queued like any change
		// Before the index is opened at all, the start's catch-up finds it.
		// Moved into an excluded folder: out, not renamed.
		if (!this.live || excluder(this.app, this.excludedFolders())(file.path)) {
			if (!this.live && !this.busy) return;
			this.dirty.set(from, "delete");
			this.touch(file, "upsert");
			return;
		}
		// A delete waiting for the path it moves to goes first: a sync's "delete B, rename A to B".
		const pending = this.dirty.get(file.path) === "delete";
		this.dirty.delete(from);
		this.dirty.delete(file.path);
		void (async () => {
			if (pending) await this.client.call({ op: "delete", paths: [file.path] });
			await this.client.call({ op: "rename", from, to: file.path });
		})().catch(() => {});
		// The name's terms changed with the path: index it again.
		this.touch(file, "upsert");
	}

	/** The worker found the index damaged and dropped it: build it again from the vault. */
	async recover(): Promise<void> {
		if (this.busy) return;
		this.reset();
		await this.ensure().catch((e: unknown) => {
			if (!(e instanceof Cancelled)) console.error("Jet Search: the index could not be built again", e);
		});
	}

	/** A first build or a catch-up is running (changes wait for it; the sleep waits for it too). */
	get busy(): boolean {
		return this.building || this.starting;
	}

	/** The notes Jet indexes: excluded folders left out (the status's total). */
	indexable(): number {
		return this.notes().length;
	}

	/** This vault's id (Clear and Rebuild reach its saved index even while the worker sleeps). */
	get vault(): string {
		return this.vaultId;
	}

	/** A key in the editor: only a timer is reset; the text is read when typing pauses. */
	typing(): void {
		if (!this.live) return;
		if (this.typingTimer !== null) window.clearTimeout(this.typingTimer);
		this.typingTimer = window.setTimeout(() => {
			this.typingTimer = null;
			void this.sendOpenNote();
		}, TYPING_PAUSE_MS);
	}

	private async sendOpenNote(): Promise<void> {
		// The worker went to sleep since the key: the next start's catch-up reads the file.
		if (!this.live) return;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		if (!view || !file || file.extension !== "md" || excluder(this.app, this.excludedFolders())(file.path)) return;
		const text = view.editor.getValue();
		const inbound = inboundCounts(this.app);
		const note = gather(this.app, file, text, inbound.get(file.path) ?? 0);
		// The editor's text is newer than the file: keep a later file event from being skipped by mtime.
		note.mtime = Date.now();
		await this.client.call({ op: "upsert", notes: [note] });
		this.onChanged?.();
	}

	private schedule(ms: number): void {
		if (this.flushTimer !== null) return;
		this.flushTimer = window.setTimeout(() => {
			this.flushTimer = null;
			void this.flush();
		}, ms);
	}

	private async flush(): Promise<void> {
		// Before the index is opened, changes are found by the catch-up; during a build or a catch-up,
		// sent after it (they happen after its listing of the vault).
		if (!this.live || this.building) {
			if (this.busy) this.schedule(500);
			else this.dirty.clear();
			return;
		}
		const batch = [...this.dirty];
		this.dirty.clear();
		const excluded = excluder(this.app, this.excludedFolders());
		// An excluded path (moved there, or the setting changed) leaves the index.
		const deletes = batch.filter(([p, k]) => k === "delete" || excluded(p)).map(([p]) => p);
		const upserts = batch
			.filter(([p, k]) => k === "upsert" && !excluded(p))
			.map(([p]) => this.app.vault.getFileByPath(p))
			.filter((f): f is TFile => !!f);
		if (deletes.length) await this.client.call({ op: "delete", paths: deletes });
		// In batches, so a search typed meanwhile is answered between them, not after all of them.
		const inbound = upserts.length ? inboundCounts(this.app) : new Map<string, number>();
		for (let i = 0; i < upserts.length; i += BATCH) {
			const notes = await this.read(upserts.slice(i, i + BATCH), inbound);
			// Deleted (or deleted again) while its text was read: the delete stands.
			const live = notes.filter(
				(n) => this.dirty.get(n.path) !== "delete" && this.app.vault.getFileByPath(n.path),
			);
			if (live.length) await this.client.call({ op: "upsert", notes: live });
		}
		if (deletes.length || upserts.length) this.onChanged?.();
	}

	stop(): void {
		if (this.flushTimer !== null) window.clearTimeout(this.flushTimer);
		if (this.typingTimer !== null) window.clearTimeout(this.typingTimer);
		this.flushTimer = null;
		this.typingTimer = null;
	}
}
