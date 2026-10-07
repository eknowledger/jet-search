/**
 * German: the Snowball "german" algorithm (snowballstem.org, version 3.x), our own code from the
 * published description.
 *
 * Words arrive with umlauts removed (ä, ö, ü → a, o, u) and ß as ss, which the algorithm's own last
 * step does anyway; umlauts are vowels as their plain letters are, so regions do not move. Adaptations:
 * - Its rule reading ae, oe, ue as umlauts (not ue after q) maps straight to a, o, u, so `Haeuser`
 *   and `Häuser` (`hauser`) both reach `haus`; but not when the e begins a final inflection
 *   (-e, -em, -en, -er, -ern, -es, -erin, -erinnen) inside R1: there the pair is more likely ä + e with
 *   the umlaut removed (`Europäer` → `europaer` → `europa`, like the original), while short words such
 *   as `fuer` and `schoen` still read as `für` and `schön`.
 * - The one umlaut in a rule, ä as a valid et-ending, is read as a.
 * Tokens never contain apostrophes, so the apostrophe step is left out.
 */

import { endsWithAny, isIn, letterSet, regionAfter, setAt, suffixMatcher, unmark } from "./snowball";

const V = letterSet("aeiouy");
const S_ENDING = letterSet("bdfghklmnrt");
const ST_ENDING = letterSet("bdfghklmnt");
const ET_ENDING = letterSet("dfgklmnrstUza");
/** -et is kept after these (Internet/interne, Planet/Plan, Ticket/Tick…). */
const ET_KEEP = ["geordn", "intern", "plan", "tick", "tr"];

const STEP1 = suffixMatcher([["em"], ["ern", "er", "erin", "erinnen"], ["e", "en", "es"], ["s"], ["ln", "lns"]]);
const STEP2 = suffixMatcher([["en", "er", "est"], ["st"], ["et"]]);
const STEP3 = suffixMatcher([["end", "ung"], ["ig", "ik", "isch"], ["lich", "heit"], ["keit"]]);
const AFTER_KEIT = suffixMatcher([["lich", "ig"]]);
const UMLAUT_PAIR = /[aou]e|qu/g;
/** Endings that keep a preceding ae, oe, ue as two letters (the e is the ending's). */
const INFLECTION = new Set(["e", "em", "en", "er", "ern", "es", "erin", "erinnen"]);

/** Marks u and y between vowels as `U`, `Y`, then reads ae, oe, ue (not after q) as a, o, u. */
const prelude = (word: string): string => {
	let s = word;
	for (let i = 1; i + 1 < s.length; i++) {
		const c = s.charCodeAt(i);
		if ((c === 117 || c === 121) && isIn(V, s, i - 1) && isIn(V, s, i + 1)) s = setAt(s, i, c === 117 ? "U" : "Y");
	}
	if (!/[aou]e/.test(s)) return s;
	const t = s;
	const r1 = Math.max(regionAfter(t, 0, V), 3);
	return t.replace(UMLAUT_PAIR, (m: string, at: number) =>
		m === "qu" || (at + 1 >= r1 && INFLECTION.has(t.slice(at + 1))) ? m : m.charAt(0),
	);
};

/** German stem of a lower-case word without umlauts. */
export const stemGerman = (word: string): string => {
	let w = prelude(word);
	const n = w.length;
	let p1 = n;
	let p2 = n;
	if (n >= 3) {
		const r1 = regionAfter(w, 0, V);
		p2 = regionAfter(w, r1, V);
		p1 = Math.max(r1, 3);
	}

	// Step 1.
	const a = STEP1(w);
	if (a !== undefined) {
		const k = w.length - a.word.length;
		if (k >= p1) {
			if (a.group === 0) {
				if (!(k >= 4 && w.startsWith("syst", k - 4))) w = w.slice(0, k);
			} else if (a.group === 1) w = w.slice(0, k);
			else if (a.group === 2) {
				w = w.slice(0, k);
				if (w.endsWith("niss")) w = w.slice(0, -1);
			} else if (a.group === 3) {
				if (isIn(S_ENDING, w, k - 1)) w = w.slice(0, k);
			} else w = `${w.slice(0, k)}l`;
		}
	}

	// Step 2.
	const b = STEP2(w);
	if (b !== undefined) {
		const k = w.length - b.word.length;
		if (k >= p1) {
			if (b.group === 0) w = w.slice(0, k);
			else if (b.group === 1) {
				if (isIn(ST_ENDING, w, k - 1) && k - 1 >= 3) w = w.slice(0, k);
			} else if (isIn(ET_ENDING, w, k - 1) && !endsWithAny(w, k, ET_KEEP)) w = w.slice(0, k);
		}
	}

	// Step 3: d-suffixes, in R2.
	const c = STEP3(w);
	if (c !== undefined) {
		const k = w.length - c.word.length;
		if (k >= p2) {
			const notE = w.charCodeAt(k - 1) !== 101;
			if (c.group === 0) {
				w = w.slice(0, k);
				if (w.endsWith("ig") && k - 2 >= p2 && w.charCodeAt(k - 3) !== 101) w = w.slice(0, -2);
			} else if (c.group === 1) {
				if (notE) w = w.slice(0, k);
			} else if (c.group === 2) {
				w = w.slice(0, k);
				if ((w.endsWith("er") || w.endsWith("en")) && k - 2 >= p1) w = w.slice(0, -2);
			} else {
				w = w.slice(0, k);
				const d = AFTER_KEIT(w);
				if (d !== undefined && k - d.word.length >= p2) w = w.slice(0, k - d.word.length);
			}
		}
	}

	return unmark(w);
};
