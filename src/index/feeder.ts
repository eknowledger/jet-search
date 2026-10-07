import { type App, MarkdownView, TFile, type TAbstractFile } from "obsidian";
import type { RawNote } from "../engine/fields";
import type { JetClient } from "../worker/jet-client";
import { excluder, gather, inboundCounts } from "./gather";

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
		return (this.ready ??= this.start().catch((e: unknown) => {
			this.ready = null;
			this.building = false;
			throw e;
		}));
	}

	/** The worker stopped (asleep, or crashed): the next search opens the index again. */
	reset(): void {
		this.ready = null;
		this.live = false;
		this.building = false;
		this.progress = null;
	}

	private notes(): TFile[] {
		const excluded = excluder(this.app, this.excludedFolders());
		return this.app.vault.getMarkdownFiles().filter((f) => !excluded(f.path));
	}

	private async start(): Promise<void> {
		const { loaded } = await this.client.call({
			op: "open",
			vaultId: this.vaultId,
			stemming: [...this.stemming()],
		});
		if (loaded) await this.catchUp();
		else await this.build();
		this.live = true;
		this.onReady?.();
	}

	/** The first build: newest notes first, so recent work is searchable soonest. */
	private async build(): Promise<void> {
		this.building = true;
		const files = this.notes().sort((a, b) => b.stat.mtime - a.stat.mtime);
		const inbound = inboundCounts(this.app);
		this.progress = { done: 0, total: files.length };
		this.onProgress?.();
		for (let i = 0; i < files.length || i === 0; i += BATCH) {
			const slice = files.slice(i, i + BATCH);
			const notes = await this.read(slice, inbound);
			await this.client.call({ op: "batch", notes, last: i + BATCH >= files.length });
			this.progress = { done: Math.min(files.length, i + BATCH), total: files.length };
			this.onProgress?.();
			if (!files.length) break;
		}
		this.progress = null;
		this.building = false;
		this.onProgress?.();
	}

	/** After loading a saved index: what changed while Jet was not looking, by modified time. */
	private async catchUp(): Promise<void> {
		const known = new Map(await this.client.call({ op: "mtimes" }));
		const files = this.notes();
		const present = new Set(files.map((f) => f.path));
		const gone = [...known.keys()].filter((p) => !present.has(p));
		const stale = files.filter((f) => known.get(f.path) !== f.stat.mtime);
		if (gone.length) await this.client.call({ op: "delete", paths: gone });
		const inbound = inboundCounts(this.app);
		for (let i = 0; i < stale.length; i += BATCH)
			await this.client.call({ op: "upsert", notes: await this.read(stale.slice(i, i + BATCH), inbound) });
	}

	private async read(files: readonly TFile[], inbound: Map<string, number>): Promise<RawNote[]> {
		return Promise.all(
			files.map(async (f) => gather(this.app, f, await this.app.vault.cachedRead(f), inbound.get(f.path) ?? 0)),
		);
	}

	// ── Freshness ──────────────────────────────────────────────

	/** A note was created, changed, renamed or deleted: queue it (sent within 100 ms, coalesced). */
	touch(file: TAbstractFile, kind: "upsert" | "delete"): void {
		if (!(file instanceof TFile) || file.extension !== "md") return;
		this.dirty.set(file.path, kind);
		this.schedule(COALESCE_MS);
	}

	rename(file: TAbstractFile, from: string): void {
		if (!(file instanceof TFile) || file.extension !== "md") return;
		if (!this.live) return;
		this.dirty.delete(from);
		void this.client.call({ op: "rename", from, to: file.path }).catch(() => {});
		// The name's terms changed with the path: index it again.
		this.touch(file, "upsert");
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
		// Before the index is open, changes are found by the catch-up; during a build, sent after it.
		if (!this.live || this.building) {
			if (this.building) this.schedule(500);
			else this.dirty.clear();
			return;
		}
		const batch = [...this.dirty];
		this.dirty.clear();
		const excluded = excluder(this.app, this.excludedFolders());
		const deletes = batch.filter(([, k]) => k === "delete").map(([p]) => p);
		const upserts = batch
			.filter(([p, k]) => k === "upsert" && !excluded(p))
			.map(([p]) => this.app.vault.getFileByPath(p))
			.filter((f): f is TFile => !!f);
		if (deletes.length) await this.client.call({ op: "delete", paths: deletes });
		if (upserts.length)
			await this.client.call({ op: "upsert", notes: await this.read(upserts, inboundCounts(this.app)) });
		if (deletes.length || upserts.length) this.onChanged?.();
	}

	stop(): void {
		if (this.flushTimer !== null) window.clearTimeout(this.flushTimer);
		if (this.typingTimer !== null) window.clearTimeout(this.typingTimer);
		this.flushTimer = null;
		this.typingTimer = null;
	}
}
