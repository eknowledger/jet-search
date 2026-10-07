/**
 * Tier 0: note names, aliases and paths matched on the main thread, synchronously, on
 * every keystroke, before the worker answers.
 *
 * Every typed word must match one field of a note, in any order: the name or an alias, or, when neither
 * matches, the path (each word in its folder or its file name). A word matches, best first, as an exact
 * word, a word prefix, a contiguous substring, a fuzzy subsequence (`ptspec` → Pattern Spec), or, for
 * words of 4+ letters with no other match, within the typo budget of a word or word prefix with the first
 * letter fixed. Compound names are split (`nebula sdk` → NebulaSDK) and joined
 * (`nebulasdk` → Nebula SDK). Exact name or alias matches rank first; highlight ranges
 * point into the text as written.
 *
 * Everything that depends only on the notes is folded when a note is added; folders are folded once and
 * shared, and scored once per query. A keystroke allocates only its parsed words and the hits it returns.
 */
import { noTypos } from "../engine/analyzer";
import { lowerBound, typoBudget, typoMatches } from "../engine/typos";
import { bitOf, fold, type Folded, foldWord, hasCjk, PART_END, STRONG, TOKEN_END, WORD } from "./fold";

/** A note as Tier 0 sees it. */
export type NameItem = { id: number; name: string; aliases: readonly string[]; path: string };

/** One matched note: the field that matched, its text, and [start, end) offsets into it to highlight. */
export type NameHit = {
	id: number;
	score: number;
	field: "name" | "alias" | "path";
	text: string;
	ranges: Array<[number, number]>;
	/** The typed text equals the name or an alias (ignoring case, accents and punctuation). */
	exact: boolean;
};

/** Match kinds, best first; each word scores its tier plus 0–99 within it. */
const EXACT = 400;
const PREFIX = 300;
const SUBSTRING = 200;
const FUZZY = 100;
const TYPO = 0;
/** Field preference: the same match counts a little less in an alias, and less again in the path. */
const ALIAS_BIAS = -5;
const PATH_BIAS = -20;
/** The field code of a path hit (0 is the name, k + 1 the k-th alias). */
const PATH = -1;

/** Fuzzy alignment limits: folded units searched, query letters, letters skipped inside a word. */
const MAX_N = 256;
const MAX_Q = 32;
const MAX_GAP = 3;
/** Fuzzy scoring, fzf-style: a gap costs to open and per letter; a run earns per letter. */
const GAP_OPEN = 6;
const GAP_EXT = 1;
const RUN = 3;
/** The longest text folded (offsets are kept as 16-bit numbers). */
const MAX_TEXT = 4096;
/** Query words whose folder scores are cached per query. */
const MAX_WORDS = 16;
const DEFAULT_LIMIT = 50;
const TYPO_LIMIT = 2000;

/** A folded name, alias, folder or file name. */
type Text = {
	text: string;
	sq: string;
	/** Flags at [0, n), source starts at [n, 2n), ends at [2n, 3n), then `terms` × [id low, id high, start, length]. */
	data: Uint16Array;
	terms: number;
	/** Letters present, and letters that start a word (see `bitOf`). */
	mask: number;
	starts: number;
	/** Field preference and a small cost for length (names and aliases). */
	bias: number;
};

/** A folder shared by the notes in it, with its slot in the per-query score cache. */
type Dir = Text & { slot: number; refs: number };

type Entry = {
	id: number;
	name: Text | null;
	aliases: Text[];
	path: string;
	dir: Dir | null;
	/** The file name part of the path (the name's `Text` when they are the same string), and its offset. */
	base: Text | null;
	baseAt: number;
	/** Whether the path can match where the name does not (it has a folder, or a different file name). */
	pathful: boolean;
	pathBias: number;
};

type Word = {
	text: string;
	mask: number;
	first: number;
	short: boolean;
	cjk: boolean;
	/** Vocabulary words within the typo budget (see `NameIndex.markTypos`), or null. */
	marks: Uint8Array | null;
};

const clamp = (s: number): number => (s < 0 ? 0 : s > 99 ? 99 : s);

