/**
 * Dutch: the Snowball Dutch algorithm by Martin Porter, as described at snowballstem.org (published in
 * Snowball 3 as "dutch_porter"; the newer default "dutch" stemmer is a different design). Our own
 * code from the published description.
 *
 * The algorithm starts by removing umlauts and acute accents, which the analyzer has already done,
 * and keeps è (a vowel, in no rule), so unaccented input stems exactly as the original.
 */

import { isIn, isOut, letterSet, regionAfter, setAt, suffixMatcher, unmark } from "./snowball";

const V = letterSet("aeiouy");
/** Vowels and j: a valid s-ending is a letter outside this set. */
const V_J = letterSet("aeiouyj");
/** Vowels and I: the last letter of a word whose double vowel may be undoubled is outside this set. */
const V_I = letterSet("aeiouyI");
const DOUBLE_VOWEL = ["aa", "ee", "oo", "uu"];

const STEP1 = suffixMatcher([["heden"], ["en", "ene"], ["s", "se"]]);
const STEP3B = suffixMatcher([["end", "ing"], ["ig"], ["lijk"], ["baar"], ["bar"]]);

/** Marks an initial y, a y after a vowel and an i between vowels as `Y`, `I` (non-vowels from then on). */
const mark = (word: string): string => {
	let s = word.charCodeAt(0) === 121 ? `Y${word.slice(1)}` : word;
	for (let i = 1; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c === 121 && isIn(V, s, i - 1)) s = setAt(s, i, "Y");
		else if (c === 105 && isIn(V, s, i - 1) && isIn(V, s, i + 1)) s = setAt(s, i, "I");
	}
	return s;
};

/** Drops the last letter of a final kk, dd or tt. */
const undouble = (s: string): string => (/(?:kk|dd|tt)$/.test(s) ? s.slice(0, -1) : s);

/** -en, -ene at `k`: removed in R1 after a non-vowel (not in -gem), then undoubled. */
const enEnding = (s: string, k: number, p1: number): string =>
	k >= p1 && isOut(V, s, k - 1) && !(k >= 3 && s.startsWith("gem", k - 3)) ? undouble(s.slice(0, k)) : s;

/** A final e in R1 after a non-vowel: removed, then undoubled (a shorter result means one was found). */
const eEnding = (s: string, p1: number): string => {
	const k = s.length - 1;
	return s.charCodeAt(k) === 101 && k >= p1 && isOut(V, s, k - 1) ? undouble(s.slice(0, k)) : s;
};

/** Dutch stem of a lower-case, unaccented word. */
export const stemDutch = (word: string): string => {
	let w = mark(word);
	const n = w.length;
	let p1 = n;
	let p2 = n;
	if (n >= 3) {
		const r1 = regionAfter(w, 0, V);
		p2 = regionAfter(w, r1, V);
		p1 = Math.max(r1, 3);
	}

	// Step 1: -heden → -heid; -en, -ene; -s, -se after a valid s-ending.
	const a = STEP1(w);
	if (a !== undefined) {
		const k = w.length - a.word.length;
		if (a.group === 0) {
			if (k >= p1) w = `${w.slice(0, k)}heid`;
		} else if (a.group === 1) w = enEnding(w, k, p1);
		else if (k >= p1 && isOut(V_J, w, k - 1)) w = w.slice(0, k);
	}

	// Step 2: final e.
	const before = w;
	w = eEnding(w, p1);
	const eFound = w !== before;

	// Step 3a: -heid in R2, not after c, then -en as in step 1.
	if (w.endsWith("heid") && w.length - 4 >= p2 && w.charCodeAt(w.length - 5) !== 99) {
		w = w.slice(0, -4);
		if (w.endsWith("en")) w = enEnding(w, w.length - 2, p1);
	}

	// Step 3b: d-suffixes in R2.
	const b = STEP3B(w);
	if (b !== undefined) {
		const k = w.length - b.word.length;
		if (k >= p2) {
			if (b.group === 0) {
				w = w.slice(0, k);
				w = w.endsWith("ig") && k - 2 >= p2 && w.charCodeAt(k - 3) !== 101 ? w.slice(0, -2) : undouble(w);
			} else if (b.group === 1) {
				if (w.charCodeAt(k - 1) !== 101) w = w.slice(0, k);
			} else if (b.group === 2) w = eEnding(w.slice(0, k), p1);
			else if (b.group === 3 || eFound) w = w.slice(0, k);
		}
	}

	// Step 4: undouble a vowel in a final consonant–double vowel–consonant (`maan` → `man`).
	const e = w.length;
	if (isOut(V_I, w, e - 1) && isOut(V, w, e - 4) && DOUBLE_VOWEL.some((d) => w.startsWith(d, e - 3)))
		w = w.slice(0, e - 2) + w.slice(e - 1);
	return unmark(w);
};
