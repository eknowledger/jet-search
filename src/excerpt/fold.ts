import { normalize } from "../engine/analyzer";
import { isFree } from "./chars";

/**
 * Regular-expression sources that find normalized index terms in raw note text.
 * Each letter of a term becomes a class of raw characters that fold to it: its two cases, plus the
 * accented or variant forms the analyzer folds to it (`é`, `ß` for `ss`, `أ` for `ا`) that the text
 * actually contains. Most notes contain none, and small classes keep V8's scan fast (~1 ns/char);
 * classes with every variant defeat its quick checks and scan 3–15× slower. The variants come from the
 * analyzer's own `normalize`, so an excerpt finds what the index stored. Case lives in the classes, not
 * in the `i` flag, and the patterns carry no `\p{…}` classes, which take ~1 ms to compile per pattern.
 */

/**
 * Marks the analyzer removes after NFKD (accents, Hebrew points, Arabic short vowels), and the tatweel.
 * Classes list the marks first, so no mark follows a letter in the source (eslint no-misleading-character-class).
 */
const MARKS = "\\u0300-\\u036f\\u0591-\\u05c7\\u0610-\\u061a\\u064b-\\u065f\\u0670\\u06d6-\\u06ed\\u0640";
const IS_MARK = new RegExp(`^[${MARKS}]$`);

/** Raw characters that may fold to a Latin letter or digit beyond its case (`é`, `ß`, `ﬁ`, `²`, `Ａ`). */
const LATIN_VARIANTS =
	"\\u00aa\\u00b2\\u00b3\\u00b5\\u00b9\\u00ba\\u00c0-\\u00d6\\u00d8-\\u00f6\\u00f8-\\u024f" +
	"\\u1e00-\\u1eff\\u2070-\\u209f\\u2100-\\u218f\\u2460-\\u24ff\\ufb00-\\ufb06\\uff01-\\uff5e";
/** Every Latin variant and combining accent in a text (for terms of Latin letters and digits only). */
export const LATIN_FOLDS = new RegExp(`[\\u0300-\\u036f${LATIN_VARIANTS}]`, "g");

/** Any character that may fold to more than its lower case, in any script, or a mark: a cheap superset test. */
export const MAY_FOLD = new RegExp(
	`[${MARKS}${LATIN_VARIANTS}\\u0370-\\u052f\\u0600-\\u06ff\\u1f00-\\u1fff\\u2f00-\\u2fdf\\uf900-\\ufaff` +
		"\\ufb1d-\\ufdff\\ufe70-\\ufeff\\uff61-\\uffef]",
);

/**
 * Before a term, a superset of word starts without `\p{…}`: anything but a lower-case Latin letter
 * followed by another, so the common mid-word case is rejected inside the scan. `startsWord` decides.
 */
export const LOOSE_START =
	"(?:^|[^a-z0-9\\u00df-\\u00f6\\u00f8-\\u00ff]|(?=[^a-z\\u00df-\\u00f6\\u00f8-\\u00ff])|(?<=[0-9]))";

type Range = readonly [number, number];
/** Raw code points that may fold to a letter, by the letter's script; each group is scanned on first use. */
const GROUPS: ReadonlyArray<readonly Range[]> = [
	// Latin and digits: Latin-1 to Extended-B, Extended Additional, super/subscripts, letterlike symbols
	// and number forms (K, Å, Ⅱ), enclosed alphanumerics (①, Ⓐ), ligatures (ﬁ), full width (Ａ).
	[
		[0xa0, 0x24f],
		[0x1e00, 0x1eff],
		[0x2070, 0x209f],
		[0x2100, 0x218f],
		[0x2460, 0x24ff],
		[0xfb00, 0xfb06],
		[0xff01, 0xff5e],
	],
	[
		[0x370, 0x3ff],
		[0x1f00, 0x1fff],
	],
	[[0x400, 0x52f]],
	[[0xfb1d, 0xfb4f]],
	[
		[0x600, 0x6ff],
		[0xfe70, 0xfeff],
	],
	[
		[0x2f00, 0x2fd5],
		[0xf900, 0xfaff],
		[0xff61, 0xffdc],
	],
];
const groupOf = (cp: number): number => {
	if (cp < 0x370 || (cp >= 0x1e00 && cp < 0x1f00)) return 0;
	if (cp < 0x400 || (cp >= 0x1f00 && cp < 0x2000)) return 1;
	if (cp < 0x530) return 2;
	if (cp >= 0x590 && cp < 0x600) return 3;
	if (cp >= 0x600 && cp < 0x700) return 4;
	return cp >= 0x2e80 ? 5 : -1;
};

