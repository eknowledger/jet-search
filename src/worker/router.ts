import { fieldsFromRaw } from "../engine/fields";
import { JetEngine } from "../engine/jet-engine";
import { parseQuery } from "../engine/query";
import { STEM_LANGUAGES, type StemLanguage } from "../engine/stem";
import { docText } from "../meaning/doc";
import { embed, type MeaningModel, unpackModel } from "../meaning/model";
import { Vectors } from "../meaning/vectors";
import type { RawNote } from "../engine/fields";
import type { NearReply, QueryReply, Request, Stats } from "./protocol";
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
	/** Search by meaning: the model and the notes' vectors, while it is on. */
	private meaning: { model: MeaningModel; vectors: Vectors } | null = null;

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
				for (const n of req.notes) this.vector(n);
				if (req.last) {
					this.engine.merge();
					this.timers.set(() => this.engine.warm(), 0);
					await this.save();
				}
				return { notes: this.engine.size };
			case "upsert":
				for (const n of req.notes) {
					this.engine.upsert(fieldsFromRaw(n));
					this.vector(n);
				}
				this.changed();
				return { notes: this.engine.size };
			case "delete":
				for (const p of req.paths) {
					this.engine.delete(p);
					this.meaning?.vectors.delete(p);
					for (const set of this.scopes.values()) set.delete(p);
				}
				this.changed();
				return { notes: this.engine.size };
			case "rename":
				this.engine.rename(req.from, req.to);
				this.meaning?.vectors.rename(req.from, req.to);
				for (const set of this.scopes.values()) if (set.delete(req.from)) set.add(req.to);
				this.changed();
				return { notes: this.engine.size };
			case "query":
				return this.query(req);
			case "nearest":
				return this.nearest(req);
			case "meaning:load": {
				const model = unpackModel(req.buf, req.model);
				let vectors = new Vectors(model.id, model.dim);
				try {
					const saved = await this.store?.loadVectors?.();
					if (saved && saved.model === model.id && saved.dim === model.dim) vectors = Vectors.load(saved);
				} catch (e) {
					console.warn("Jet Search: the saved note vectors could not be read; making them again", e);
				}
				// Vectors of notes the index no longer has go.
				const known = new Set(this.engine.mtimes().map(([p]) => p));
				for (const p of vectors.paths()) if (!known.has(p)) vectors.delete(p);
				this.meaning = { model, vectors };
				return { notes: this.engine.size, missing: this.missing().length, vectors: vectors.size };
			}
			case "meaning:off":
				this.meaning = null;
				if (req.forget) await this.store?.saveVectors?.(null);
				return { notes: this.engine.size };
			case "meaning:embed":
				for (const n of req.notes) this.vector(n);
				this.changed();
				return { notes: this.meaning?.vectors.size ?? 0 };
			case "meaning:missing":
				return this.missing();
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
			case "mentions": {
				const paths = this.engine.mentions(parseQuery(req.text).words);
				const set = req.scope !== undefined ? this.scopes.get(req.scope) : undefined;
				return { notes: paths.length, inside: set ? paths.filter((p) => set.has(p)).length : 0 };
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
				if (this.meaning)
					this.meaning = {
						...this.meaning,
						vectors: new Vectors(this.meaning.model.id, this.meaning.model.dim),
					};
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

	/** A note's vector, when meaning is on (none for a note with no known word: it is never near). */
	private vector(n: RawNote): void {
		const m = this.meaning;
		if (m) m.vectors.set(n.path, n.mtime, embed(m.model, docText(n)));
	}

	/** Notes in the index whose vector is missing or older than the note. */
	private missing(): string[] {
		const v = this.meaning?.vectors;
		if (!v) return [];
		return this.engine
			.mtimes()
			.filter(([p, t]) => v.mtimeOf(p) !== t)
			.map(([p]) => p);
	}

	nearest(req: Extract<Request, { op: "nearest" }>): NearReply {
		const t0 = performance.now();
		const m = this.meaning;
		if (!m) return { seq: req.seq, near: [], ms: 0 };
		const q = embed(m.model, req.text, 64);
		if (!q) return { seq: req.seq, near: [], ms: performance.now() - t0 };
		const allow =
			req.scope !== undefined
				? (this.scopes.get(req.scope) ?? new Set<string>())
				: req.allow
					? new Set(req.allow)
					: null;
		const near = m.vectors.nearest(q, req.k, allow ? (p) => allow.has(p) : undefined);
		return { seq: req.seq, near, ms: performance.now() - t0 };
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
		const v = this.meaning?.vectors;
		if (v?.dirty && this.store.saveVectors) {
			await this.store.saveVectors(v.save());
			v.dirty = false;
		}
	}
}
