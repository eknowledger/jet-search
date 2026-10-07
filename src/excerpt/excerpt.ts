import { normalize, tokenize } from "../engine/analyzer";
import { afterArticle, clusterEnd, clusterStart, endsWord, foldAt, inWord, isFree, startsWord, wordEnd } from "./chars";
import { cutWindow, simplify } from "./display";
import { isLatin, LATIN_FOLDS, MAY_FOLD, present, termsSource, variantClass, variantsFor } from "./fold";

/**
 * Excerpts, hit lists and the phrase check. One
 * regular expression for all of a query's terms runs over the raw note: no normalized copy of the note,
 * no expression per term. Matching is case- and accent-insensitive like the index; a hit starts a word
 * (or a camelCase or letter–digit part) and is highlighted to the end of that word part.
 */

export type Excerpt = { text: string; marks: Array<[number, number]>; line: number; more: number; offset: number };

const WIDTH = 160;
const SCAN_LIMIT = 256 * 1024;
/** Further hits are counted up to this many ("+99 more"). */
const MORE_CAP = 99;
const HIT_LIMIT = 1000;
/** How far either side of the hit a long line is looked at when building its excerpt, in widths. */
const REACH = 4;

/** A term set ready to search: its case-only pattern, and patterns with the variants a text holds. */
type Compiled = {
	terms: string[];
	arabic: boolean;
	base: RegExp | null;
	/** Whether all terms are Latin letters and digits, whose variants `LATIN_FOLDS` finds. */
	latin: boolean;
	/** The raw characters that fold to the terms' letters beyond case, gathered on first need. */
	variants: Set<string> | null;
	/** For terms in other scripts: a pattern for those characters and the marks, built on first need. */
	detect: RegExp | null;
	/** Patterns by the variants a text holds (most recent last). */
	withVariants: Map<string, RegExp>;
};

/** Compiled term sets (one query excerpts ~20 rows), least recently used dropped first. */
const CACHE_SIZE = 16;
const VARIANT_PATTERNS = 8;
const cache = new Map<string, Compiled>();
let builds = 0;

/** Patterns compiled so far and term sets held, for tests of the cache. */
export const excerptCacheStats = (): { builds: number; size: number } => ({ builds, size: cache.size });

const remember = <K, V>(map: Map<K, V>, key: K, value: V, size: number): V => {
	map.set(key, value);
	if (map.size > size) {
		const oldest = map.keys().next();
		if (!oldest.done) map.delete(oldest.value);
	}
	return value;
};

/**
 * Terms as the pattern takes them: normalized, distinct, and without any term that another one begins
 * (`speech` adds nothing when `spee` is there: hits are word prefixes), longest first.
 */
const prepare = (terms: readonly string[]): string[] => {
	const list = [...new Set(terms.map(normalize).filter((t) => t.length > 0))].sort((a, b) => a.length - b.length);
	const kept: string[] = [];
	for (const t of list) if (!kept.some((k) => t.startsWith(k))) kept.push(t);
	return kept.reverse();
};

const ARABIC = /^[\u0600-\u06ff]/;

const compiled = (terms: readonly string[]): Compiled => {
	const key = terms.join("\u0000");
	const hit = cache.get(key);
	if (hit) {
		cache.delete(key);
		cache.set(key, hit);
		return hit;
	}
	const list = prepare(terms);
	builds++;
	const c: Compiled = {
		terms: list,
		arabic: list.some((t) => ARABIC.test(t)),
		base: list.length > 0 ? new RegExp(termsSource(list, null), "gu") : null,
		latin: isLatin(list),
		variants: null,
		detect: null,
		withVariants: new Map(),
	};
	return remember(cache, key, c, CACHE_SIZE);
};

/**
 * The pattern for this text: case only, unless the text holds variants of the terms' letters (accented
 * forms, marks), found with one static scan for Latin terms (most notes have none: 0.2 ns/char).
 */
const patternFor = (c: Compiled, scan: string): RegExp | null => {
	if (!c.base) return null;
	let seen: RegExpMatchArray | null;
	if (c.latin) seen = scan.match(LATIN_FOLDS);
	else if (!MAY_FOLD.test(scan)) seen = null;
	else {
		c.variants ??= variantsFor(c.terms);
		c.detect ??= new RegExp(variantClass(c.variants), "gu");
		seen = scan.match(c.detect);
	}
	if (!seen) return c.base;
	c.variants ??= variantsFor(c.terms);
	const p = present(seen, c.variants);
	if (p.chars.size === 0 && !p.marks) return c.base;
	const key = (p.marks ? "m" : "") + [...p.chars].sort().join("");
	const hit = c.withVariants.get(key);
	if (hit) {
		c.withVariants.delete(key);
		c.withVariants.set(key, hit);
		return hit;
	}
	builds++;
	return remember(c.withVariants, key, new RegExp(termsSource(c.terms, p), "gu"), VARIANT_PATTERNS);
};