const makeWord = (text: string): Word => {
	let mask = 0;
	for (let i = 0; i < text.length; i++) mask |= bitOf(text.charCodeAt(i));
	return { text, mask, first: bitOf(text.charCodeAt(0)), short: text.length <= 2, cjk: hasCjk(text), marks: null };
};

/** Penalty for a match starting late in the text. */
const late = (data: Uint16Array, n: number, j: number): number => 0.5 * Math.min(data[n + j] as number, 40);

/**
 * The best contiguous occurrence of `w` in a text, scored with its tier, or -1. With `startsOnly` (one
 * or two letters) it must begin at a word start. One that begins inside a word and runs on into the
 * next is left to the fuzzy pass. Pushes its [start, end) in folded units to `rec`.
 */
const contiguous = (t: Text, w: string, startsOnly: boolean, rec: number[] | null): number => {
	const { sq, data } = t;
	const n = sq.length;
	const m = w.length;
	let best = -1;
	let bestAt = -1;
	for (let p = sq.indexOf(w); p >= 0; p = sq.indexOf(w, p + 1)) {
		const f = data[p] as number;
		const lead = f & STRONG ? 10 : f & WORD ? 6 : 0;
		if (!lead && startsOnly) continue;
		let cross = 0;
		for (let j = p + 1; j < p + m; j++) if ((data[j] as number) & STRONG) cross++;
		if (!lead && cross) continue;
		const last = data[p + m - 1] as number;
		let s = 50 + lead - 4 * cross - late(data, n, p);
		let tier = SUBSTRING;
		if (lead && last & PART_END) {
			tier = EXACT;
			s += last & TOKEN_END ? 20 : 15;
		} else if (lead) {
			tier = PREFIX;
			let e = p + m;
			while (e < n && !((data[e] as number) & STRONG)) e++;
			s += (10 * m) / (e - p);
		}
		const score = tier + clamp(s);
		if (score > best) {
			best = score;
			bestAt = p;
		}
	}
	if (rec && bestAt >= 0) rec.push(bestAt, bestAt + m);
	return best;
};

/** Fuzzy alignment scratch: per query letter, candidate positions, their best scores and back links. */
const dpPos = new Int32Array(MAX_Q * MAX_N);
const dpScore = new Float64Array(MAX_Q * MAX_N);
const dpBack = new Int32Array(MAX_Q * MAX_N);
const dpCount = new Int32Array(MAX_Q);

/**
 * The best fuzzy alignment of `w` in a text (a sparse dynamic program over the positions of each
 * letter), as a raw score, or -Infinity. Letters appear in order, the first at a word start; each later
 * piece continues the run, starts at a word start, or skips at most `MAX_GAP` letters. Word-start pieces
 * earn a bonus (the first one double); gaps and late starts cost. Pushes the runs to `rec`.
 */
