import { arabicBare, cjkChar, noTypos } from "./analyzer";
import type { NoteInput } from "./fields";
import { FIELDS } from "./fields";
import type { Query } from "./query";
import { B_BODY, buildSegment, K1, type MergePart, mergeSegments, Segment } from "./segment";
import { STEMMERS, type StemLanguage, stemmable } from "./stem";
import { lowerBound, prefixRange, typoBudget, typoMatches } from "./typos";

/** One result: the note, its score, how many query words it matched, and its typo edits in total. */
export type Hit = { path: string; score: number; matched: number; edits: number };
export type QueryResult = { hits: Hit[]; terms: string[] };
export type QueryOptions = {
	limit?: number;
	now?: number;
	allow?: (path: string) => boolean;
	/** Rank fewer typo edits before score; by default the typo weights decide. */
	editsFirst?: boolean;
};

/** What the rest of Jet sees of an engine, so the engine can be swapped. */
export type SearchEngine = {
	build(notes: readonly NoteInput[]): void;
	upsert(note: NoteInput): void;
	upsertMany(notes: readonly NoteInput[]): void;
	delete(path: string): void;
	rename(from: string, to: string): void;
	query(q: Query, opts?: QueryOptions): QueryResult;
	save(): { base: ArrayBuffer; sidecar: Uint8Array };
	load(base: ArrayBuffer, sidecar?: Uint8Array): void;
	readonly size: number;
};

// Expansion weights.
const EXACT = 1;
const PREFIX = 0.7;
const PREFIX_LIMIT = 64;
const TYPO1 = 0.55;
const TYPO2 = 0.35;
const FUZZY_PREFIX = 0.4;
/**
 * Typos and fuzzy prefixes only rescue a word the vault barely has: when its own matches (exactly, as
 * a prefix, as a word form) are in fewer notes than this. "world" never brings "would" and "words".
 */
const TYPOS_BELOW = 3;
const FUZZY_LIMIT = 200;
/** Pending notes past which the delta is frozen into a segment, and segments past which they are merged at once. */
const FREEZE = 256;
const MAX_SEGMENTS = 24;
/** Word forms: a word's root group, below the exact word. */
const STEM = 0.8;
const STEM_LIMIT = 32;
/** Compound parts: compounds that start or end with the word, below word forms. */
const COMPOUND = 0.6;
const COMPOUND_LIMIT = 32;
const COMPOUND_LANGS: ReadonlySet<StemLanguage> = new Set(["de", "nl", "sv"]);
/** Linking letters between the parts of a compound (Arbeit-s-zeit, Kirche-n-turm). */
const LINKS = ["", "s", "es", "n", "en", "e"];

/** What the engine expands words with: stemming languages (English by default). */
export type EngineConfig = { stemming: readonly StemLanguage[] };

/** Per segment, built on first need: root groups found so far, and its terms sorted by their reverse. */
type Extras = { groups: Map<string, number[]>; reversed: { keys: string[]; ids: Int32Array } | null };
const extras = new WeakMap<Segment, Extras>();
const extrasOf = (seg: Segment): Extras => {
	let x = extras.get(seg);
	if (!x) extras.set(seg, (x = { groups: new Map(), reversed: null }));
	return x;
};

/** Arabic prefixes a light stem drops: words in a group may start with any of them. */
const AR_PREFIXES = [
	"",
	"\u0648",
	"\u0627\u0644",
	"\u0628\u0627\u0644",
	"\u0643\u0627\u0644",
	"\u0641\u0627\u0644",
	"\u0644\u0644",
	"\u0648\u0627\u0644",
];

/**
 * The terms of a segment sharing a word's stem in a language (its root group), most frequent
 * first. A stem is (nearly always) a prefix of its words, so only the terms starting with the stem's
 * first letters are stemmed: no table is built ahead, and a group costs a few hundred stems once.
 */
export const rootGroup = (seg: Segment, lang: StemLanguage, stem: string): number[] => {
	const x = extrasOf(seg);
	const key = `${lang}:${stem}`;
	const known = x.groups.get(key);
	if (known) return known;
	const terms = seg.terms;
	const stemOf = STEMMERS[lang];
	// A short stem's words may change its end (try → trying, use → using, sky → skies): start the scan
	// from two letters then; the 5,000-term cap bounds it.
	const head = stem.length <= 3 ? stem.slice(0, 2) : stem.slice(0, Math.max(3, stem.length - 2));
	const out: number[] = [];
	for (const pre of lang === "ar" ? AR_PREFIXES : [""]) {
		const [from, to] = prefixRange(terms, pre + head);
		for (let t = from; t < to && t < from + 5000; t++) {
			const term = terms[t] as string;
			if (stemmable(lang, term) && stemOf(term) === stem) out.push(t);
		}
	}
	out.sort((a, b) => (seg.df[b] as number) - (seg.df[a] as number));
	if (x.groups.size > 2000) x.groups.clear();
	x.groups.set(key, out);
	return out;
};

