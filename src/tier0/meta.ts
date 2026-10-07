/**
 * Tier 0 before the index: while the first build runs, notes are also
 * found by their headings, tags and properties, taken from Obsidian's metadata cache, which needs no
 * index. Every typed word must start a word of one field (the order does not matter); case and accents
 * are folded; Chinese and Japanese match anywhere. All fields are folded once into one string, so a
 * keystroke is a native `indexOf` scan for its longest word plus a check of the few fields it hits.
 * Built when a search runs during a build, dropped when the build ends.
 */
import { normalize } from "../engine/analyzer";
import { hasCjk } from "./fold";

/** One heading, tag (`#tag`) or property (`key: value`) of a note. */
export type MetaField = { kind: "heading" | "tag" | "property"; text: string };
export type MetaNote = { path: string; fields: readonly MetaField[] };
/** A note found by one of its fields, with [start, end) ranges of the typed words in the field's text. */
export type MetaHit = { path: string; field: MetaField; marks: Array<[number, number]>; score: number };

/** Headings say most about a note, then tags, then property values. */
const KIND_WEIGHT: Record<MetaField["kind"], number> = { heading: 3, tag: 2, property: 1 };
const WORD_CHAR = /[\p{L}\p{N}]/u;
/** A scan stops after this many matching fields, or this many fields looked at, so a word that is
 * in nearly every note ("status" in frontmatter) stays cheap. Only for the first build: good enough. */
const MAX_CANDIDATES = 400;
const MAX_VISITED = 4000;
/** Folding keeps an all-ASCII field's length (lower case only), so its offsets need no map. */
const isAscii = (text: string): boolean => {
	for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0x7f) return false;
	return true;
};

/** A field folded for matching, with each folded unit's [start, end) in the text as written. */
type FoldMap = { s: string; start: number[] | null; end: number[] | null };

const foldMap = (text: string): FoldMap => {
	if (isAscii(text)) return { s: text.toLowerCase(), start: null, end: null };
	let s = "";
	const start: number[] = [];
	const end: number[] = [];
	let i = 0;
	while (i < text.length) {
		const cp = text.codePointAt(i) as number;
		const n = cp > 0xffff ? 2 : 1;
		const f = normalize(text.slice(i, i + n));
		for (let k = 0; k < f.length; k++) {
			start.push(i);
			end.push(i + n);
		}
		s += f;
		i += n;
	}
	return { s, start, end };
};

export class MetaIndex {
	private readonly hay: string;
	private readonly fields: MetaField[] = [];
	private readonly paths: string[] = [];
	private readonly fieldNote: Int32Array;
	private readonly fieldStart: Int32Array;
	private readonly fieldEnd: Int32Array;

	constructor(notes: readonly MetaNote[]) {
		const parts: string[] = [];
		const note: number[] = [];
		const starts: number[] = [];
		const ends: number[] = [];
		let at = 0;
		notes.forEach((n, ni) => {
			this.paths.push(n.path);
			for (const f of n.fields) {
				// Matching only needs the folded text (marks re-fold the few fields shown).
				const s = isAscii(f.text) ? f.text.toLowerCase() : normalize(f.text);
				this.fields.push(f);
				note.push(ni);
				starts.push(at);
				ends.push(at + s.length);
				parts.push(s);
				at += s.length + 1;
			}
		});
		// "\n" between fields: never part of a word, so a match cannot run across two fields.
		this.hay = parts.join("\n");
		this.fieldNote = Int32Array.from(note);
		this.fieldStart = Int32Array.from(starts);
		this.fieldEnd = Int32Array.from(ends);
	}

