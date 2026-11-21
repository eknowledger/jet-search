import { answerOrder, contentTerms, rankAnswers } from "../answers/answers";
import { fieldsFromRaw } from "../engine/fields";
import { JetEngine } from "../engine/jet-engine";
import { parseQuery } from "../engine/query";
import { STEM_LANGUAGES, type StemLanguage } from "../engine/stem";
import { docText } from "../meaning/doc";
import { embed, type MeaningModel, unpackModel } from "../meaning/model";
import { Vectors } from "../meaning/vectors";
import type { RawNote } from "../engine/fields";
import type { AnswerPoolReply, AnswersReply, NearReply, QueryReply, Request, Stats } from "./protocol";
import type { Store } from "./store";

/**
 * The index format and text rules the saved index was made with. A saved index of another version is
 * rebuilt. Bump when the analyzer, the fields or the segment layout change.
 */
/** 2: hyphen joins, more folded letters, invisible joiners: an older index is built again. */
export const INDEX_VERSION = 2;

/** Quiet time before the worker merges or saves after changes. */
const IDLE_MS = 2000;
const BUILD_SAVE_MS = 20_000;

/** Timers, passed in: the worker's own (it has no window), or manual ones in tests. */
export type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void };

/** Tells the main thread something the worker caught (a code and the error; the main thread keeps its class only). */
export type Notify = (code: string, e: unknown, level: "error" | "warn") => void;

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
		/** How often a long first build saves what it has, so an interrupted one resumes. */
		private readonly buildSaveMs = BUILD_SAVE_MS,
		private readonly notify: Notify = () => {},
	) {}

	/** What was caught goes to this worker's console as before, and to the main thread for the support info. */
	private caught(code: string, text: string, e: unknown, level: "error" | "warn" = "warn"): void {
		console.warn(text, e);
		this.notify(code, e, level);
	}

	private buildSavedAt = 0;

	async handle(req: Request): Promise<unknown> {
		switch (req.op) {
			case "open": {
				this.configure(req.stemming);
				this.store = this.makeStore(req.vaultId);
				this.buildSavedAt = Date.now();
				const t0 = performance.now();
				let loaded = false;
				let how: "loaded" | "none" | "format-changed" | "error" = "none";
				let found: number | null = null;
				try {
					const saved = await this.store.load();
					if (saved && saved.version === INDEX_VERSION) {
						this.engine.load(saved.base, saved.sidecar);
						this.savedAt = saved.savedAt;
						this.savedBase = saved.base;
						this.bytes = saved.base.byteLength + saved.sidecar.byteLength;
						loaded = true;
						how = "loaded";
					} else if (saved) {
						how = "format-changed";
						found = saved.version;
					}
				} catch (e) {
					// A broken or unreadable index is rebuilt, never fatal; nothing half-loaded
					// is kept (a base whose sidecar failed would keep notes deleted since).
					this.caught("index.read", "Jet Search: the saved index could not be read; rebuilding", e);
					this.engine.build([]);
					loaded = false;
					how = "error";
				}
				// Root groups for word forms are built while the worker waits for the first query.
				this.timers.set(() => this.engine.warm(), 0);
				return {
					loaded,
					notes: this.engine.size,
					how,
					found,
					version: INDEX_VERSION,
					store: this.store.kind ?? "other",
					ms: performance.now() - t0,
				};
			}
			case "configure":
				this.configure(req.stemming);
				this.timers.set(() => this.engine.warm(), 0);
				return { notes: this.engine.size };
			case "batch":
				this.engine.addBatch(req.notes.map(fieldsFromRaw));
				for (const n of req.notes) this.vector(n);
				// A long first build keeps what it has every 20 s: closed or killed (a phone in the background),
				// the next start catches up from there instead of note 1.
				if (!req.last && Date.now() - this.buildSavedAt >= this.buildSaveMs) {
					this.buildSavedAt = Date.now();
					this.engine.merge();
					await this.save().catch((e: unknown) =>
						this.caught("index.save", "Jet Search: could not save the index", e),
					);
				}
				if (req.last) {
					this.engine.merge();
					this.timers.set(() => this.engine.warm(), 0);
					// A save that fails (a full disk) leaves the index working from memory, saved later.
					await this.save().catch((e: unknown) => {
						this.caught("index.save", "Jet Search: could not save the index; trying again later", e);
						this.changed();
					});
				}
				return { notes: this.engine.size };
			case "upsert":
				this.engine.upsertMany(req.notes.map(fieldsFromRaw));
				for (const n of req.notes) this.vector(n);
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
			case "answers:pool":
				return this.answerPool(req);
			case "answers:rank":
				return this.answers(req);
			case "meaning:load": {
				const model = unpackModel(req.buf, req.model);
				let vectors = new Vectors(model.id, model.dim);
				try {
					const saved = await this.store?.loadVectors?.();
					if (saved && saved.model === model.id && saved.dim === model.dim) vectors = Vectors.load(saved);
				} catch (e) {
					this.caught(
						"vectors.read",
						"Jet Search: the saved note vectors could not be read; making them again",
						e,
					);
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
				// Only as the index has the note now: deleted or edited since the batch was read, it is
				// left to the delete or the newer upsert.
				for (const n of req.notes) {
					const indexed = this.engine.mtimeOf(n.path);
					const has = this.meaning?.vectors.mtimeOf(n.path);
					if (indexed === undefined || (has !== undefined && has > n.mtime)) continue;
					// The index may be newer than the file (the open note, sent as typed): the vector counts
					// as current then, or every pass would read it again.
					this.vector({ ...n, mtime: Math.max(n.mtime, indexed) });
				}
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
				if (!this.store && req.vaultId !== undefined) this.store = this.makeStore(req.vaultId);
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
		try {
			return this.queryOnce(req);
		} catch (e) {
			// A damaged saved index (a flipped byte) answers nothing, is dropped from the device, and the
			// plugin builds it again.
			this.caught("index.damaged", "Jet Search: the index is damaged; building it again", e, "error");
			this.engine.build([]);
			void this.store?.clear().catch((err: unknown) => this.notify("index.clear", err, "warn"));
			return { seq: req.seq, hits: [], terms: [], ms: 0, broken: true };
		}
	}

	private queryOnce(req: Extract<Request, { op: "query" }>): QueryReply {
		const t0 = performance.now();
		// A scope that is not (or no longer) known answers nothing, never everything.
		const allow = this.allowOf(req);
		const r = this.engine.query(parseQuery(req.text), {
			limit: req.limit,
			now: req.now,
			allow: allow ? (p) => allow.has(p) : undefined,
		});
		return { seq: req.seq, hits: r.hits, terms: r.terms, rare: r.rare, ms: performance.now() - t0 };
	}

	/**
	 * The notes a query or a question may answer with: a scope's set, or any of several scopes' sets; else the paths sent; else every note. A scope that is not (or no longer) known adds none.
	 */
	private allowOf(req: { scope?: string | string[]; allow?: string[] }): { has(p: string): boolean } | null {
		if (req.scope === undefined) return req.allow ? new Set(req.allow) : null;
		const sets = (typeof req.scope === "string" ? [req.scope] : req.scope).map(
			(id) => this.scopes.get(id) ?? new Set<string>(),
		);
		return sets.length === 1 ? (sets[0] as Set<string>) : { has: (p) => sets.some((s) => s.has(p)) };
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
		// Newest first.
		return this.engine
			.mtimes()
			.filter(([p, t]) => v.mtimeOf(p) !== t)
			.sort((a, b) => b[1] - a[1])
			.map(([p]) => p);
	}

	nearest(req: Extract<Request, { op: "nearest" }>): NearReply {
		const t0 = performance.now();
		const m = this.meaning;
		if (!m) return { seq: req.seq, near: [], ms: 0 };
		const q = embed(m.model, req.text, 64);
		if (!q) return { seq: req.seq, near: [], ms: performance.now() - t0 };
		const allow = this.allowOf(req);
		const near = m.vectors.nearest(q, req.k, allow ? (p) => allow.has(p) : undefined);
		return { seq: req.seq, near, ms: performance.now() - t0 };
	}

	/** Answers (experiment): the notes words and meaning give a question, before the re-rank. */
	answerPool(req: Extract<Request, { op: "answers:pool" }>): AnswerPoolReply {
		const allow = this.allowOf(req);
		const keep = allow ? (p: string) => allow.has(p) : undefined;
		const content = contentTerms(req.text).join(" ");
		const words = content
			? this.engine
					.query(parseQuery(content), { limit: req.k, now: Date.now(), allow: keep, any: true })
					.hits.map((h) => h.path)
			: [];
		const m = this.meaning;
		const q = m && embed(m.model, req.text, 64);
		const meaning = m && q ? m.vectors.nearest(q, req.k, keep).map((n) => n.path) : [];
		return { words, meaning };
	}

	/**
	 * Answers (experiment): the notes re-ranked by their best line, with the rarity of the question's
	 * words from the index and, while meaning is on, the model's closeness of each note's best lines.
	 */
	async answers(req: Extract<Request, { op: "answers:rank" }>): Promise<AnswersReply> {
		const t0 = performance.now();
		const m = this.meaning;
		const ranked = await rankAnswers(req.text, req.notes, {
			// Between slices of notes: messages that came meanwhile are queued, and a newer search (a
			// query or another question) ends this one: its answers would be for a text no longer typed.
			pause: () =>
				new Promise<boolean>((resolve) => this.timers.set(() => resolve(this.interrupted?.() ?? false), 0)),
			rarity: async (terms) => ({ notes: this.engine.size, df: this.engine.docFreq(terms) }),
			closeness: m
				? async (question, lines) => {
						const q = embed(m.model, question, 64);
						return lines.map((l) => {
							const v = q && embed(m.model, l, 96);
							if (!q || !v) return 0;
							let s = 0;
							for (let i = 0; i < q.length; i++) s += (q[i] as number) * (v[i] as number);
							return s;
						});
					}
				: undefined,
		});
		if (!ranked) return { seq: req.seq, ranked: [], order: [], ms: performance.now() - t0, stale: true };
		return { seq: req.seq, ranked, order: answerOrder(req.text, ranked, req.meaning), ms: performance.now() - t0 };
	}

	/** Whether a newer search is waiting (set by the worker, which holds the queue): a re-rank stops for it. */
	interrupted: (() => boolean) | null = null;

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
			void this.save().catch((e: unknown) =>
				this.caught("index.save", "Jet Search: could not save the index", e),
			);
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
