/**
 * Swedish: the Snowball "swedish" algorithm (snowballstem.org, version 3.x), our own code from the
 * published description, adapted to unaccented input.
 *
 * Words arrive without accents (å, ä → a; ö → o); they are vowels as their plain letters are, so R1
 * does not move. Adaptations:
 * - Step 3's -öst → -ös is matched as -ost → -os (`hopplost` → `hopplos`).
 * - A final s after o is kept when the o follows a valid öst-ending letter (i, k, l, n, p, r, t, u, v):
 *   unaccented, that is most often -ös (`hopplos`, `nervos` stay whole, as `hopplös` did, and so share
 *   a stem with `hopplost`, `hopplosa`). The original drops s after any o (genitives like `kontos`) and
 *   never after ö.
 * - Not adaptable: endings that had å, ä or ö now read as the plain ones, so -är, -ör, -å words lose
 *   -ar, -or, -a as plurals do (`affar` → `aff` but `affarer` → `affar`; `aktor` → `akt`).
 */

import { endsWithAny, isIn, isOut, letterSet, regionAfter, suffixMatcher } from "./snowball";

const V = letterSet("aeiouy");
const S_ENDING = letterSet("bcdfghjklmnoprtvy");
const OST_ENDING = letterSet("iklnprtuv");
/** -et and -ets stay after these (frihet, societet, alfabet, komet, paket…). */
const ET_KEEP = [
	"h",
	"iet",
	"uit",
	"fab",
	"cit",
	"dit",
	"alit",
	"ilit",
	"mit",
	"nit",
	"pit",
	"rit",
	"sit",
	"tit",
	"ivit",
	"kvit",
	"xit",
	"kom",
	"rak",
	"pak",
	"stak",
];

const MAIN = suffixMatcher([
	[
		"a",
		"arna",
		"erna",
		"heterna",
		"orna",
		"ad",
		"e",
		"ade",
		"ande",
		"arne",
		"are",
		"aste",
		"en",
		"anden",
		"aren",
		"heten",
		"ern",
		"ar",
		"er",
		"heter",
		"or",
		"as",
		"arnas",
		"ernas",
		"ornas",
		"es",
		"ades",
		"andes",
		"ens",
		"arens",
		"hetens",
		"erns",
		"at",
		"andet",
		"het",
		"ast",
	],
	["s"],
	["et"],
]);
const PAIR = suffixMatcher([["dd", "gd", "nn", "dt", "gt", "kt", "tt"]]);
const OTHER = suffixMatcher([["lig", "ig", "els"], ["ost"], ["fullt"]]);

/** Whether `s` before `k` is a valid et-ending: a letter, a vowel, a non-vowel, and none of {@link ET_KEEP}. */
const etEnding = (s: string, k: number): boolean =>
	k >= 3 && isOut(V, s, k - 1) && isIn(V, s, k - 2) && !endsWithAny(s, k, ET_KEEP);

/** Swedish stem of a lower-case, unaccented word. */
export const stemSwedish = (word: string): string => {
	let w = word;
	const p1 = w.length >= 3 ? Math.max(regionAfter(w, 0, V), 3) : w.length;

	// Step 1: main suffixes in R1.
	const m = MAIN(w, p1);
	if (m !== undefined) {
		const k = w.length - m.word.length;
		if (m.group === 0) w = w.slice(0, k);
		else if (m.group === 1) {
			if (k >= 2 && w.startsWith("et", k - 2) && etEnding(w, k - 2)) w = w.slice(0, k - 2);
			else if (isIn(S_ENDING, w, k - 1) && !(w.charCodeAt(k - 1) === 111 && isIn(OST_ENDING, w, k - 2)))
				w = w.slice(0, k);
		} else if (etEnding(w, k)) w = w.slice(0, k);
	}

	// Step 2: a final consonant pair in R1 loses its last letter.
	if (PAIR(w, p1) !== undefined) w = w.slice(0, -1);

	// Step 3: -lig, -ig, -els; -öst → -ös; -fullt → -full; in R1.
	const o = OTHER(w, p1);
	if (o !== undefined) {
		const k = w.length - o.word.length;
		if (o.group === 0) w = w.slice(0, k);
		else if (o.group === 1) {
			if (isIn(OST_ENDING, w, k - 1)) w = w.slice(0, -1);
		} else w = w.slice(0, -1);
	}
	return w;
};
