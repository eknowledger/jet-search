import { fieldsFromRaw } from "../engine/fields";
import { JetEngine } from "../engine/jet-engine";
import { parseQuery } from "../engine/query";
import { STEM_LANGUAGES, type StemLanguage } from "../engine/stem";
import type { QueryReply, Request, Stats } from "./protocol";
import type { Store } from "./store";

/**
 * The index format and text rules the saved index was made with. A saved index of another version is
 * rebuilt. Bump when the analyzer, the fields or the segment layout change.
 */
export const INDEX_VERSION = 1;

/** Quiet time before the worker merges or saves after changes. */
const IDLE_MS = 2000;

/** Timers, passed in: the worker's own (it has no window), or manual ones in tests. */
export type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void };

/**
 * The worker's request handler, kept free of the Worker itself so tests can drive
 * it: the engine, its persistence, and the idle merge and save after changes.
 */
export class Router {
	readonly engine = new JetEngine();
	private store: Store | null = null;
	private savedAt: number | null = null;
	private savedBase: ArrayBuffer | null = null;
	private bytes = 0;
	private idle: unknown = null;
	/**
	 * Each scope's notes, by path (not the index's note ids, which change
	 * at every segment merge while paths do not, and a path set is small: under 1 MB at 15k notes).
	 */
	private readonly scopes = new Map<string, Set<string>>();

	constructor(
		private readonly makeStore: (vaultId: string) => Store,
		private readonly timers: Timers,
	) {}

	async handle(req: Request): Promise<unknown> {
		switch (req.op) {
			case "open": {
				this.configure(req.stemming);
				this.store = this.makeStore(req.vaultId);
				let loaded = false;
				try {
					const saved = await this.store.load();
					if (saved && saved.version === INDEX_VERSION) {
						this.engine.load(saved.base, saved.sidecar);
						this.savedAt = saved.savedAt;
						this.savedBase = saved.base;
						this.bytes = saved.base.byteLength + saved.sidecar.byteLength;
						loaded = true;
					}
				} catch (e) {
					// A broken or unreadable index is rebuilt, never fatal.
					console.warn("Jet Search: the saved index could not be read; rebuilding", e);
				}
				// Root groups for word forms are built while the worker waits for the first query.
				this.timers.set(() => this.engine.warm(), 0);
				return { loaded, notes: this.engine.size };
			}
			case "configure":
				this.configure(req.stemming);
				this.timers.set(() => this.engine.warm(), 0);
				return { notes: this.engine.size };
			case "batch":
				this.engine.addBatch(req.notes.map(fieldsFromRaw));
				if (req.last) {
					this.engine.merge();
					this.timers.set(() => this.engine.warm(), 0);
					await this.save();
				}
				return { notes: this.engine.size };
			case "upsert":
				for (const n of req.notes) this.engine.upsert(fieldsFromRaw(n));
				this.changed();
				return { notes: this.engine.size };
			case "delete":
				for (const p of req.paths) {
					this.engine.delete(p);
					for (const set of this.scopes.values()) set.delete(p);
				}
				this.changed();
				return { notes: this.engine.size };
			case "rename":
				this.engine.rename(req.from, req.to);
				for (const set of this.scopes.values()) if (set.delete(req.from)) set.add(req.to);
				this.changed();
				return { notes: this.engine.size };
			case "query":
				return this.query(req);
			case "scope:set":
				this.scopes.set(req.id, new Set(req.paths));
				return { notes: req.paths.length };
			case "scope:delta": {
				const set = this.scopes.get(req.id) ?? new Set<string>();
				for (const p of req.remove) set.delete(p);
				for (const p of req.add) set.add(p);
				this.scopes.set(req.id, set);
				return { notes: set.size };
			}
			case "scope:clear":
				for (const id of req.ids ?? [...this.scopes.keys()]) this.scopes.delete(id);
				return { notes: this.scopes.size };
			case "mtimes":
				return this.engine.mtimes();
			case "suggest":
				return this.engine.suggest(parseQuery(req.text));
			case "save":
				await this.save();
				return { notes: this.engine.size };
			case "stats":
				return this.stats();
			case "clear":
				await this.store?.clear();
				this.engine.build([]);
				this.savedAt = null;
				this.savedBase = null;
				return { notes: 0 };
		}
	}

	query(req: Extract<Request, { op: "query" }>): QueryReply {
		const t0 = performance.now();
		// A scope that is not (or no longer) known answers nothing, never everything.
		const allow =
			req.scope !== undefined
				? (this.scopes.get(req.scope) ?? new Set<string>())
				: req.allow
					? new Set(req.allow)
					: null;
		const r = this.engine.query(parseQuery(req.text), {
			limit: req.limit,
			now: req.now,
			allow: allow ? (p) => allow.has(p) : undefined,
		});
		return { seq: req.seq, hits: r.hits, terms: r.terms, ms: performance.now() - t0 };
	}

	private configure(langs: readonly string[]): void {
		const known = new Set<string>(STEM_LANGUAGES);
		this.engine.configure({ stemming: langs.filter((l): l is StemLanguage => known.has(l)) });
	}

	stats(): Stats {
		const shape = this.engine.shape;
		return {
			notes: this.engine.size,
			segments: shape.segments,
			pending: shape.pending,
			savedAt: this.savedAt,
			bytes: this.bytes,
		};
	}

	/** After changes: once quiet, merge if worth it, then save (the sidecar alone if the base is unchanged). */
	private changed(): void {
		if (this.idle !== null) this.timers.clear(this.idle);
		this.idle = this.timers.set(() => {
			this.idle = null;
			if (this.engine.wantsMerge) this.engine.merge();
			void this.save().catch((e: unknown) => console.warn("Jet Search: could not save the index", e));
		}, IDLE_MS);
	}

	private async save(): Promise<void> {
		if (!this.store || !this.engine.size) return;
		const { base, sidecar } = this.engine.save();
		const now = Date.now();
		await this.store.save({
			base: base === this.savedBase ? undefined : base,
			sidecar,
			savedAt: now,
			version: INDEX_VERSION,
		});
		this.savedBase = base;
		this.savedAt = now;
		this.bytes = base.byteLength + sidecar.byteLength;
	}
}
