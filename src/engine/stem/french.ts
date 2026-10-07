/**
 * French: the Snowball "french" algorithm (snowballstem.org, version 3.x), our own code from the
 * published description, adapted to unaccented input.
 *
 * Adaptations, because words arrive without accents (é, è, ê → e; â, à → a; î, ï → i; ç → c…):
 * - Suffixes written with an accent are matched without it: -ité → -ite, -ière → -iere, -é/-ée/-ées/-és
 *   → -e/-ee/-ees/-es (step 2b), so `activites` and `activite` still share a stem.
 * - Unaccented forms that would collide with common endings are dropped: -îmes and -îtes (step 2a:
 *   `regimes`, `limites`), -âmes, -ât, -âtes (step 2b: `drames`, `resultat`, `delicates`) and -èrent
 *   (step 2b: `different`). These are past-historic forms, rare in notes.
 * - Step 2b's -e and -es (for -é, -és) do not apply after -ier, so -ière(s) still reaches step 4's
 *   -ière → i (`premiere` and `premier` → `premi`).
 * - Step 4 keeps a final s after a, i, o, u or s; the original also keeps it after è, which can no
 *   longer be told from e (plural -es is far more common: `grandes` → `grand`).
 * - The diaeresis marks (ë, ï → He, Hi) and the final un-accent step have nothing to act on.
 * Elisions (l', d', qu'…) never reach the stemmer: the tokenizer splits on the apostrophe.
 */

import { endsWithAny, isIn, isOut, letterSet, regionAfter, setAt, suffixMatcher, unmark } from "./snowball";

const V = letterSet("aeiouy");
const KEEP_S = letterSet("aious");
const OUX = letterSet("bhjlnp");

const STANDARD = suffixMatcher([
	["ance", "iqUe", "isme", "able", "iste", "eux", "ances", "iqUes", "ismes", "ables", "istes"],
	["atrice", "ateur", "ation", "atrices", "ateurs", "ations"],
	["logie", "logies"],
	["usion", "ution", "usions", "utions"],
	["ence", "ences"],
	["ement", "ements"],
	["ite", "ites"],
	["if", "ive", "ifs", "ives"],
	["eaux"],
	["aux"],
	["oux"],
	["euse", "euses"],
	["issement", "issements"],
	["amment"],
	["emment"],
	["ment", "ments"],
]);
const AFTER_EMENT = suffixMatcher([["iv"], ["eus"], ["abl", "iqU"], ["ier", "Ier"]]);
const AFTER_ITE = suffixMatcher([["abil"], ["ic"], ["iv"]]);

const I_VERB = suffixMatcher([
	[
		"i",
		"ie",
		"ies",
		"ir",
		"ira",
		"irai",
		"iraIent",
		"irais",
		"irait",
		"iras",
		"irent",
		"irez",
		"iriez",
		"irions",
		"irons",
		"iront",
		"is",
		"issaIent",
		"issais",
		"issait",
		"issant",
		"issante",
		"issantes",
		"issants",
		"isse",
		"issent",
		"isses",
		"issez",
		"issiez",
		"issions",
		"issons",
		"it",
	],
]);

const VERB = suffixMatcher([
	["ions"],
	[
		"e",
		"ee",
		"ees",
		"es",
		"er",
		"era",
		"erai",
		"eraIent",
		"erais",
		"erait",
		"eras",
		"erez",
		"eriez",
		"erions",
		"erons",
		"eront",
		"ez",
		"iez",
	],
	["a", "ai", "aIent", "ait", "ant", "ante", "antes", "ants", "as", "asse", "assent", "asses", "assiez", "assions"],
	["ais", "aise", "aises"],
	["eais"],
]);

const IER = ["ier", "Ier"];
const AIS_KEEP = ["auv", "epl"];
const RESIDUAL = suffixMatcher([["ion"], ["ier", "iere", "Ier", "Iere"], ["e"]]);
const UNDOUBLE = suffixMatcher([["enn", "onn", "ett", "ell", "eill"]]);

/**
 * Marks, left to right, u and i between vowels, y before or after a vowel and u after q as `U`, `I`,
 * `Y` (non-vowels from then on, so a marked letter no longer counts as the vowel next to the following one).
 */
const mark = (word: string): string => {
	let s = word;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		const d = s.charCodeAt(i + 1);
		const vowel = V[c] === 1;
		if (vowel && (d === 117 || d === 105) && isIn(V, s, i + 2)) s = setAt(s, i + 1, d === 117 ? "U" : "I");
		else if (vowel && d === 121) s = setAt(s, i + 1, "Y");
		else if (c === 121 && isIn(V, s, i + 1)) s = setAt(s, i, "Y");
		else if (c === 113 && d === 117) s = setAt(s, i + 1, "U");
	}
	return s;
};

/**
 * Start of RV: after the third letter when the word starts with two vowels, or with par-, col-, tap- or
 * ni + vowel; else after the first vowel that is not the first letter; else the end of the word.
 */
const rvStart = (s: string): number => {
	const n = s.length;
	if (n >= 3 && isIn(V, s, 0) && isIn(V, s, 1)) return 3;
	if (s.startsWith("par") || s.startsWith("col") || s.startsWith("tap")) return 3;
	if (s.startsWith("ni") && isIn(V, s, 2)) return 3;
	for (let i = 1; i < n; i++) if (isIn(V, s, i)) return i + 1;
	return n;
};