/** Normalized form (one or two letters) → raw characters that fold to it other than its two cases. */
const variants = new Map<string, string[]>();
/** First letter of a two-letter fold → its raw characters (`s` → ß), for a prefix term's last letter. */
const pairsByFirst = new Map<string, string[]>();
const built = new Set<number>();
const WORDLIKE = /^[\p{L}\p{N}]{1,2}$/u;

const push = (map: Map<string, string[]>, key: string, ch: string): void => {
	const list = map.get(key);
	if (list) list.push(ch);
	else map.set(key, [ch]);
};

/** The two cases of a normalized letter (and both sigmas): what every class holds. */
const cases = (c: string): string[] => {
	if (c === "σ" || c === "ς") return ["σ", "ς", "Σ"];
	const up = c.toUpperCase();
	return up !== c && Array.from(up).length === 1 && normalize(up) === c ? [c, up] : [c];
};

const scanGroup = (g: number): void => {
	if (g < 0 || built.has(g)) return;
	built.add(g);
	for (const [a, b] of GROUPS[g] ?? [])
		for (let cp = a; cp <= b; cp++) {
			const ch = String.fromCodePoint(cp);
			const n = normalize(ch);
			if (n === ch || !WORDLIKE.test(n) || cases(n).includes(ch)) continue;
			push(variants, n, ch);
			const cps = Array.from(n);
			if (cps.length === 2) push(pairsByFirst, cps[0] ?? "", ch);
		}
};

/** Raw characters folding to a letter or pair, other than its cases (Latin-1 always: µ folds to Greek μ). */
const variantsOf = (key: string): string[] => {
	scanGroup(0);
	scanGroup(groupOf(key.codePointAt(0) ?? 0));
	return variants.get(key) ?? [];
};

const literal = (cp: number): string =>
	(cp >= 0x30 && cp <= 0x39) || (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)
		? String.fromCharCode(cp)
		: `\\u{${cp.toString(16)}}`;

/** The inside of a character class (with ranges) for a set of characters. */
const classBody = (chars: Iterable<string>): string => {
	const cps = [...new Set(Array.from(chars, (c) => c.codePointAt(0) ?? 0))].sort((a, b) => a - b);
	let out = "";
	for (let i = 0; i < cps.length;) {
		let j = i;
		while (j + 1 < cps.length && cps[j + 1] === (cps[j] ?? 0) + 1) j++;
		const a = cps[i] ?? 0;
		const b = cps[j] ?? 0;
		out +=
			j - i >= 2
				? `${literal(a)}-${literal(b)}`
				: cps
						.slice(i, j + 1)
						.map(literal)
						.join("");
		i = j + 1;
	}
	return out;
};

const charClass = (chars: readonly string[]): string => {
	const unique = [...new Set(chars)];
	return unique.length === 1 ? literal(unique[0]?.codePointAt(0) ?? 0) : `[${classBody(unique)}]`;
};

/** Whether all terms are written in Latin letters and digits (their variants are all `LATIN_FOLDS`). */
export const isLatin = (terms: readonly string[]): boolean =>
	terms.every((t) => Array.from(t).every((c) => groupOf(c.codePointAt(0) ?? 0) === 0));

/** Every raw character that could stand for a letter of these terms other than its two cases. */
export const variantsFor = (terms: readonly string[]): Set<string> => {
	const set = new Set<string>();
	for (const t of terms)
		for (const c of Array.from(t)) {
			for (const x of variantsOf(c)) set.add(x);
			for (const x of pairsByFirst.get(c) ?? []) set.add(x);
		}
	return set;
};