const fuzzy = (t: Text, w: string, rec: number[] | null): number => {
	const { sq, data } = t;
	const n0 = sq.length;
	const n = Math.min(n0, MAX_N);
	const m = w.length;
	if (m > MAX_Q || m > n) return -Infinity;
	const c0 = w.charAt(0);
	let cnt = 0;
	for (let j = sq.indexOf(c0); j >= 0 && j <= n - m; j = sq.indexOf(c0, j + 1)) {
		const f = data[j] as number;
		if (!(f & WORD)) continue;
		dpPos[cnt] = j;
		dpScore[cnt] = (f & STRONG ? 20 : 16) - late(data, n0, j);
		cnt++;
	}
	if (!cnt) return -Infinity;
	// Cheap rejection first: the letters must at least appear in order after the first candidate.
	for (let k = 1, g = dpPos[0] as number; k < m; k++) {
		g = sq.indexOf(w.charAt(k), g + 1);
		if (g < 0 || g > n - m + k) return -Infinity;
	}
	dpCount[0] = cnt;
	for (let k = 1; k < m; k++) {
		const prev = (k - 1) * MAX_N;
		const row = k * MAX_N;
		const prevCount = dpCount[k - 1] as number;
		const ck = w.charAt(k);
		const lim = n - m + k;
		cnt = 0;
		let ptr = 0;
		let runMax = -Infinity;
		let runArg = -1;
		for (let j = sq.indexOf(ck, (dpPos[prev] as number) + 1); j >= 0 && j <= lim; j = sq.indexOf(ck, j + 1)) {
			// Best earlier candidate for a jump here: max of score + GAP_EXT × position over positions ≤ j - 2.
			while (ptr < prevCount && (dpPos[prev + ptr] as number) <= j - 2) {
				const v = (dpScore[prev + ptr] as number) + GAP_EXT * (dpPos[prev + ptr] as number);
				if (v > runMax) {
					runMax = v;
					runArg = ptr;
				}
				ptr++;
			}
			const f = data[j] as number;
			let best = -Infinity;
			let arg = -1;
			if (ptr < prevCount && dpPos[prev + ptr] === j - 1) {
				// The run goes on (across a removed separator it is a new word, worth a little less).
				best = (dpScore[prev + ptr] as number) + (f & STRONG ? RUN - 1 : RUN);
				arg = ptr;
			}
			if (f & WORD) {
				const v = runMax - GAP_EXT * (j - 1) - GAP_OPEN + (f & STRONG ? 10 : 8);
				if (runArg >= 0 && v > best) {
					best = v;
					arg = runArg;
				}
			} else {
				for (let x = ptr - 1; x >= 0 && (dpPos[prev + x] as number) >= j - 1 - MAX_GAP; x--) {
					const v =
						(dpScore[prev + x] as number) - GAP_OPEN - GAP_EXT * (j - (dpPos[prev + x] as number) - 1);
					if (v > best) {
						best = v;
						arg = x;
					}
				}
			}
			if (arg < 0) continue;
			dpPos[row + cnt] = j;
			dpScore[row + cnt] = best;
			dpBack[row + cnt] = arg;
			cnt++;
		}
		if (!cnt) return -Infinity;
		dpCount[k] = cnt;
	}
	const last = (m - 1) * MAX_N;
	let best = -Infinity;
	let arg = 0;
	for (let x = 0; x < cnt; x++)
		if ((dpScore[last + x] as number) > best) {
			best = dpScore[last + x] as number;
			arg = x;
		}
	if (rec) {
		// Walk the back links from the last letter, then emit the runs left to right.
		const runs: number[] = [];
		let runStart = -1;
		let runEnd = -1;
		for (let k = m - 1; k >= 0; k--) {
			const j = dpPos[k * MAX_N + arg] as number;
			if (runStart === j + 1) runStart = j;
			else {
				if (runEnd >= 0) runs.push(runStart, runEnd);
				runStart = j;
				runEnd = j + 1;
			}
			arg = dpBack[k * MAX_N + arg] as number;
		}
		runs.push(runStart, runEnd);
		for (let x = runs.length - 2; x >= 0; x -= 2) rec.push(runs[x] as number, runs[x + 1] as number);
	}
	return best;
};

/** The best typo match among a text's words marked for this query word, or -1. */
const typo = (t: Text, marks: Uint8Array, m: number, rec: number[] | null): number => {
	const { data } = t;
	const n = t.sq.length;
	let best = -1;
	let bestAt = 0;
	let bestLen = 0;
	for (let i = 0, b = 3 * n; i < t.terms; i++, b += 4) {
		const mark = marks[(data[b] as number) + 65536 * (data[b + 1] as number)];
		if (!mark) continue;
		const edits = (mark - 1) >> 1;
		const prefix = (mark - 1) & 1;
		const st = data[b + 2] as number;
		const len = data[b + 3] as number;
		const lead = (data[st] as number) & STRONG ? 10 : 6;
		const s = TYPO + clamp(60 - 15 * edits - 10 * prefix + lead - late(data, n, st));
		if (s > best) {
			best = s;
			bestAt = st;
			bestLen = prefix ? Math.min(m, len) : len;
		}
	}
	if (rec && best >= 0) rec.push(bestAt, bestAt + bestLen);
	return best;
};

/** One word's best match in a text, with its tier, or -1. */
const score = (t: Text, w: Word, rec: number[] | null): number => {
	if ((t.mask & w.mask) === w.mask) {
		const c = contiguous(t, w.text, w.short && !w.cjk, rec);
		if (c >= 0) return c;
		if (!w.cjk && !w.short && t.starts & w.first) {
			const z = fuzzy(t, w.text, rec);
			if (z > -Infinity) return FUZZY + clamp(50 + z);
		}
	}
	if (w.marks && t.starts & w.first) return typo(t, w.marks, w.text.length, rec);
	return -1;
};