const reverse = (s: string): string => [...s].reverse().join("");

/** The segment's terms sorted by their reversed spelling (to find compounds ending with a word). */
const reversedTerms = (seg: Segment): { keys: string[]; ids: Int32Array } => {
	const x = extrasOf(seg);
	if (x.reversed) return x.reversed;
	const pairs = seg.terms
		.map((t, i) => [reverse(t), i] as const)
		.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
	x.reversed = { keys: pairs.map((p) => p[0]), ids: Int32Array.from(pairs.map((p) => p[1])) };
	return x.reversed;
};
const DAY = 86_400_000;

type Expansion = { t: number; w: number; e: number };

/** Per-segment scratch arrays, reused across queries; "stamps" mark which entries are current. */
class Scratch {
	readonly total: Float32Array;
	readonly matched: Uint32Array;
	/** Bit per query word: the word (or one of its expansions) is in the note's name. */
	readonly inName: Uint32Array;
	readonly wInName: Uint8Array;
	readonly edits: Uint16Array;
	readonly qStamp: Uint32Array;
	readonly best: Float32Array;
	readonly bestEdits: Uint8Array;
	readonly wStamp: Uint32Array;
	readonly exp: Float32Array;
	readonly eStamp: Uint32Array;
	readonly xStamp: Uint32Array;
	q = 0;
	w = 0;
	e = 0;

	constructor(n: number) {
		this.total = new Float32Array(n);
		this.matched = new Uint32Array(n);
		this.inName = new Uint32Array(n);
		this.wInName = new Uint8Array(n);
		this.edits = new Uint16Array(n);
		this.qStamp = new Uint32Array(n);
		this.best = new Float32Array(n);
		this.bestEdits = new Uint8Array(n);
		this.wStamp = new Uint32Array(n);
		this.exp = new Float32Array(n);
		this.eStamp = new Uint32Array(n);
		this.xStamp = new Uint32Array(n);
	}
}

type Part = { seg: Segment; dead: Uint8Array | null; scratch: Scratch; path: (d: number) => string };
type Candidate = { part: Part; d: number; matched: number; edits: number; score: number; allInName: boolean };

/** The edits-first key: more words matched, then fewer typo edits, then higher score. */
const byKey = (a: Candidate, b: Candidate): boolean =>
	a.matched !== b.matched ? a.matched > b.matched : a.edits !== b.edits ? a.edits < b.edits : a.score > b.score;
/** Ranking key: more words matched, then score; typos weigh in through their weights. */
const byScore = (a: Candidate, b: Candidate): boolean =>
	a.matched !== b.matched ? a.matched > b.matched : a.score > b.score;

/** A frozen segment with its tombstones (notes replaced or deleted since it was built). */
type SegPart = { seg: Segment; dead: Uint8Array; deadCount: number; renamed: Map<number, string>; scratch: Scratch };

/**
 * Jet's engine: frozen segments (one after a load or a merge; several while a
 * first build adds batches), a small delta segment rebuilt from the notes changed since, and
 * tombstones over the frozen ones. Queries read them all and skip tombstoned notes; `merge()` folds
 * everything into one segment (when idle, or before saving). Pure: runs in the worker and in tests.
 */
export class JetEngine implements SearchEngine {
	private config: EngineConfig = { stemming: ["en"] };
	private segs: SegPart[] = [];
	private ids = new Map<string, { s: SegPart; d: number }>();
	private pending = new Map<string, NoteInput>();
	private delta: Segment | null = null;
	private deltaScratch: Scratch | null = null;
	private inboundByName: Map<string, number> | null = null;

	/** Set the stemming languages (settings); root groups are built on first use per segment. */
	configure(config: EngineConfig): void {
		this.config = { stemming: [...config.stemming] };
	}

	/** Build what queries will need ahead of them (the reversed terms for compounds), e.g. when idle after a load. */
	warm(): void {
		if (!this.config.stemming.some((l) => COMPOUND_LANGS.has(l))) return;
		for (const s of this.segs) reversedTerms(s.seg);
	}