/** French stem of a lower-case, unaccented word. */
export const stemFrench = (word: string): string => {
	let w = mark(word);
	const pV = rvStart(w);
	const p1 = regionAfter(w, 0, V);
	const p2 = regionAfter(w, p1, V);

	// Step 1: standard suffixes. `done` when one was removed (the -ment family goes on to step 2 anyway).
	let done = false;
	const m = STANDARD(w);
	if (m !== undefined) {
		const k = w.length - m.word.length;
		const head = w.slice(0, k);
		switch (m.group) {
			case 0:
				if (k >= p2) [w, done] = [head, true];
				break;
			case 1:
				if (k >= p2) {
					[w, done] = [head, true];
					if (w.endsWith("ic")) w = k - 2 >= p2 ? w.slice(0, -2) : `${w.slice(0, -2)}iqU`;
				}
				break;
			case 2:
				if (k >= p2) [w, done] = [`${head}log`, true];
				break;
			case 3:
				if (k >= p2) [w, done] = [`${head}u`, true];
				break;
			case 4:
				if (k >= p2) [w, done] = [`${head}ent`, true];
				break;
			case 5:
				if (k >= pV) {
					[w, done] = [head, true];
					const e = AFTER_EMENT(w);
					if (e !== undefined) {
						const j = k - e.word.length;
						if (e.group === 0) {
							if (j >= p2) {
								w = w.slice(0, j);
								if (w.endsWith("at") && j - 2 >= p2) w = w.slice(0, -2);
							}
						} else if (e.group === 1) {
							if (j >= p2) w = w.slice(0, j);
							else if (j >= p1) w = `${w.slice(0, j)}eux`;
						} else if (e.group === 2) {
							if (j >= p2) w = w.slice(0, j);
						} else if (j >= pV) {
							w = `${w.slice(0, j)}i`;
						}
					}
				}
				break;
			case 6:
				if (k >= p2) {
					[w, done] = [head, true];
					const e = AFTER_ITE(w);
					if (e !== undefined) {
						const j = k - e.word.length;
						if (j >= p2) w = w.slice(0, j);
						else if (e.group === 0) w = `${w.slice(0, j)}abl`;
						else if (e.group === 1) w = `${w.slice(0, j)}iqU`;
					}
				}
				break;
			case 7:
				if (k >= p2) {
					[w, done] = [head, true];
					if (w.endsWith("at") && k - 2 >= p2) {
						w = w.slice(0, -2);
						if (w.endsWith("ic")) w = k - 4 >= p2 ? w.slice(0, -2) : `${w.slice(0, -2)}iqU`;
					}
				}
				break;
			case 8:
				[w, done] = [`${head}eau`, true];
				break;
			case 9:
				if (k >= p1) [w, done] = [`${head}al`, true];
				break;
			case 10:
				if (isIn(OUX, w, k - 1)) [w, done] = [`${head}ou`, true];
				break;
			case 11:
				if (k >= p2) [w, done] = [head, true];
				else if (k >= p1) [w, done] = [`${head}eux`, true];
				break;
			case 12:
				if (k >= p1 && isOut(V, w, k - 1)) [w, done] = [head, true];
				break;
			case 13:
				if (k >= pV) w = `${head}ant`;
				break;
			case 14:
				if (k >= pV) w = `${head}ent`;
				break;
			default:
				if (isIn(V, w, k - 1) && k - 1 >= pV) w = head;
		}
	}

	// Step 2a: verb suffixes beginning with i, in RV, after a non-vowel also in RV.
	if (!done) {
		const v = I_VERB(w, pV);
		if (v !== undefined) {
			const k = w.length - v.word.length;
			if (k - 1 >= pV && isOut(V, w, k - 1)) [w, done] = [w.slice(0, k), true];
		}
	}

	// Step 2b: other verb suffixes, in RV.
	if (!done) {
		const v = VERB(w, pV);
		if (v !== undefined) {
			const k = w.length - v.word.length;
			switch (v.group) {
				case 0:
					if (k >= p2) [w, done] = [w.slice(0, k), true];
					break;
				case 1:
					// -e/-es (for -é/-és) leave -ière(s) to step 4.
					if (!((v.word === "e" || v.word === "es") && endsWithAny(w, k, IER)))
						[w, done] = [w.slice(0, k), true];
					break;
				case 2:
					[w, done] = [w.slice(0, w.charCodeAt(k - 1) === 101 && k - 1 >= pV ? k - 1 : k), true];
					break;
				case 3: {
					// Kept after one letter + al (palais), auv (mauvais), épl (déplais).
					const kept = (k === 3 && w.startsWith("al", 1)) || endsWithAny(w, k, AIS_KEEP);
					if (!kept) [w, done] = [w.slice(0, k), true];
					break;
				}
				default:
					[w, done] = [w.slice(0, k), true];
			}
		}
	}

	if (done) {
		// Step 3: a final Y becomes i (ç has already become c).
		if (w.endsWith("Y")) w = `${w.slice(0, -1)}i`;
	} else {
		// Step 4: residual suffixes.
		const n = w.length;
		if (w.charCodeAt(n - 1) === 115 && isOut(KEEP_S, w, n - 2)) w = w.slice(0, -1);
		const r = RESIDUAL(w, pV);
		if (r !== undefined) {
			const k = w.length - r.word.length;
			const c = w.charCodeAt(k - 1);
			if (r.group === 0) {
				if (k >= p2 && k - 1 >= pV && (c === 115 || c === 116)) w = w.slice(0, k);
			} else w = r.group === 1 ? `${w.slice(0, k)}i` : w.slice(0, k);
		}
	}

	// Step 5: undouble -enn, -onn, -ett, -ell, -eill.
	if (UNDOUBLE(w) !== undefined) w = w.slice(0, -1);
	return unmark(w);
};