/** Every word's score in a name or alias summed with its bias, or -Infinity; word scores go to `out`. */
const scoreAll = (t: Text, words: readonly Word[], out: Float64Array | null): number => {
	let s = t.bias;
	for (let x = 0; x < words.length; x++) {
		const ws = score(t, words[x] as Word, null);
		if (out) out[x] = ws;
		if (ws < 0) {
			if (out) out.fill(Number.NaN, x + 1, words.length);
			return -Infinity;
		}
		s += ws;
	}
	return s;
};

/** Folded-unit ranges of a text to [start, end) ranges of the original, split at removed separators. */
const toRanges = (t: Text, rec: readonly number[], offset: number, out: Array<[number, number]>): void => {
	const { data } = t;
	const n = t.sq.length;
	for (let r = 0; r < rec.length; r += 2) {
		let a = -1;
		let b = -1;
		for (let j = rec[r] as number; j < (rec[r + 1] as number); j++) {
			const s = offset + (data[n + j] as number);
			const e = offset + (data[2 * n + j] as number);
			if (a < 0) {
				a = s;
				b = e;
			} else if (s <= b) b = Math.max(b, e);
			else {
				out.push([a, b]);
				a = s;
				b = e;
			}
		}
		if (a >= 0) out.push([a, b]);
	}
};

/** Ranges sorted, with overlapping and touching ones merged. */
const merged = (raw: Array<[number, number]>): Array<[number, number]> => {
	raw.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
	const out: Array<[number, number]> = [];
	for (const r of raw) {
		const last = out[out.length - 1];
		if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
		else out.push([r[0], r[1]]);
	}
	return out;
};

/**
 * A text's words for typo search, as [start, length] pairs: each compound part and each token of
 * several parts, of 3+ letters, in scripts where typos are tolerated.
 */
const wordsOf = (f: Folded): number[] => {
	const out: number[] = [];
	const keep = (st: number, len: number): void => {
		if (len >= 3 && !noTypos(f.sq.slice(st, st + len))) out.push(st, len);
	};
	let part = 0;
	let token = 0;
	let parts = 0;
	for (let j = 0; j < f.flags.length; j++) {
		const flag = f.flags[j] as number;
		if (flag & PART_END) {
			keep(part, j + 1 - part);
			parts++;
			part = j + 1;
		}
		if (flag & TOKEN_END) {
			if (parts > 1) keep(token, j + 1 - token);
			token = j + 1;
			parts = 0;
		}
	}
	return out;
};

/** Where the matched part of a path ends: the extension is left out. */
const pathEnd = (path: string): number => {
	const dot = path.lastIndexOf(".");
	return dot > path.lastIndexOf("/") + 1 ? dot : path.length;
};

/** Whether candidate a ranks below b: exact first, then score, then shorter text, then lower id. */
const worse = (ea: number, sa: number, la: number, ia: number, eb: number, sb: number, lb: number, ib: number) =>
	ea !== eb ? ea < eb : sa !== sb ? sa < sb : la !== lb ? la > lb : ia > ib;

const swap = (arr: Uint8Array | Int32Array | Float64Array, a: number, b: number): void => {
	const t = arr[a] as number;
	arr[a] = arr[b] as number;
	arr[b] = t;
};

/**
 * The names index: every note's name, aliases and path folded once, with a sorted vocabulary of their
 * words for typo search. Kept current with `upsert` / `remove` on create, rename and delete.
 */