	get size(): number {
		let n = this.pending.size;
		for (const s of this.segs) n += s.seg.docCount - s.deadCount;
		return n;
	}

	/** Frozen segments and pending changes: what a merge would fold together. */
	get shape(): { segments: number; pending: number } {
		return { segments: this.segs.length, pending: this.pending.size };
	}

	/** Whether a merge is worth it now: several segments, or changes over 5% of the notes. */
	get wantsMerge(): boolean {
		return this.segs.length > 1 || this.pending.size > Math.max(20, 0.05 * this.size);
	}

	build(notes: readonly NoteInput[]): void {
		this.reset();
		const inbound = countInbound(notes);
		this.addPart(new Segment(buildSegment(notes, (n) => inbound.get(n) ?? 0)));
	}

	/**
	 * Add a batch of notes as a new frozen segment (a first build, newest notes first, searchable as it
	 * goes). Notes already indexed are replaced. Field lengths are scored against the first batch's
	 * averages so batches compare fairly.
	 */
	addBatch(notes: readonly NoteInput[]): void {
		if (!notes.length) return;
		let had = false;
		for (const n of notes) {
			this.kill(n.path);
			had = this.pending.delete(n.path) || had;
		}
		if (had) this.rebuildDelta();
		const inbound = this.inbound();
		this.addPart(new Segment(buildSegment(notes, inbound, this.segs[0]?.seg.averages)));
	}

	upsert(note: NoteInput): void {
		this.upsertMany([note]);
	}

	/**
	 * Notes changed together: the delta is built once for all of them, not once per note (it holds every
	 * pending note, so per note was quadratic: a fresh vault's metadata arriving after the first build
	 * sent 15,000 at once and the worker answered nothing for minutes). Past FREEZE pending notes the
	 * delta becomes a frozen segment, so each change costs its own notes only; the idle merge folds
	 * the segments together, or now when there are many.
	 */
	upsertMany(notes: readonly NoteInput[]): void {
		if (!notes.length) return;
		for (const n of notes) {
			this.kill(n.path);
			this.pending.set(n.path, n);
		}
		if (this.pending.size < FREEZE) {
			this.rebuildDelta();
			return;
		}
		const frozen = [...this.pending.values()];
		this.pending.clear();
		this.delta = null;
		this.deltaScratch = null;
		this.addPart(new Segment(buildSegment(frozen, this.inbound(), this.segs[0]?.seg.averages)));
		if (this.segs.length > MAX_SEGMENTS) this.merge();
	}

	delete(path: string): void {
		this.kill(path);
		if (this.pending.delete(path)) this.rebuildDelta();
	}

	/** Move a note's path. Its name terms change too, so the caller also sends the renamed note (upsert). */
	rename(from: string, to: string): void {
		const p = this.pending.get(from);
		if (p) {
			this.pending.delete(from);
			this.pending.set(to, { ...p, path: to });
			this.rebuildDelta();
			return;
		}
		const at = this.ids.get(from);
		if (!at) return;
		this.ids.delete(from);
		this.ids.set(to, at);
		at.s.renamed.set(at.d, to);
	}

	/** Fold every segment and the pending changes into one segment. */
	merge(): void {
		if (this.segs.length <= 1 && !this.pending.size && !(this.segs[0]?.deadCount ?? 0)) return;
		const parts: MergePart[] = this.segs.map((s) => ({
			seg: s.seg,
			dead: s.dead,
			path: (d) => s.renamed.get(d) ?? (s.seg.paths[d] as string),
		}));
		const delta = this.delta;
		if (delta) parts.push({ seg: delta, dead: null, path: (d) => delta.paths[d] as string });
		const merged = new Segment(mergeSegments(parts));
		this.reset();
		this.addPart(merged);
	}

	/**
	 * In how many live notes word `i`'s own expansions occur, counted up to TYPOS_BELOW: notes, not
	 * postings, so a dead copy or three word forms in one note count once.
	 */
	private liveNotes(parts: Part[], own: Array<Array<Array<{ t: number }>>>, i: number): number {
		let sum = 0;
		for (const [p, exps] of own.entries())
			for (const x of exps[i] ?? []) sum += (parts[p] as Part).seg.df[x.t] as number;
		if (sum < TYPOS_BELOW) return sum;
		const seen = new Set<number>();
		for (const [p, exps] of own.entries()) {
			const { seg, dead } = parts[p] as Part;
			const add = (d: number): boolean => {
				if (!dead?.[d]) seen.add(p * 0x1000000 + d);
				return seen.size >= TYPOS_BELOW;
			};
			for (const x of exps[i] ?? []) {
				for (let k = seg.metaOff[x.t] as number, end = seg.metaOff[x.t + 1] as number; k < end; k++)
					if (add(seg.metaDocs[k] as number)) return seen.size;
				if (seg.someBody(x.t, add)) return seen.size;
			}
		}
		return seen.size;
	}