	/** Notes with a field that has every word of `query`, best first, one hit per note. */
	match(query: string, opts: { limit?: number; allow?: (path: string) => boolean } = {}): MetaHit[] {
		const words = query
			.split(/\s+/)
			.map((w) => normalize(w))
			.filter(Boolean);
		if (!words.length || !this.fields.length) return [];
		const key = words.reduce((a, b) => (b.length > a.length ? b : a));
		// One letter is in every note: the names answer that (Chinese and Japanese characters are words).
		if (key.length < 2 && !hasCjk(key)) return [];
		let candidates = 0;
		let visited = 0;
		const best = new Map<number, { score: number; field: number }>();
		let pos = 0;
		while (candidates < MAX_CANDIDATES && visited < MAX_VISITED) {
			const idx = this.hay.indexOf(key, pos);
			if (idx < 0) break;
			if (!this.startsWord(idx, key)) {
				pos = idx + 1;
				continue;
			}
			const f = this.fieldAt(idx);
			pos = (this.fieldEnd[f] as number) + 1;
			visited++;
			const score = this.score(f, words);
			if (score === null) continue;
			const n = this.fieldNote[f] as number;
			if (opts.allow && !opts.allow(this.paths[n] as string)) continue;
			candidates++;
			const prev = best.get(n);
			if (!prev || score > prev.score) best.set(n, { score, field: f });
		}
		return [...best.entries()]
			.sort(
				(a, b) =>
					b[1].score - a[1].score || (this.paths[a[0]] as string).localeCompare(this.paths[b[0]] as string),
			)
			.slice(0, opts.limit ?? 20)
			.map(([n, { score, field }]) => {
				const f = this.fields[field] as MetaField;
				return { path: this.paths[n] as string, field: f, marks: marksOf(f.text, words), score };
			});
	}

	private startsWord(idx: number, word: string): boolean {
		if (idx === 0 || hasCjk(word)) return true;
		return !WORD_CHAR.test(this.hay[idx - 1] as string);
	}

	/** The field holding hay offset `idx` (binary search over the field starts). */
	private fieldAt(idx: number): number {
		let lo = 0;
		let hi = this.fieldStart.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if ((this.fieldStart[mid] as number) <= idx) lo = mid;
			else hi = mid - 1;
		}
		return lo;
	}

	/** The field's score if it has every word at a word start, else null. Whole words count extra. */
	private score(f: number, words: readonly string[]): number | null {
		const from = this.fieldStart[f] as number;
		const to = this.fieldEnd[f] as number;
		const text = this.hay.slice(from, to);
		let whole = 0;
		for (const w of words) {
			const at = wordStart(text, w);
			if (at < 0) return null;
			if (!WORD_CHAR.test(text[at + w.length] ?? " ")) whole++;
		}
		const kind = KIND_WEIGHT[(this.fields[f] as MetaField).kind];
		// Kind first, then whole words, then shorter fields (a heading that is just the words).
		return kind * 100 + whole * 10 - Math.min(9, text.length / 20);
	}
}

/** Where `w` starts a word of `text` (anywhere for Chinese and Japanese), or -1. */
const wordStart = (text: string, w: string): number => {
	const cjk = hasCjk(w);
	for (let at = text.indexOf(w); at >= 0; at = text.indexOf(w, at + 1))
		if (cjk || at === 0 || !WORD_CHAR.test(text[at - 1] as string)) return at;
	return -1;
};

/** The typed words' ranges in the field's text as written, sorted and merged. */
const marksOf = (text: string, words: readonly string[]): Array<[number, number]> => {
	const m = foldMap(text);
	const ranges: Array<[number, number]> = [];
	for (const w of words) {
		const at = wordStart(m.s, w);
		if (at < 0) continue;
		const last = at + w.length - 1;
		ranges.push(m.start && m.end ? [m.start[at] as number, m.end[last] as number] : [at, last + 1]);
	}
	ranges.sort((a, b) => a[0] - b[0]);
	const out: Array<[number, number]> = [];
	for (const r of ranges) {
		const prev = out[out.length - 1];
		if (prev && r[0] <= prev[1]) prev[1] = Math.max(prev[1], r[1]);
		else out.push([r[0], r[1]]);
	}
	return out;
};