export class NameIndex {
	private entries: Entry[] = [];
	private slots = new Map<number, number>();
	private dirs = new Map<string, Dir>();
	private freeDirSlots: number[] = [];
	private dirSlots = 0;
	private termIds = new Map<string, number>();
	private termText: string[] = [];
	private termRefs: number[] = [];
	/** Live words, sorted by UTF-16 code unit (as `typoMatches` expects). */
	private sorted: string[] = [];
	private bulk = false;
	/** Per query word slot: marks of vocabulary words within the typo budget, and which were set. */
	private marks: Uint8Array[] = [];
	private touched: number[][] = [];
	/** Folder scores of the current query, by folder slot × word, valid where the stamp is `serial`. */
	private dirStamp = new Int32Array(0);
	private dirScore = new Float64Array(0);
	private serial = 0;
	/** The name's word scores for the entry being matched (reused for a file name equal to it). */
	private nameScores = new Float64Array(MAX_WORDS);
	// The best hits so far: a heap with the worst on top, as parallel arrays.
	private hExact = new Uint8Array(0);
	private hScore = new Float64Array(0);
	private hLen = new Int32Array(0);
	private hId = new Float64Array(0);
	private hEntry = new Int32Array(0);
	private hField = new Int32Array(0);
	private hSize = 0;
	private hCap = 0;

	/** Builds the index from the notes (a later item with the same id replaces an earlier one). */
	constructor(items: readonly NameItem[] = []) {
		this.bulk = true;
		for (const item of items) this.upsert(item);
		this.bulk = false;
		this.sorted = this.termText.filter((_, i) => (this.termRefs[i] as number) > 0).sort();
	}

	/** Add or replace an item (keeps the index current on create/rename). */
	upsert(item: NameItem): void {
		const slot = this.slots.get(item.id);
		const entry = this.build(item);
		if (slot === undefined) {
			this.slots.set(item.id, this.entries.length);
			this.entries.push(entry);
			return;
		}
		this.release(this.entries[slot] as Entry);
		this.entries[slot] = entry;
	}

	/** Remove an item by id (no-op when absent). */
	remove(id: number): void {
		const slot = this.slots.get(id);
		if (slot === undefined) return;
		this.release(this.entries[slot] as Entry);
		const last = this.entries.pop() as Entry;
		this.slots.delete(id);
		if (last.id !== id) {
			this.entries[slot] = last;
			this.slots.set(last.id, slot);
		}
	}

	/** Number of items. */
	get size(): number {
		return this.entries.length;
	}

	/** Best matches for the typed text, best first. `allow` limits candidates (a scope). */
	match(query: string, opts: { limit?: number; allow?: (id: number) => boolean } = {}): NameHit[] {
		const limit = Math.min(Math.floor(opts.limit ?? DEFAULT_LIMIT), this.entries.length);
		if (!(limit > 0)) return [];
		const words: Word[] = [];
		for (const raw of query.split(/\s+/)) {
			const text = raw ? foldWord(raw) : "";
			if (text) words.push(makeWord(text));
		}
		if (!words.length) return [];
		const joined = words.map((w) => w.text).join("");
		const whole = words.length === 1 ? (words[0] as Word) : makeWord(joined);
		// The longest word first: the likeliest to rule a field out.
		words.sort((a, b) => b.text.length - a.text.length);
		if (this.nameScores.length < words.length) this.nameScores = new Float64Array(words.length);
		this.serial++;
		try {
			this.markTypos(words);
			// Letters a name must have (words that can only match as typed), and its word starts.
			let strict = 0;
			let starts = 0;
			for (const w of words) {
				if (!w.marks) strict |= w.mask;
				if (w.short && !w.cjk) starts |= w.first;
			}
			this.heapReset(limit);
			const allow = opts.allow;
			const entries = this.entries;
			const nameScores = this.nameScores;
			for (let i = 0; i < entries.length; i++) {
				const e = entries[i] as Entry;
				if (allow && !allow(e.id)) continue;
				let best = -Infinity;
				let field = 0;
				let exact = 0;
				let len = 0;
				const name = e.name;
				let scored = false;
				if (name) {
					if (name.sq === joined) {
						best = score(name, whole, null) + name.bias;
						exact = 1;
						len = name.text.length;
					} else if ((name.mask & strict) === strict && (name.starts & starts) === starts) {
						best = scoreAll(name, words, nameScores);
						scored = true;
						len = name.text.length;
					}
				}
				const aliases = e.aliases;
				for (let a = 0; a < aliases.length; a++) {
					const t = aliases[a] as Text;
					let s: number;
					let ex = 0;
					if (t.sq === joined) {
						s = score(t, whole, null) + t.bias;
						ex = 1;
					} else if (exact || (t.mask & strict) !== strict || (t.starts & starts) !== starts) continue;
					else s = scoreAll(t, words, null);
					if (ex > exact || (ex === exact && s > best)) {
						best = s;
						field = a + 1;
						exact = ex;
						len = t.text.length;
					}
				}
				if (best === -Infinity && e.pathful) {
					best = this.pathScore(e, words, scored, null, null);
					field = PATH;
					len = e.path.length;
				}
				if (best > -Infinity) this.offer(exact, best, len, e.id, i, field);
			}
			return this.collect(words, whole);
		} finally {
			this.clearTypos();
		}
	}