	query(q: Query, opts: QueryOptions = {}): QueryResult {
		const limit = opts.limit ?? 50;
		const now = opts.now ?? Date.now();
		const parts = this.parts();
		const n = q.words.length;
		if (!n || !parts.length) return { hits: [], terms: [] };
		const N = Math.max(1, this.size);
		const terms = new Set<string>();
		const candidates: Candidate[] = [];
		// Each word's own expansions in every part, and in how many notes they occur (for TYPOS_BELOW).
		const isLast = (i: number): boolean => q.lastIsPrefix && i === n - 1;
		const own = parts.map((part) => q.words.map((w, i) => expand(part.seg, w, isLast(i), this.config, false)));
		const typos = q.words.map((_, i) => this.liveNotes(parts, own, i) < TYPOS_BELOW);
		for (const [p, part] of parts.entries()) {
			const { seg, dead, scratch: s } = part;
			s.q++;
			const touchedQ: number[] = [];
			const avgBody = seg.averages[FIELDS.length] as number;
			for (let i = 0; i < n; i++) {
				const word = q.words[i] as string;
				s.w++;
				const touchedW: number[] = [];
				const exps = typos[i] ? expand(seg, word, isLast(i), this.config, true) : (own[p]?.[i] ?? []);
				for (const x of exps) {
					const term = seg.terms[x.t] as string;
					const df = (seg.df[x.t] as number) + this.otherDf(seg, term);
					const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
					s.e++;
					const touchedE: number[] = [];
					for (let k = seg.metaOff[x.t] as number, end = seg.metaOff[x.t + 1] as number; k < end; k++) {
						const d = seg.metaDocs[k] as number;
						if (dead?.[d]) continue;
						s.eStamp[d] = s.e;
						s.exp[d] = seg.metaScore[k] as number;
						touchedE.push(d);
						if (seg.metaInName[k]) {
							// Name hits are noted per word, for the title boost: any expansion counts.
							if (s.wStamp[d] !== s.w) {
								s.wStamp[d] = s.w;
								s.best[d] = 0;
								s.bestEdits[d] = x.e;
								touchedW.push(d);
							}
							s.wInName[d] = 1;
						}
					}
					// Body postings, decoded inline: (doc gap, count) varint pairs.
					const body = seg.body;
					let pos = seg.bodyOff[x.t] as number;
					const end = seg.bodyOff[x.t + 1] as number;
					let d = -1;
					while (pos < end) {
						let b = body[pos++] as number;
						let gap = b & 0x7f;
						for (let sh = 7; b & 0x80; sh += 7) gap |= ((b = body[pos++] as number) & 0x7f) << sh;
						b = body[pos++] as number;
						let tf = b & 0x7f;
						for (let sh = 7; b & 0x80; sh += 7) tf |= ((b = body[pos++] as number) & 0x7f) << sh;
						d += gap + 1;
						if (dead?.[d]) continue;
						const len = seg.bodyLen[d] as number;
						const sb = (tf * (K1 + 1)) / (tf + K1 * (1 - B_BODY + (B_BODY * len) / avgBody));
						if (s.eStamp[d] === s.e) s.exp[d] = (s.exp[d] as number) + sb;
						else {
							s.eStamp[d] = s.e;
							s.exp[d] = sb;
							touchedE.push(d);
						}
					}
					if (touchedE.length) terms.add(term);
					// Max over a word's expansions: forty "exp…" words do not add up.
					for (const doc of touchedE) {
						const c = x.w * idf * (s.exp[doc] as number);
						if (s.wStamp[doc] !== s.w) {
							s.wStamp[doc] = s.w;
							s.best[doc] = c;
							s.bestEdits[doc] = x.e;
							s.wInName[doc] = 0;
							touchedW.push(doc);
						} else if (c > (s.best[doc] as number)) {
							s.best[doc] = c;
							s.bestEdits[doc] = x.e;
						}
					}
				}
				// Counted, not a bit per word: a pasted paragraph of 33 words keeps AND.
				for (const doc of touchedW) {
					if (s.qStamp[doc] !== s.q) {
						s.qStamp[doc] = s.q;
						s.total[doc] = 0;
						s.matched[doc] = 0;
						s.inName[doc] = 0;
						s.edits[doc] = 0;
						touchedQ.push(doc);
					}
					if (s.wInName[doc]) s.inName[doc] = (s.inName[doc] as number) + 1;
					s.total[doc] = (s.total[doc] as number) + (s.best[doc] as number);
					s.matched[doc] = (s.matched[doc] as number) + 1;
					s.edits[doc] = (s.edits[doc] as number) + (s.bestEdits[doc] as number);
				}
			}
			// Exclusions: notes with an excluded word are dropped.
			// A group goes only when the note has all of its terms.
			for (const g of q.groups ?? []) {
				let docs: Set<number> | null = null;
				for (const word of g) {
					const t = exactTerm(seg, word);
					const has = new Set<number>();
					if (t >= 0) {
						for (let k = seg.metaOff[t] as number, end = seg.metaOff[t + 1] as number; k < end; k++)
							has.add(seg.metaDocs[k] as number);
						seg.forBody(t, (doc) => has.add(doc));
					}
					const prev: Set<number> | null = docs;
					docs = prev ? new Set([...prev].filter((d: number) => has.has(d))) : has;
					if (!docs.size) break;
				}
				for (const d of docs ?? []) s.xStamp[d] = s.q;
			}
			for (const word of q.excluded) {
				const t = exactTerm(seg, word);
				if (t < 0) continue;
				for (let k = seg.metaOff[t] as number, end = seg.metaOff[t + 1] as number; k < end; k++)
					s.xStamp[seg.metaDocs[k] as number] = s.q;
				seg.forBody(t, (doc) => (s.xStamp[doc] = s.q));
			}
			for (const d of touchedQ) {
				if (s.xStamp[d] === s.q) continue;
				if (opts.allow && !opts.allow(part.path(d))) continue;
				candidates.push({
					part,
					d,
					matched: s.matched[d] as number,
					edits: s.edits[d] as number,
					score: s.total[d] as number,
					allInName: s.inName[d] === n,
				});
			}
		}
		// AND first; if no note has every word, notes with some, scaled by the share matched.
		const all = candidates.filter((c) => c.matched === n);
		const pool = all.length ? all : candidates;
		const typed = q.words.join(" ");
		const top = new TopK(limit, opts.editsFirst ? byKey : byScore);
		for (const c of pool) {
			const { seg } = c.part;
			let score = c.score;
			if (!all.length) score *= (c.matched / n) ** 2;
			const name = seg.names[c.d] as string;
			if (name === typed) score *= 2;
			else if (name.startsWith(q.lastIsPrefix ? typed : `${typed} `)) score *= 1.5;
			else if (c.allInName) score *= 1.4;
			const days = Math.max(0, (now - (seg.mtime[c.d] as number)) / DAY);
			score *= 1 + 0.2 * Math.exp(-days / 45);
			score *= 1 + 0.08 * Math.log2(1 + (seg.inLinks[c.d] as number));
			c.score = score;
			top.push(c);
		}
		return {
			hits: top
				.sorted()
				.map((c) => ({ path: c.part.path(c.d), score: c.score, matched: c.matched, edits: c.edits })),
			terms: [...terms],
		};
	}