/** The next hit from `re.lastIndex`: a match that really starts a word (group 1 is a bounded term). */
const nextHit = (re: RegExp, scan: string, arabic: boolean): RegExpExecArray | null => {
	for (let m = re.exec(scan); m; m = re.exec(scan)) {
		const i = m.index;
		if (m[1] === undefined || startsWord(scan, i) || (arabic && afterArticle(scan, i))) return m;
		re.lastIndex = i + 1;
	}
	return null;
};

const scanned = (text: string, scanLimit: number | undefined): string => {
	const limit = Math.max(0, scanLimit ?? SCAN_LIMIT);
	return limit < text.length ? text.slice(0, limit) : text;
};

/**
 * Where the body starts: after a YAML frontmatter block (`---` lines) at the very top, else 0. Only the
 * first `limit` characters are searched for its end.
 */
export const frontmatterEnd = (text: string, limit = text.length): number => {
	const open = text.startsWith("---\n") ? 3 : text.startsWith("---\r\n") ? 4 : -1;
	if (open < 0) return 0;
	for (let from = open; ;) {
		const i = text.indexOf("\n---", from);
		if (i < 0 || i > limit) return 0;
		let j = i + 4;
		if (text.charCodeAt(j) === 13) j++;
		if (j >= text.length) return text.length;
		if (text.charCodeAt(j) === 10) return j + 1;
		from = i + 1;
	}
};

const lineOf = (text: string, at: number): number => {
	let n = 0;
	for (let i = text.indexOf("\n"); i >= 0 && i < at; i = text.indexOf("\n", i + 1)) n++;
	return n;
};

/**
 * One line around the first hit of any term in `text` (raw Markdown): about `width` characters,
 * `marks` = [start, end) of highlighted words within `text` of the excerpt, `line` = 0-based line
 * of the hit in the note, `offset` = character offset of the hit in the note, `more` = number of
 * further hits after this one (counted up to a cap, e.g. 99). Null when no term occurs.
 *
 * Terms are normalized index terms; each matches at a word start as a prefix (`spee` highlights
 * `speech`). The frontmatter is skipped and at most `scanLimit` characters (256 KB) are read.
 */
export const cutExcerpt = (
	text: string,
	terms: readonly string[],
	opts: { width?: number; scanLimit?: number } = {},
): Excerpt | null => {
	const width = Math.max(20, opts.width ?? WIDTH);
	const scan = scanned(text, opts.scanLimit);
	const c = compiled(terms);
	const re = patternFor(c, scan);
	if (!re) return null;
	re.lastIndex = frontmatterEnd(scan);
	const first = nextHit(re, scan, c.arabic);
	if (!first) return null;
	const at = first.index;
	const hitEnd = wordEnd(text, at, at + first[0].length);
	const lineStart = text.lastIndexOf("\n", at - 1) + 1;
	let lineEnd = text.indexOf("\n", at);
	if (lineEnd < 0) lineEnd = text.length;
	if (lineEnd > at && text.charCodeAt(lineEnd - 1) === 13) lineEnd--;
	// A long line is only looked at near the hit (a whole note can be one line).
	const from = Math.max(lineStart, clusterStart(text, Math.max(lineStart, at - REACH * width)));
	const to = Math.min(lineEnd, clusterEnd(text, Math.min(lineEnd, hitEnd + REACH * width)));
	const hits: Array<[number, number]> = [[at, hitEnd]];
	let more = 0;
	while (more < MORE_CAP) {
		const m = nextHit(re, scan, c.arabic);
		if (!m) break;
		more++;
		if (m.index < to) hits.push([m.index, wordEnd(text, m.index, m.index + m[0].length)]);
	}
	const piece = text.slice(from, to);
	const shown = simplify(piece, from === lineStart, [at - from, hitEnd - from]);
	const [start, end] = cutWindow(shown.text, shown.at(at - from), shown.at(hitEnd - from), width);
	const before = start > 0 || from > lineStart;
	const after = end < shown.text.length || to < lineEnd;
	const shift = (before ? 1 : 0) - start;
	const marks: Array<[number, number]> = [];
	for (const [a, b] of hits) {
		const s = Math.max(start, shown.at(a - from));
		const e = Math.min(end, shown.at(Math.min(b, to) - from));
		if (e <= s) continue;
		const last = marks[marks.length - 1];
		if (last && s + shift < last[1]) last[1] = Math.max(last[1], e + shift);
		else marks.push([s + shift, e + shift]);
	}
	return {
		text: (before ? "…" : "") + shown.text.slice(start, end) + (after ? "…" : ""),
		marks,
		line: lineOf(text, at),
		more,
		offset: at,
	};
};