	/**
	 * A path's score: every word in its folder (scored once per query) or its file name (the name's
	 * scores when the file name is the name, `named` telling whether they were worked out), or -Infinity.
	 * With `recDir` / `recBase`, records where each word matched.
	 */
	private pathScore(
		e: Entry,
		words: readonly Word[],
		named: boolean,
		recDir: number[] | null,
		recBase: number[] | null,
	): number {
		const { dir, base } = e;
		const reuse = named && base === e.name;
		let s = e.pathBias;
		for (let x = 0; x < words.length; x++) {
			const w = words[x] as Word;
			const sd = dir ? this.folderScore(dir, w, x) : -1;
			let sb = -1;
			if (base) {
				const known = reuse ? (this.nameScores[x] as number) : Number.NaN;
				sb = Number.isNaN(known) ? score(base, w, null) : known;
			}
			const ws = sd > sb ? sd : sb;
			if (ws < 0) return -Infinity;
			if (recDir && recBase) {
				if (sd > sb) score(dir as Dir, w, recDir);
				else score(base as Text, w, recBase);
			}
			s += ws;
		}
		return s;
	}

	/** A word's score in a folder, worked out once per query and folder. */
	private folderScore(dir: Dir, w: Word, x: number): number {
		if (x >= MAX_WORDS) return score(dir, w, null);
		const k = dir.slot * MAX_WORDS + x;
		if (this.dirStamp[k] === this.serial) return this.dirScore[k] as number;
		const s = score(dir, w, null);
		this.dirStamp[k] = this.serial;
		this.dirScore[k] = s;
		return s;
	}

	/** Marks the vocabulary words within the typo budget of each long enough query word. */
	private markTypos(words: Word[]): void {
		let slot = 0;
		for (const w of words) {
			w.marks = null;
			const budget = w.cjk || noTypos(w.text) ? 0 : typoBudget(w.text);
			if (!budget) continue;
			const found = typoMatches(this.sorted, w.text, budget, {
				fuzzyPrefix: true,
				prefixBudget: 1,
				limit: TYPO_LIMIT,
			});
			if (!found.length) continue;
			let marks = this.marks[slot];
			if (!marks || marks.length < this.termText.length) {
				marks = new Uint8Array(Math.ceil(this.termText.length * 1.5) + 16);
				this.marks[slot] = marks;
			}
			const touched = this.touched[slot] ?? (this.touched[slot] = []);
			for (const t of found) {
				const id = this.termIds.get(this.sorted[t.index] as string);
				if (id === undefined) continue;
				marks[id] = 1 + 2 * t.edits + (t.prefix ? 1 : 0);
				touched.push(id);
			}
			w.marks = marks;
			slot++;
		}
	}

	private clearTypos(): void {
		for (let s = 0; s < this.touched.length; s++) {
			const marks = this.marks[s];
			const touched = this.touched[s] as number[];
			if (marks) for (const id of touched) marks[id] = 0;
			touched.length = 0;
		}
	}

	private heapReset(cap: number): void {
		if (this.hScore.length < cap) {
			this.hExact = new Uint8Array(cap);
			this.hScore = new Float64Array(cap);
			this.hLen = new Int32Array(cap);
			this.hId = new Float64Array(cap);
			this.hEntry = new Int32Array(cap);
			this.hField = new Int32Array(cap);
		}
		this.hSize = 0;
		this.hCap = cap;
	}