	/** The index as a base (one segment: merged first if needed) and a sidecar of nothing pending. */
	save(): { base: ArrayBuffer; sidecar: Uint8Array } {
		if (this.segs.length !== 1) this.merge();
		const base = this.segs[0];
		if (!base) throw new Error("nothing to save");
		const side = {
			dead: [...base.dead.keys()].filter((i) => base.dead[i]),
			renamed: [...base.renamed],
			pending: [...this.pending.values()],
		};
		return { base: base.seg.buffer, sidecar: new TextEncoder().encode(JSON.stringify(side)) };
	}

	load(base: ArrayBuffer, sidecar?: Uint8Array): void {
		this.reset();
		const part = this.addPart(new Segment(base));
		if (!sidecar?.byteLength) return;
		const side = JSON.parse(new TextDecoder().decode(sidecar)) as {
			dead: number[];
			renamed: Array<[number, string]>;
			pending: NoteInput[];
		};
		// A dead note is not indexed any more: out of `ids` too, or catch-up would skip it.
		for (const id of side.dead) {
			this.markDead(part, id);
			const p = part.seg.paths[id];
			if (p !== undefined && this.ids.get(p)?.d === id) this.ids.delete(p);
		}
		for (const [id, path] of side.renamed) {
			if (part.dead[id]) continue;
			const old = part.seg.paths[id];
			if (old !== undefined) this.ids.delete(old);
			this.ids.set(path, { s: part, d: id });
			part.renamed.set(id, path);
		}
		for (const p of side.pending) this.pending.set(p.path, p);
		this.rebuildDelta();
	}

