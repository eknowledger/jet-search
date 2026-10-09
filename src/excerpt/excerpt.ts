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
/** Hits tried as the excerpt's centre (the best line is nearly always among the first ones). */
const ANCHORS = 30;
/** Hits told apart by word for that choice (the anchors and their neighbours). */
const GROUPED = 64;
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

/** Text the patterns cannot read as typed: decomposed Hangul or kana, half-width kana, Latin ligatures. */
const NEEDS_COMPOSE = /[\u1100-\u11ff\uff61-\uff9f\ufb00-\ufb06]|\u3099|\u309a/;

/**
 * The text composed (NFKC, one base and what joins it at a time), and a way back to the raw offsets:
 * a note stored decomposed (NFD 검색, テ + ゛, ﾃﾞｰﾀ) or with ligatures (ﬃ) reads as typed.
 * Null when there is nothing to compose (the common case costs one test).
 */
const composed = (text: string): { s: string; back: (i: number) => number } | null => {
	if (!NEEDS_COMPOSE.test(text)) return null;
	let s = "";
	const from: number[] = [];
	const to: number[] = [];
	let i = 0;
	while (i < text.length) {
		let j = i + ((text.codePointAt(i) ?? 0) > 0xffff ? 2 : 1);
		for (;;) {
			const cp = text.codePointAt(j) ?? -1;
			if (
				(cp >= 0x1160 && cp <= 0x11ff) ||
				cp === 0x3099 ||
				cp === 0x309a ||
				cp === 0xff9e ||
				cp === 0xff9f ||
				(cp >= 0x300 && cp <= 0x36f)
			)
				j++;
			else break;
		}
		const piece = text.slice(i, j).normalize("NFKC");
		for (let k = 0; k < piece.length; k++) {
			from.push(i);
			to.push(j);
		}
		s += piece;
		i = j;
	}
	// A start maps to its source's start; an end (k > 0) to the end of the source of the unit before it.
	const back = (k: number): number => (k <= 0 ? 0 : k >= s.length ? text.length : (from[k] ?? text.length));
	return { s, back };
};

/**
 * The index after the character at `i`: a step of one code unit lands inside a surrogate pair (𠮷,
 * an emoji), where a /u pattern matches the same character again, for ever.
 */
const nextChar = (s: string, i: number): number => i + ((s.codePointAt(i) ?? 0) > 0xffff ? 2 : 1);