	private hWorse(a: number, b: number): boolean {
		const { hExact: e, hScore: s, hLen: l, hId: d } = this;
		return worse(
			e[a] as number,
			s[a] as number,
			l[a] as number,
			d[a] as number,
			e[b] as number,
			s[b] as number,
			l[b] as number,
			d[b] as number,
		);
	}

	private hSet(i: number, exact: number, score: number, len: number, id: number, entry: number, field: number) {
		this.hExact[i] = exact;
		this.hScore[i] = score;
		this.hLen[i] = len;
		this.hId[i] = id;
		this.hEntry[i] = entry;
		this.hField[i] = field;
	}

	private hSwap(a: number, b: number): void {
		swap(this.hExact, a, b);
		swap(this.hScore, a, b);
		swap(this.hLen, a, b);
		swap(this.hId, a, b);
		swap(this.hEntry, a, b);
		swap(this.hField, a, b);
	}

	/** Keeps a candidate if it is among the best `limit` so far. */
	private offer(exact: number, score: number, len: number, id: number, entry: number, field: number): void {
		if (this.hSize < this.hCap) {
			let i = this.hSize++;
			this.hSet(i, exact, score, len, id, entry, field);
			while (i > 0) {
				const up = (i - 1) >> 1;
				if (!this.hWorse(i, up)) break;
				this.hSwap(i, up);
				i = up;
			}
			return;
		}
		const { hExact: e, hScore: s, hLen: l, hId: d } = this;
		if (!worse(e[0] as number, s[0] as number, l[0] as number, d[0] as number, exact, score, len, id)) return;
		this.hSet(0, exact, score, len, id, entry, field);
		let i = 0;
		for (;;) {
			const left = 2 * i + 1;
			const right = left + 1;
			let w = i;
			if (left < this.hSize && this.hWorse(left, w)) w = left;
			if (right < this.hSize && this.hWorse(right, w)) w = right;
			if (w === i) break;
			this.hSwap(i, w);
			i = w;
		}
	}

	/** The kept candidates, best first, with highlight ranges worked out for them only. */
	private collect(words: readonly Word[], whole: Word): NameHit[] {
		const order = Array.from({ length: this.hSize }, (_, i) => i);
		order.sort((a, b) => (this.hWorse(a, b) ? 1 : this.hWorse(b, a) ? -1 : 0));
		return order.map((h): NameHit => {
			const e = this.entries[this.hEntry[h] as number] as Entry;
			const field = this.hField[h] as number;
			const exact = this.hExact[h] === 1;
			const raw: Array<[number, number]> = [];
			let text = e.path;
			if (field === PATH) {
				const recDir: number[] = [];
				const recBase: number[] = [];
				this.pathScore(e, words, false, recDir, recBase);
				if (e.dir) toRanges(e.dir, recDir, 0, raw);
				if (e.base) toRanges(e.base, recBase, e.baseAt, raw);
			} else {
				const t = (field === 0 ? e.name : e.aliases[field - 1]) as Text;
				const rec: number[] = [];
				if (exact) score(t, whole, rec);
				else for (const w of words) score(t, w, rec);
				toRanges(t, rec, 0, raw);
				text = t.text;
			}
			return {
				id: e.id,
				score: this.hScore[h] as number,
				field: field === PATH ? "path" : field === 0 ? "name" : "alias",
				text,
				ranges: merged(raw),
				exact,
			};
		});
	}

	/** Folds an item's name, aliases and path, sharing its folder with other notes. */
	private build(item: NameItem): Entry {
		const name = item.name ? this.text(item.name, 0) : null;
		const aliases: Text[] = [];
		const seen = new Set<string>(name ? [name.sq] : []);
		for (const a of item.aliases) {
			const t = a ? this.text(a, ALIAS_BIAS) : null;
			if (!t) continue;
			if (seen.has(t.sq)) this.drop(t);
			else {
				seen.add(t.sq);
				aliases.push(t);
			}
		}
		const path = item.path;
		const end = pathEnd(path);
		const slash = path.lastIndexOf("/", end - 1);
		const dirText = slash > 0 ? path.slice(0, slash) : "";
		let dir: Dir | null = null;
		if (dirText) {
			dir = this.dirs.get(dirText) ?? null;
			if (!dir) {
				const t = this.text(dirText, 0);
				if (t) {
					dir = { ...t, slot: this.freeDirSlots.pop() ?? this.dirSlots++, refs: 0 };
					this.dirs.set(dirText, dir);
					this.growDirCache();
				}
			}
			if (dir) dir.refs++;
		}
		const baseText = path.slice(slash + 1, end);
		const base = name && baseText === item.name ? name : baseText ? this.text(baseText, 0) : null;
		return {
			id: item.id,
			name,
			aliases,
			path,
			dir,
			base,
			baseAt: slash + 1,
			pathful: dir !== null || (base !== null && base !== name),
			pathBias: PATH_BIAS - 0.1 * Math.min(path.length, 100),
		};
	}