	/**
	 * For a query that found nothing: each word not in the index replaced by the closest
	 * spelling the index has (up to two edits, the most used one), and how many notes that finds.
	 */
	suggest(q: Query): { text: string | null; notes: number } {
		// Every part, not the first segment alone: a word only a new note has is suggested too.
		const segs = this.parts().map((p) => p.seg);
		if (!segs.length || !q.words.length) return { text: null, notes: 0 };
		let changed = false;
		const words = q.words.map((w) => {
			if (segs.some((seg) => exactTerm(seg, w) >= 0) || noTypos(w) || w.length < 3) return w;
			let best: { t: string; df: number; e: number } | null = null;
			for (const seg of segs)
				for (const m of typoMatches(seg.terms, w, 2, { limit: 200 })) {
					if (m.prefix) continue;
					const df = seg.df[m.index] as number;
					if (!best || m.edits < best.e || (m.edits === best.e && df > best.df))
						best = { t: seg.terms[m.index] as string, df, e: m.edits };
				}
			if (!best) return w;
			changed = true;
			return best.t;
		});
		if (!changed) return { text: null, notes: 0 };
		const text = words.join(" ");
		const notes = this.query({ words, excluded: q.excluded, phrases: [], lastIsPrefix: false }, { limit: 1000 })
			.hits.length;
		return { text: notes ? text : null, notes };
	}

	/**
	 * The notes whose text has every word exactly (no prefix, typo or word form), anywhere: body, name,
	 * headings, tags or folder. A scope's name mentioned outside the scope tells how ambiguous it is.
	 */
	mentions(words: readonly string[]): string[] {
		const out: string[] = [];
		if (!words.length) return out;
		for (const part of this.parts()) {
			const { seg, dead } = part;
			let docs: Set<number> | null = null;
			for (const w of words) {
				const t = exactTerm(seg, w);
				const has = new Set<number>();
				if (t >= 0) {
					for (let k = seg.metaOff[t] as number, end = seg.metaOff[t + 1] as number; k < end; k++)
						has.add(seg.metaDocs[k] as number);
					const body = seg.body;
					let pos = seg.bodyOff[t] as number;
					const end = seg.bodyOff[t + 1] as number;
					let d = -1;
					while (pos < end) {
						let b = body[pos++] as number;
						let gap = b & 0x7f;
						for (let sh = 7; b & 0x80; sh += 7) gap |= ((b = body[pos++] as number) & 0x7f) << sh;
						// The count that follows is not needed: skip its varint.
						while ((body[pos++] as number) & 0x80);
						d += gap + 1;
						has.add(d);
					}
				}
				const prev: Set<number> | null = docs;
				docs = prev ? new Set<number>([...prev].filter((x: number) => has.has(x))) : has;
				if (!docs.size) break;
			}
			for (const d of docs ?? []) if (!dead?.[d]) out.push(part.path(d));
		}
		return out;
	}

	/** A live note's modified time as indexed, or undefined when the index does not have it. */
	mtimeOf(path: string): number | undefined {
		const p = this.pending.get(path);
		if (p) return p.mtime;
		const at = this.ids.get(path);
		return at ? at.s.seg.mtime[at.d] : undefined;
	}

	/** The paths and modified times of every live note (to catch up with the vault by mtime). */
	mtimes(): Array<[string, number]> {
		const out: Array<[string, number]> = [];
		for (const [path, at] of this.ids) out.push([path, at.s.seg.mtime[at.d] as number]);
		for (const n of this.pending.values()) out.push([n.path, n.mtime]);
		return out;
	}

	private reset(): void {
		this.segs = [];
		this.ids.clear();
		this.pending.clear();
		this.delta = null;
		this.deltaScratch = null;
		this.inboundByName = null;
	}

