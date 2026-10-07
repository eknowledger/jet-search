import { noTypos } from "./analyzer";
import type { NoteInput } from "./fields";
import { FIELDS } from "./fields";
import type { Query } from "./query";
import { B_BODY, buildSegment, K1, Segment } from "./segment";
import { lowerBound, prefixRange, typoBudget, typoMatches } from "./typos";

/** One result: the note, its score, how many query words it matched, and its typo edits in total. */
export type Hit = { path: string; score: number; matched: number; edits: number };
export type QueryResult = { hits: Hit[]; terms: string[] };
export type QueryOptions = {
	limit?: number;
	now?: number;
	allow?: (path: string) => boolean;
	/** Rank fewer typo edits first (default), or let the typo weights alone decide. */
	editsFirst?: boolean;
};

/** What the rest of Jet sees of an engine, so the engine can be swapped. */
export type SearchEngine = {
	build(notes: readonly NoteInput[]): void;
	upsert(note: NoteInput): void;
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
const FUZZY_LIMIT = 200;
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

/** Ranking key: more words matched, then fewer typo edits, then higher score. */
const byKey = (a: Candidate, b: Candidate): boolean =>
	a.matched !== b.matched ? a.matched > b.matched : a.edits !== b.edits ? a.edits < b.edits : a.score > b.score;
/** The weights-only order: words matched, then score (typos weigh in through their weights only). */
const byScore = (a: Candidate, b: Candidate): boolean =>
	a.matched !== b.matched ? a.matched > b.matched : a.score > b.score;

/**
 * Jet's engine: a frozen base segment, a small delta segment rebuilt from the
 * notes changed since, and tombstones over the base. Queries read both and skip tombstoned notes.
 * Pure: runs in the worker and in tests.
 */
export class JetEngine implements SearchEngine {
	private base: Segment | null = null;
	private dead = new Uint8Array(0);
	private deadCount = 0;
	private baseIds = new Map<string, number>();
	private renamed = new Map<number, string>();
	private pending = new Map<string, NoteInput>();
	private delta: Segment | null = null;
	private baseScratch: Scratch | null = null;
	private deltaScratch: Scratch | null = null;
	private baseByName: Map<string, number> | null = null;

	get size(): number {
		return (this.base?.docCount ?? 0) - this.deadCount + this.pending.size;
	}

	build(notes: readonly NoteInput[]): void {
		const inbound = countInbound(notes);
		this.setBase(new Segment(buildSegment(notes, (n) => inbound.get(n) ?? 0)));
	}

	upsert(note: NoteInput): void {
		this.kill(note.path);
		this.pending.set(note.path, note);
		this.rebuildDelta();
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
		const id = this.baseIds.get(from);
		if (id === undefined) return;
		this.baseIds.delete(from);
		this.baseIds.set(to, id);
		this.renamed.set(id, to);
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
		for (const part of parts) {
			const { seg, dead, scratch: s } = part;
			s.q++;
			const touchedQ: number[] = [];
			const avgBody = seg.averages[FIELDS.length] as number;
			for (let i = 0; i < n; i++) {
				const word = q.words[i] as string;
				s.w++;
				const touchedW: number[] = [];
				for (const x of expand(seg, word, q.lastIsPrefix && i === n - 1)) {
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
				const bit = 1 << Math.min(i, 31);
				for (const doc of touchedW) {
					if (s.qStamp[doc] !== s.q) {
						s.qStamp[doc] = s.q;
						s.total[doc] = 0;
						s.matched[doc] = 0;
						s.inName[doc] = 0;
						s.edits[doc] = 0;
						touchedQ.push(doc);
					}
					if (s.wInName[doc]) s.inName[doc] = (s.inName[doc] as number) | bit;
					s.total[doc] = (s.total[doc] as number) + (s.best[doc] as number);
					s.matched[doc] = (s.matched[doc] as number) | bit;
					s.edits[doc] = (s.edits[doc] as number) + (s.bestEdits[doc] as number);
				}
			}
			// Exclusions: notes with an excluded word are dropped.
			for (const word of q.excluded) {
				const t = exactTerm(seg, word);
				if (t < 0) continue;
				for (let k = seg.metaOff[t] as number, end = seg.metaOff[t + 1] as number; k < end; k++)
					s.xStamp[seg.metaDocs[k] as number] = s.q;
				seg.forBody(t, (doc) => (s.xStamp[doc] = s.q));
			}
			const allBits = n >= 32 ? 0xffffffff : (1 << n) - 1;
			for (const d of touchedQ) {
				if (s.xStamp[d] === s.q) continue;
				if (opts.allow && !opts.allow(part.path(d))) continue;
				candidates.push({
					part,
					d,
					matched: popcount(s.matched[d] as number),
					edits: s.edits[d] as number,
					score: s.total[d] as number,
					allInName: s.inName[d] === allBits,
				});
			}
		}
		// AND first; if no note has every word, notes with some, scaled by the share matched.
		const all = candidates.filter((c) => c.matched === n);
		const pool = all.length ? all : candidates;
		const typed = q.words.join(" ");
		const top = new TopK(limit, opts.editsFirst === false ? byScore : byKey);
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

	save(): { base: ArrayBuffer; sidecar: Uint8Array } {
		if (!this.base) throw new Error("nothing to save");
		const side = {
			dead: [...this.dead.keys()].filter((i) => this.dead[i]),
			renamed: [...this.renamed],
			pending: [...this.pending.values()],
		};
		return { base: this.base.buffer, sidecar: new TextEncoder().encode(JSON.stringify(side)) };
	}

	load(base: ArrayBuffer, sidecar?: Uint8Array): void {
		this.setBase(new Segment(base));
		if (!sidecar?.byteLength) return;
		const side = JSON.parse(new TextDecoder().decode(sidecar)) as {
			dead: number[];
			renamed: Array<[number, string]>;
			pending: NoteInput[];
		};
		for (const id of side.dead) this.markDead(id);
		for (const [id, path] of side.renamed) {
			const old = this.base?.paths[id];
			if (old !== undefined) this.baseIds.delete(old);
			this.baseIds.set(path, id);
			this.renamed.set(id, path);
		}
		for (const p of side.pending) this.pending.set(p.path, p);
		this.rebuildDelta();
	}

	private setBase(seg: Segment): void {
		this.base = seg;
		this.dead = new Uint8Array(seg.docCount);
		this.deadCount = 0;
		this.baseIds = new Map(seg.paths.map((p, i) => [p, i]));
		this.renamed.clear();
		this.pending.clear();
		this.delta = null;
		this.baseScratch = new Scratch(seg.docCount);
		this.deltaScratch = null;
		this.baseByName = null;
	}

	private kill(path: string): void {
		const id = this.baseIds.get(path);
		if (id === undefined) return;
		this.baseIds.delete(path);
		this.markDead(id);
	}

	private markDead(id: number): void {
		if (this.dead[id]) return;
		this.dead[id] = 1;
		this.deadCount++;
	}

	private rebuildDelta(): void {
		const notes = [...this.pending.values()];
		if (!notes.length) {
			this.delta = null;
			this.deltaScratch = null;
			return;
		}
		// The delta scores with the base's statistics, so its notes compare fairly with the base's.
		const base = this.base;
		const byName = (this.baseByName ??= new Map(
			(base?.paths ?? []).map((p, i) => [(p.split("/").pop() ?? p).replace(/\.md$/i, "").toLowerCase(), i]),
		));
		const inbound = (name: string): number => {
			const id = byName.get(name);
			return id === undefined ? 0 : (base?.inLinks[id] ?? 0);
		};
		this.delta = new Segment(buildSegment(notes, inbound, this.base?.averages));
		this.deltaScratch = new Scratch(this.delta.docCount);
	}

	private parts(): Part[] {
		const out: Part[] = [];
		const base = this.base;
		if (base && this.baseScratch)
			out.push({
				seg: base,
				dead: this.dead,
				scratch: this.baseScratch,
				path: (d) => this.renamed.get(d) ?? (base.paths[d] as string),
			});
		const delta = this.delta;
		if (delta && this.deltaScratch)
			out.push({ seg: delta, dead: null, scratch: this.deltaScratch, path: (d) => delta.paths[d] as string });
		return out;
	}

	/** The term's document frequency in the other segment (for one idf across base and delta). */
	private otherDf(seg: Segment, term: string): number {
		const other = seg === this.base ? this.delta : this.base;
		if (!other) return 0;
		const t = exactTerm(other, term);
		return t < 0 ? 0 : (other.df[t] as number);
	}
}

const popcount = (x: number): number => {
	let v = x - ((x >>> 1) & 0x55555555);
	v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
	return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};

const exactTerm = (seg: Segment, word: string): number => {
	const terms = seg.terms;
	const i = lowerBound(terms, word);
	return terms[i] === word ? i : -1;
};

/** The index terms a typed word matches, with how much each counts. */
const expand = (seg: Segment, word: string, isLast: boolean): Expansion[] => {
	const terms = seg.terms;
	const best = new Map<number, Expansion>();
	const put = (t: number, w: number, e: number): void => {
		const cur = best.get(t);
		if (!cur || w > cur.w) best.set(t, { t, w, e });
	};
	const exact = exactTerm(seg, word);
	if (exact >= 0) put(exact, EXACT, 0);
	const len = word.length;
	if (isLast && len >= 2) {
		const [from, to] = prefixRange(terms, word);
		let range = Array.from({ length: to - from }, (_, k) => from + k).filter((t) => t !== exact);
		if (range.length > PREFIX_LIMIT)
			range = range.sort((a, b) => (seg.df[b] as number) - (seg.df[a] as number)).slice(0, PREFIX_LIMIT);
		for (const t of range) put(t, PREFIX * Math.sqrt(len / (terms[t] as string).length), 0);
	}
	const budget = noTypos(word) ? 0 : typoBudget(word);
	if (budget > 0) {
		const fuzzy = isLast && len >= 4;
		let fuzzyCount = 0;
		for (const m of typoMatches(terms, word, budget, { fuzzyPrefix: fuzzy, prefixBudget: 1, limit: 500 })) {
			if (!m.prefix) put(m.index, m.edits === 1 ? TYPO1 : TYPO2, m.edits);
			else if (m.edits > 0 && fuzzyCount++ < FUZZY_LIMIT) put(m.index, FUZZY_PREFIX, m.edits);
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