/** The next hit from `re.lastIndex`: a match that really starts a word (group 1 is a bounded term). */
const nextHit = (re: RegExp, scan: string, arabic: boolean): RegExpExecArray | null => {
	for (let m = re.exec(scan); m; m = re.exec(scan)) {
		const i = m.index;
		if (m[1] === undefined || startsWord(scan, i) || (arabic && afterArticle(scan, i))) return m;
		re.lastIndex = nextChar(scan, i);
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
 * One line around the best hit in `text` (raw Markdown): the hit whose line, within a width of it,
 * holds the most of the query's words (`exact`: the words as typed count fully, other terms, such as
 * word forms, half), the first among equals. About `width` characters,
 * `marks` = [start, end) of highlighted words within `text` of the excerpt, `line` = 0-based line
 * of the hit in the note, `offset` = character offset of the hit in the note, `more` = number of
 * other hits in the note (counted up to a cap, e.g. 99). Null when no term occurs.
 *
 * Terms are normalized index terms; each matches at a word start as a prefix (`spee` highlights
 * `speech`). The frontmatter is skipped and at most `scanLimit` characters (256 KB) are read.
 */
export const cutExcerpt = (
	text: string,
	terms: readonly string[],
	opts: {
		width?: number;
		scanLimit?: number;
		exact?: readonly string[];
		/** The last word while it is still being typed: a longer word that starts with it counts fully. */
		typing?: string;
	} = {},
): Excerpt | null => {
	const cmp = composed(text);
	if (cmp) {
		const r = cutExcerpt(cmp.s, terms, opts);
		return r ? { ...r, offset: cmp.back(r.offset) } : null;
	}
	const width = Math.max(20, opts.width ?? WIDTH);
	const scan = scanned(text, opts.scanLimit);
	const c = compiled(terms);
	const re = patternFor(c, scan);
	if (!re) return null;
	re.lastIndex = frontmatterEnd(scan);
	// The hits, up to the cap: where each is, and which of your words it is (a word as typed, or a
	// prefix of it, is that word; any other term is its own group).
	const exact = [...new Set((opts.exact ?? []).map(normalize).filter((w) => w.length > 0))];
	const found: Array<{ at: number; end: number; group: string; weight: number }> = [];
	const typing = opts.typing ? normalize(opts.typing) : null;
	// One term and no words as typed: every hit is the same word, so the first is as good as any. With
	// words as typed, "world" is still told from its form "worlds".
	const single = c.terms.length <= 1 && !exact.length;
	for (let m = nextHit(re, scan, c.arabic); m && found.length <= MORE_CAP; m = nextHit(re, scan, c.arabic)) {
		const end = wordEnd(text, m.index, m.index + m[0].length);
		// Chinese, Japanese and Korean pairs overlap (デー, ータ): look again from the next character,
		// so the whole word is marked, not every other pair.
		if (isFree(m[0])) re.lastIndex = nextChar(scan, m.index);
		// Only the hits the choice can look at are told apart by word (the rest are counted).
		if (single || found.length >= GROUPED) {
			found.push({ at: m.index, end, group: "", weight: 0 });
			continue;
		}
		const word = normalize(text.slice(m.index, end));
		// The word as typed counts fully; "category" for `cat` or "worlds" for `world` is a form of it and
		// counts half, unless `cat` is the word still being typed.
		const own = exact.find((w) => word.startsWith(w) || w.startsWith(word));
		const full = own !== undefined && (word === own || (typing === own && word.startsWith(own)));
		const term = own ?? c.terms.find((t) => word.startsWith(t)) ?? word;
		found.push({ at: m.index, end, group: own ? `w:${own}` : `t:${term}`, weight: full ? 1 : 0.5 });
	}
	const first = found[0];
	if (!first) return null;
	// The best hit: the one whose line, near it, holds the most of your words; the first among equals.
	// Hits are in text order, so each window is a run of neighbours; the first 30 hits are tried.
	let anchor = first;
	if (found.length > 1 && !single) {
		let best = -1;
		const tries = Math.min(found.length, ANCHORS);
		for (let i = 0; i < tries; i++) {
			const h = found[i] as (typeof found)[number];
			const ls = text.lastIndexOf("\n", h.at - 1) + 1;
			let le = text.indexOf("\n", h.at);
			if (le < 0) le = text.length;
			const lo = Math.max(ls, h.at - width / 2);
			const hi = Math.min(le, h.at + width / 2);
			const groups = new Map<string, number>();
			for (let j = i; j >= 0 && (found[j] as { at: number }).at >= lo; j--) {
				const o = found[j] as (typeof found)[number];
				if (o.group) groups.set(o.group, o.weight);
			}
			for (let j = i + 1; j < found.length && (found[j] as { at: number }).at < hi; j++) {
				const o = found[j] as (typeof found)[number];
				if (o.group) groups.set(o.group, o.weight);
			}
			// Without the typed words, each term counts as a word. With them, word forms and typos (which
			// cannot be told apart by word) count half a word between them.
			let score = 0;
			let other = 0;
			for (const w of groups.values())
				if (w === 1 || !exact.length) score += 1;
				else other += w;
			score += Math.min(0.5, other);
			if (score > best) {
				best = score;
				anchor = h;
			}
		}
	}
	const at = anchor.at;
	const hitEnd = anchor.end;
	const lineStart = text.lastIndexOf("\n", at - 1) + 1;
	let lineEnd = text.indexOf("\n", at);
	if (lineEnd < 0) lineEnd = text.length;
	if (lineEnd > at && text.charCodeAt(lineEnd - 1) === 13) lineEnd--;
	// A long line is only looked at near the hit (a whole note can be one line).
	const from = Math.max(lineStart, clusterStart(text, Math.max(lineStart, at - REACH * width)));
	const to = Math.min(lineEnd, clusterEnd(text, Math.min(lineEnd, hitEnd + REACH * width)));
	const hits: Array<[number, number]> = found.filter((h) => h.at >= from && h.at < to).map((h) => [h.at, h.end]);
	const more = Math.min(MORE_CAP, found.length - 1);
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
	const cmp = composed(text);
	if (cmp) return findHits(cmp.s, terms, opts).map(([a, b]) => [cmp.back(a), cmp.back(b)]);
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
		for (const c of run.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー]+/gu)) {
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
	const cmp = composed(text);
	if (cmp) return hasPhrase(cmp.s, phrase, opts);
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
		re.lastIndex = nextChar(scan, m.index);
	}
	return false;
};