	private growDirCache(): void {
		const need = this.dirSlots * MAX_WORDS;
		if (this.dirStamp.length >= need) return;
		const size = Math.max(need, 2 * this.dirStamp.length);
		const stamp = new Int32Array(size);
		stamp.set(this.dirStamp);
		const scores = new Float64Array(size);
		scores.set(this.dirScore);
		this.dirStamp = stamp;
		this.dirScore = scores;
	}

	/** A string folded into a `Text`, its words taken into the vocabulary; null when nothing is left. */
	private text(s: string, kindBias: number): Text | null {
		const f = fold(s, Math.min(s.length, MAX_TEXT));
		const n = f.sq.length;
		if (!n) return null;
		const words = wordsOf(f);
		const data = new Uint16Array(3 * n + 2 * words.length);
		let mask = 0;
		let starts = 0;
		for (let j = 0; j < n; j++) {
			const bit = bitOf(f.sq.charCodeAt(j));
			const flag = f.flags[j] as number;
			mask |= bit;
			if (flag & WORD) starts |= bit;
			data[j] = flag;
			data[n + j] = f.start[j] as number;
			data[2 * n + j] = f.end[j] as number;
		}
		for (let t = 0, o = 3 * n; t < words.length; t += 2, o += 4) {
			const st = words[t] as number;
			const len = words[t + 1] as number;
			const id = this.acquire(f.sq.slice(st, st + len));
			data[o] = id & 0xffff;
			data[o + 1] = Math.floor(id / 65536);
			data[o + 2] = st;
			data[o + 3] = len;
		}
		const bias = kindBias - 0.1 * Math.min(s.length, 100);
		return { text: s, sq: f.sq, data, terms: words.length / 2, mask, starts, bias };
	}

	private acquire(word: string): number {
		let id = this.termIds.get(word);
		if (id === undefined) {
			id = this.termText.length;
			this.termIds.set(word, id);
			this.termText.push(word);
			this.termRefs.push(0);
		}
		const refs = this.termRefs[id] as number;
		this.termRefs[id] = refs + 1;
		if (refs === 0 && !this.bulk) this.sorted.splice(lowerBound(this.sorted, word), 0, word);
		return id;
	}

	/** Gives a text's words back to the vocabulary; words no note uses any more leave the sorted list. */
	private drop(t: Text): void {
		const { data } = t;
		for (let i = 0, b = 3 * t.sq.length; i < t.terms; i++, b += 4) {
			const id = (data[b] as number) + 65536 * (data[b + 1] as number);
			const refs = (this.termRefs[id] as number) - 1;
			this.termRefs[id] = refs;
			if (refs > 0 || this.bulk) continue;
			const word = this.termText[id] as string;
			const at = lowerBound(this.sorted, word);
			if (this.sorted[at] === word) this.sorted.splice(at, 1);
		}
	}

	private release(e: Entry): void {
		if (e.name) this.drop(e.name);
		for (const a of e.aliases) this.drop(a);
		if (e.base && e.base !== e.name) this.drop(e.base);
		const dir = e.dir;
		if (dir && --dir.refs === 0) {
			this.drop(dir);
			this.dirs.delete(dir.text);
			this.freeDirSlots.push(dir.slot);
			// A reused slot must not see this folder's cached scores.
			this.dirStamp.fill(0, dir.slot * MAX_WORDS, (dir.slot + 1) * MAX_WORDS);
		}
	}
}