/** A class of the given variant characters and the marks: what to look for in a text before choosing a pattern. */
export const variantClass = (chars: ReadonlySet<string>): string => `[${MARKS}${classBody(chars)}]`;

/** What a text holds beyond case for a set of terms: the variant characters seen, and whether marks are. */
export type Present = { chars: ReadonlySet<string>; marks: boolean };

/** The variants of the terms (`relevant`) and the marks among characters seen in a text. */
export const present = (seen: readonly string[], relevant: ReadonlySet<string>): Present => {
	const chars = new Set<string>();
	let marks = false;
	for (const ch of seen) {
		if (relevant.has(ch)) chars.add(ch);
		else if (IS_MARK.test(ch)) marks = true;
	}
	return { chars, marks };
};

/** A term as pattern units: letters, or letter pairs that a present raw character folds to (`ss` ← ß). */
const units = (term: string, seen: Present | null): string[] => {
	const cps = Array.from(term);
	const out: string[] = [];
	for (let i = 0; i < cps.length; i++) {
		const a = cps[i] ?? "";
		const b = cps[i + 1];
		if (seen && b !== undefined && variantsOf(a + b).some((x) => seen.chars.has(x))) {
			out.push(a + b);
			i++;
		} else out.push(a);
	}
	return out;
};

/** The class for a letter: its cases, plus present variants; `last` also admits present pairs that begin with it. */
const classOf = (c: string, last: boolean, seen: Present | null): string => {
	const members = cases(c);
	if (seen) {
		for (const x of variantsOf(c)) if (seen.chars.has(x)) members.push(x);
		if (last) for (const x of pairsByFirst.get(c) ?? []) if (seen.chars.has(x)) members.push(x);
	}
	return charClass(members);
};

const unitSource = (u: string, last: boolean, seen: Present | null): string => {
	const m = seen?.marks ? `[${MARKS}]*` : "";
	const cps = Array.from(u);
	if (cps.length === 1) return classOf(u, last, seen) + m;
	const [a = "", b = ""] = cps;
	const pair = variantsOf(u).filter((x) => seen?.chars.has(x));
	return `(?:${classOf(a, false, seen)}${m}${classOf(b, last, seen)}${m}|${charClass(pair)}${m})`;
};

type Trie = Map<string, { end: boolean; kids: Trie }>;

/** One pattern for terms as a trie, so shared beginnings are tried once. */
const trieSource = (terms: readonly string[], seen: Present | null): string => {
	const root: Trie = new Map();
	for (const t of terms) {
		let node = root;
		const us = units(t, seen);
		us.forEach((u, i) => {
			let kid = node.get(u);
			if (!kid) {
				kid = { end: false, kids: new Map() };
				node.set(u, kid);
			}
			if (i === us.length - 1) kid.end = true;
			node = kid.kids;
		});
	}
	const emit = (node: Trie): string => {
		const alts = [...node].map(([u, kid]) => {
			const head = unitSource(u, kid.end, seen);
			if (kid.kids.size === 0) return head;
			const rest = emit(kid.kids);
			return kid.end ? `${head}(?:${rest})?` : head + rest;
		});
		return alts.length === 1 ? (alts[0] ?? "") : `(?:${alts.join("|")})`;
	};
	return emit(root);
};

/**
 * The pattern for a set of prepared terms, each matched as a word prefix: terms from spaceless scripts
 * anywhere, the others behind `LOOSE_START` (checked once for all through a backreference). `seen` adds
 * the variant characters and marks the text holds (null: case only).
 */
export const termsSource = (terms: readonly string[], seen: Present | null): string => {
	const free = terms.filter(isFree);
	const bounded = terms.filter((t) => !isFree(t));
	const alts: string[] = [];
	if (bounded.length > 0) alts.push(`(${trieSource(bounded, seen)})(?<=${LOOSE_START}\\1)`);
	if (free.length > 0) alts.push(trieSource(free, seen));
	return alts.join("|");
};