	private addPart(seg: Segment): SegPart {
		const part: SegPart = {
			seg,
			dead: new Uint8Array(seg.docCount),
			deadCount: 0,
			renamed: new Map(),
			scratch: new Scratch(seg.docCount),
		};
		this.segs.push(part);
		seg.paths.forEach((p, d) => this.ids.set(p, { s: part, d }));
		this.inboundByName = null;
		return part;
	}

	private kill(path: string): void {
		const at = this.ids.get(path);
		if (!at) return;
		this.ids.delete(path);
		this.markDead(at.s, at.d);
	}

	private markDead(part: SegPart, d: number): void {
		if (part.dead[d]) return;
		part.dead[d] = 1;
		part.deadCount++;
	}

	/** Inbound links by note name, from the frozen segments (for notes in the delta). */
	private inbound(): (name: string) => number {
		const byName = (this.inboundByName ??= (() => {
			const m = new Map<string, number>();
			for (const s of this.segs)
				s.seg.paths.forEach((p, d) =>
					m.set((p.split("/").pop() ?? p).replace(/\.md$/i, "").toLowerCase(), s.seg.inLinks[d] as number),
				);
			return m;
		})());
		return (name) => byName.get(name) ?? 0;
	}

	private rebuildDelta(): void {
		const notes = [...this.pending.values()];
		if (!notes.length) {
			this.delta = null;
			this.deltaScratch = null;
			return;
		}
		// The delta scores with the first segment's statistics, so its notes compare fairly.
		this.delta = new Segment(buildSegment(notes, this.inbound(), this.segs[0]?.seg.averages));
		this.deltaScratch = new Scratch(this.delta.docCount);
	}

	private parts(): Part[] {
		const out: Part[] = this.segs.map((s) => ({
			seg: s.seg,
			dead: s.dead,
			scratch: s.scratch,
			path: (d) => s.renamed.get(d) ?? (s.seg.paths[d] as string),
		}));
		const delta = this.delta;
		if (delta && this.deltaScratch)
			out.push({ seg: delta, dead: null, scratch: this.deltaScratch, path: (d) => delta.paths[d] as string });
		return out;
	}

	/** The term's document frequency in the other parts (for one idf across all of them). */
	private otherDf(seg: Segment, term: string): number {
		let n = 0;
		for (const s of this.segs)
			if (s.seg !== seg) {
				const t = exactTerm(s.seg, term);
				if (t >= 0) n += s.seg.df[t] as number;
			}
		if (this.delta && this.delta !== seg) {
			const t = exactTerm(this.delta, term);
			if (t >= 0) n += this.delta.df[t] as number;
		}
		return n;
	}
}

const exactTerm = (seg: Segment, word: string): number => {
	const terms = seg.terms;
	const i = lowerBound(terms, word);
	return terms[i] === word ? i : -1;
};