/**
 * Every hit of the terms in `text` (for the preview's ⌘G hit list and scrollbar ticks): [start, end)
 * offsets, capped at `limit` (1000). Hits are found as in `cutExcerpt`, frontmatter included; the end
 * is the end of the hit's word part. Reads at most `scanLimit` characters (256 KB).
 */
export const findHits = (
	text: string,
	terms: readonly string[],
	opts: { limit?: number; scanLimit?: number } = {},
): Array<[number, number]> => {
	const cap = opts.limit ?? HIT_LIMIT;
	const scan = scanned(text, opts.scanLimit);
	const c = compiled(terms);
	const re = patternFor(c, scan);
	const out: Array<[number, number]> = [];
	if (!re) return out;
	re.lastIndex = 0;
	while (out.length < cap) {
		const m = nextHit(re, scan, c.arabic);
		if (!m) break;
		out.push([m.index, wordEnd(text, m.index, m.index + m[0].length)]);
	}
	return out;
};

type PhraseWord = { word: string; free: boolean };

const phrases = new Map<string, PhraseWord[]>();

/**
 * A phrase's words, normalized like the index: ordinary words whole (one-letter words kept, so `plan b`
 * still needs the `b`), Chinese/Japanese stretches whole rather than as overlapping pairs, and Thai, Lao,
 * Khmer and Burmese through the analyzer's segmenter.
 */
const phraseWords = (phrase: string): PhraseWord[] => {
	const hit = phrases.get(phrase);
	if (hit) return hit;
	const out: PhraseWord[] = [];
	const add = (word: string, free: boolean): void => {
		const w = word.replace(/ς/g, "σ");
		if (w) out.push({ word: w, free });
	};
	const piece = (p: string): void => {
		const free = isFree(p);
		const words = tokenize(p);
		for (const w of words.length > 0 || free ? words : [normalize(p)]) add(w, free);
	};
	for (const m of phrase.matchAll(/[\p{L}\p{M}\p{N}]+/gu)) {
		const run = m[0];
		let last = 0;
		for (const c of run.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu)) {
			const at = c.index ?? 0;
			if (at > last) piece(run.slice(last, at));
			add(normalize(c[0]), true);
			last = at + c[0].length;
		}
		if (last < run.length) piece(run.slice(last));
	}
	return remember(phrases, phrase, out, CACHE_SIZE);
};

/** Where `word` (normalized) ends if the text spells it from `i` (any case, accents, marks), else -1. */
const spells = (text: string, i: number, word: string): number => {
	let j = i;
	for (let k = 0; k < word.length;) {
		if (j >= text.length) return -1;
		const [f, n] = foldAt(text, j);
		if (f.length === 0 && j > i) {
			j += n;
			continue;
		}
		if (f.length === 0 || !word.startsWith(f, k)) return -1;
		k += f.length;
		j += n;
	}
	while (j < text.length) {
		const [f, n] = foldAt(text, j);
		if (f.length > 0) break;
		j += n;
	}
	return j;
};

/** Whether the phrase's words follow each other from `i`, with only non-letters between them. */
const phraseAt = (text: string, i: number, words: readonly PhraseWord[]): boolean => {
	let pos = i;
	for (const [k, w] of words.entries()) {
		if (k > 0) while (pos < text.length && !inWord(text, pos)) pos++;
		const end = spells(text, pos, w.word);
		if (end < 0 || (!w.free && !endsWord(text, end))) return false;
		pos = end;
	}
	return true;
};

/**
 * Whether `phrase` (typed words) occurs in `text` as consecutive words, ignoring case, accents and
 * punctuation/whitespace between words. Words are whole (`cat` is not in `concatenate` or `category`);
 * a phrase without words asks for nothing (true). Reads at most `scanLimit` characters (256 KB).
 */
export const hasPhrase = (text: string, phrase: string, opts: { scanLimit?: number } = {}): boolean => {
	const words = phraseWords(phrase);
	const first = words[0];
	if (!first) return true;
	const scan = scanned(text, opts.scanLimit);
	const c = compiled([first.word]);
	const re = patternFor(c, scan);
	if (!re) return false;
	re.lastIndex = 0;
	for (let m = nextHit(re, scan, false); m; m = nextHit(re, scan, false)) {
		if (phraseAt(scan, m.index, words)) return true;
		re.lastIndex = m.index + 1;
	}
	return false;
};
