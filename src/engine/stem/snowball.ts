/**
 * Shared pieces of the Snowball stemmers (snowballstem.org, BSD-licensed descriptions; this is our own
 * code written from them): letter sets, the R1/R2 region rule and the longest-suffix lookup (`among`).
 *
 * Words arrive normalized (analyzer.ts): lower case with accents removed, so every vowel a stemmer
 * tests is plain ASCII. Letters the analyzer leaves alone (`ø`, `æ`, `œ`, `ł`…) count as non-vowels.
 */

/** A set of ASCII characters as a 128-entry table; anything else (or a position off the word) is outside. */
export type LetterSet = Uint8Array;

/** The set of the given ASCII characters. */
export const letterSet = (chars: string): LetterSet => {
	const t = new Uint8Array(128);
	for (let i = 0; i < chars.length; i++) t[chars.charCodeAt(i)] = 1;
	return t;
};

/** Whether `s[i]` exists and is in `set` (positions off the word are never in a set). */
export const isIn = (set: LetterSet, s: string, i: number): boolean => set[s.charCodeAt(i)] === 1;

/** Whether `s[i]` exists and is not in `set` (Snowball's `non-v` must consume a letter). */
export const isOut = (set: LetterSet, s: string, i: number): boolean =>
	i >= 0 && i < s.length && set[s.charCodeAt(i)] !== 1;

/**
 * Where the region after the first non-vowel following a vowel starts, searching from `from`
 * (Snowball's `gopast v gopast non-v`), or the word's length when there is none. R1 is this from the
 * start of the word, R2 the same again from R1.
 */
export const regionAfter = (s: string, from: number, vowels: LetterSet): number => {
	const n = s.length;
	let i = from;
	while (i < n && vowels[s.charCodeAt(i)] !== 1) i++;
	i++;
	while (i < n && vowels[s.charCodeAt(i)] === 1) i++;
	return i < n ? i + 1 : n;
};

/** Just after the first letter of `s` at or after `from` that is (`want`) or is not in `set`; else the length. */
const pastFirst = (s: string, from: number, set: LetterSet, want: boolean): number => {
	for (let i = from; i < s.length; i++) if ((set[s.charCodeAt(i)] === 1) === want) return i + 1;
	return s.length;
};

/**
 * RV as Spanish, Italian and Portuguese define it: after the next vowel when the second letter is a
 * consonant; after the next consonant when the first two letters are vowels; else after the third
 * letter; the end of the word when the position cannot be found.
 */
export const romanceRV = (s: string, vowels: LetterSet): number => {
	const n = s.length;
	if (n < 2) return n;
	const second = vowels[s.charCodeAt(1)] === 1;
	if (vowels[s.charCodeAt(0)] === 1) return second ? pastFirst(s, 2, vowels, false) : pastFirst(s, 2, vowels, true);
	if (!second) return pastFirst(s, 2, vowels, true);
	return n >= 3 ? 3 : n;
};

/** `s` with the letter at `i` replaced by `c` (one letter for one, so regions keep their positions). */
export const setAt = (s: string, i: number, c: string): string => s.slice(0, i) + c + s.slice(i + 1);

/** Whether `s` has a letter of `set` in [from, to). */
export const hasIn = (set: LetterSet, s: string, from: number, to: number): boolean => {
	for (let i = from; i < to; i++) if (set[s.charCodeAt(i)] === 1) return true;
	return false;
};

/** Whether the part of `s` before `end` ends with one of `tails`. */
export const endsWithAny = (s: string, end: number, tails: readonly string[]): boolean => {
	for (const t of tails) if (end >= t.length && s.startsWith(t, end - t.length)) return true;
	return false;
};

/** A suffix found by a matcher: the suffix and the index of its group. */
export type Suffix = { readonly word: string; readonly group: number };

type Node = { suffix: Suffix | undefined; next: Map<number, Node> };

/**
 * Snowball's `among` over suffixes: a matcher returning the longest of the suffixes that ends `s`
 * at `end` and starts at or after `start` (pass a region start to search only inside it), with the
 * index of its group, or `undefined`. A reversed trie walked from the end: no allocation per call.
 */
export const suffixMatcher = (
	groups: readonly (readonly string[])[],
): ((s: string, start?: number, end?: number) => Suffix | undefined) => {
	const root: Node = { suffix: undefined, next: new Map() };
	groups.forEach((words, group) => {
		for (const word of words) {
			let node = root;
			for (let i = word.length - 1; i >= 0; i--) {
				const c = word.charCodeAt(i);
				let next = node.next.get(c);
				if (next === undefined) {
					next = { suffix: undefined, next: new Map() };
					node.next.set(c, next);
				}
				node = next;
			}
			node.suffix = { word, group };
		}
	});
	return (s, start = 0, end = s.length) => {
		let node: Node | undefined = root;
		let found: Suffix | undefined;
		for (let i = end - 1; i >= start; i--) {
			node = node.next.get(s.charCodeAt(i));
			if (node === undefined) break;
			if (node.suffix !== undefined) found = node.suffix;
		}
		return found;
	};
};

/** Upper-case marks (`U`, `I`, `Y`) back to lower case, once a stemmer has finished with them. */
export const unmark = (s: string): string => (/[IUY]/.test(s) ? s.replace(/[IUY]/g, (c) => c.toLowerCase()) : s);