/** The index terms a typed word matches, with how much each counts; typos only when asked. */
const expand = (seg: Segment, word: string, isLast: boolean, config: EngineConfig, typos: boolean): Expansion[] => {
	const terms = seg.terms;
	const best = new Map<number, Expansion>();
	const put = (t: number, w: number, e: number): void => {
		const cur = best.get(t);
		if (!cur || w > cur.w) best.set(t, { t, w, e });
	};
	const exact = exactTerm(seg, word);
	if (exact >= 0) put(exact, EXACT, 0);
	// Typed with the article (المكتبة): also the word without it, which notes index.
	const bare = arabicBare(word);
	if (bare) {
		const b = exactTerm(seg, bare);
		if (b >= 0) put(b, EXACT * 0.95, 0);
	}
	const len = word.length;
	if (isLast && len >= 2) {
		const [from, to] = prefixRange(terms, word);
		let range = Array.from({ length: to - from }, (_, k) => from + k).filter((t) => t !== exact);
		if (range.length > PREFIX_LIMIT)
			range = range.sort((a, b) => (seg.df[b] as number) - (seg.df[a] as number)).slice(0, PREFIX_LIMIT);
		for (const t of range) put(t, PREFIX * Math.sqrt(len / (terms[t] as string).length), 0);
	}
	// One Chinese or Japanese character: the pairs that start or end with it (猫 in 我的猫很可爱).
	if (cjkChar(word)) {
		const [from, to] = prefixRange(terms, word);
		for (let t = from; t < to && t < from + PREFIX_LIMIT; t++) if (t !== exact) put(t, EXACT, 0);
		const rev = reversedTerms(seg);
		let k = 0;
		for (let lo = lowerBound(rev.keys, word); lo < rev.keys.length && k < PREFIX_LIMIT; lo++, k++) {
			if (!(rev.keys[lo] as string).startsWith(word)) break;
			const t = rev.ids[lo] as number;
			if (t !== exact && (terms[t] as string).length === 2) put(t, EXACT, 0);
		}
	}
	const budget = !typos || noTypos(word) ? 0 : typoBudget(word);
	if (budget > 0) {
		const fuzzy = isLast && len >= 4;
		let fuzzyCount = 0;
		for (const m of typoMatches(terms, word, budget, { fuzzyPrefix: fuzzy, prefixBudget: 1, limit: 500 })) {
			if (!m.prefix) put(m.index, m.edits === 1 ? TYPO1 : TYPO2, m.edits);
			else if (m.edits > 0 && fuzzyCount++ < FUZZY_LIMIT) put(m.index, FUZZY_PREFIX, m.edits);
		}
	}
	// Word forms: the root group of the word in each stemming language.
	for (const lang of config.stemming) {
		if (!stemmable(lang, word)) continue;
		const group = rootGroup(seg, lang, STEMMERS[lang](word));
		let k = 0;
		for (const t of group) {
			if (t === exact) continue;
			put(t, STEM, 0);
			if (++k >= STEM_LIMIT) break;
		}
	}
	// Compound parts, for compounding languages: compounds that start or end with the
	// word, where the rest is itself a word of the index (no dictionary needed).
	if (len >= 4 && !noTypos(word) && config.stemming.some((l) => COMPOUND_LANGS.has(l))) {
		const isWord = (s: string): boolean => s.length >= 3 && exactTerm(seg, s) >= 0;
		const rest = (r: string): boolean => LINKS.some((l) => r.startsWith(l) && isWord(r.slice(l.length)));
		let k = 0;
		const [from, to] = prefixRange(terms, word);
		for (let t = from; t < to && t < from + 2000 && k < COMPOUND_LIMIT; t++)
			if (t !== exact && rest((terms[t] as string).slice(len))) {
				put(t, COMPOUND, 0);
				k++;
			}
		const rev = reversedTerms(seg);
		const key = reverse(word);
		let lo = lowerBound(rev.keys, key);
		for (; lo < rev.keys.length && k < COMPOUND_LIMIT * 2; lo++) {
			const r = rev.keys[lo] as string;
			if (!r.startsWith(key)) break;
			const t = rev.ids[lo] as number;
			const head = (terms[t] as string).slice(0, -len);
			if (t !== exact && LINKS.some((l) => head.endsWith(l) && isWord(head.slice(0, head.length - l.length)))) {
				put(t, COMPOUND, 0);
				k++;
			}
		}
	}
	return [...best.values()];
};

/** Keeps the best `k` candidates by the ranking key: a small binary heap with the worst on top. */
class TopK {
	private readonly heap: Candidate[] = [];

	constructor(
		private readonly k: number,
		private readonly better: (a: Candidate, b: Candidate) => boolean,
	) {}

	push(c: Candidate): void {
		const h = this.heap;
		if (h.length < this.k) {
			h.push(c);
			this.up(h.length - 1);
		} else if (h[0] && this.better(c, h[0])) {
			h[0] = c;
			this.down(0);
		}
	}

	sorted(): Candidate[] {
		return [...this.heap].sort((a, b) => (this.better(a, b) ? -1 : this.better(b, a) ? 1 : 0));
	}

	private up(i: number): void {
		const h = this.heap;
		while (i > 0) {
			const p = (i - 1) >> 1;
			if (!this.better(h[p] as Candidate, h[i] as Candidate)) break;
			[h[p], h[i]] = [h[i] as Candidate, h[p] as Candidate];
			i = p;
		}
	}

	private down(i: number): void {
		const h = this.heap;
		for (;;) {
			const l = 2 * i + 1;
			const r = l + 1;
			let w = i;
			if (l < h.length && this.better(h[w] as Candidate, h[l] as Candidate)) w = l;
			if (r < h.length && this.better(h[w] as Candidate, h[r] as Candidate)) w = r;
			if (w === i) return;
			[h[w], h[i]] = [h[i] as Candidate, h[w] as Candidate];
			i = w;
		}
	}
}

/** How many notes link to each note name (lower case). */
export const countInbound = (notes: readonly NoteInput[]): Map<string, number> => {
	const m = new Map<string, number>();
	for (const n of notes)
		for (const t of new Set(n.linkTargets.map((x) => x.toLowerCase()))) m.set(t, (m.get(t) ?? 0) + 1);
	return m;
};
