/**
 * Italian: the Snowball "italian" algorithm (snowballstem.org, version 3.x), our own code from the
 * published description, adapted to unaccented input.
 *
 * Words arrive without accents (à → a, è, é → e, ì → i, ò → o, ù → u); accented vowels are vowels as
 * their plain letters are, so regions do not move. Adaptations:
 * - -ità is matched as -ita (`attivita` → `attiv`, `citta` → `citt`), and step 3a's final à, è, ì, ò as
 *   plain vowels.
 * - The futures -erà, -erò, -irà, -irò are dropped: unaccented, they would cut nouns and adjectives
 *   (`numero`/`numeri`, `sincera`/`sincero`, `respiro`/`respiri`); `parlera` keeps the stem `parler`.
 * Elisions (l', dell', un'…) never reach the stemmer: the tokenizer splits on the apostrophe.
 */

import { isIn, letterSet, regionAfter, romanceRV, setAt, suffixMatcher, unmark } from "./snowball";

const V = letterSet("aeiou");
const AEIO = letterSet("aeio");

const PRONOUN = suffixMatcher([
	[
		"ci",
		"gli",
		"la",
		"le",
		"li",
		"lo",
		"mi",
		"ne",
		"si",
		"ti",
		"vi",
		"sene",
		"gliela",
		"gliele",
		"glieli",
		"glielo",
		"gliene",
		"mela",
		"mele",
		"meli",
		"melo",
		"mene",
		"tela",
		"tele",
		"teli",
		"telo",
		"tene",
		"cela",
		"cele",
		"celi",
		"celo",
		"cene",
		"vela",
		"vele",
		"veli",
		"velo",
		"vene",
	],
]);
const PRONOUN_AFTER = suffixMatcher([
	["ando", "endo"],
	["ar", "er", "ir"],
]);

const STANDARD = suffixMatcher([
	[
		"anza",
		"anze",
		"ico",
		"ici",
		"ica",
		"ice",
		"iche",
		"ichi",
		"ismo",
		"ismi",
		"abile",
		"abili",
		"ibile",
		"ibili",
		"ista",
		"iste",
		"isti",
		"oso",
		"osi",
		"osa",
		"ose",
		"mente",
		"atrice",
		"atrici",
		"ante",
		"anti",
	],
	["azione", "azioni", "atore", "atori"],
	["logia", "logie"],
	["uzione", "uzioni", "usione", "usioni"],
	["enza", "enze"],
	["amento", "amenti", "imento", "imenti"],
	["amente"],
	["ita"],
	["ivo", "ivi", "iva", "ive"],
]);
const AFTER_AMENTE = suffixMatcher([["iv"], ["os", "ic", "abil"]]);
const AFTER_ITA = suffixMatcher([["abil", "ic", "iv"]]);

const VERB = suffixMatcher([
	[
		"ammo",
		"ando",
		"ano",
		"are",
		"arono",
		"asse",
		"assero",
		"assi",
		"assimo",
		"ata",
		"ate",
		"ati",
		"ato",
		"ava",
		"avamo",
		"avano",
		"avate",
		"avi",
		"avo",
		"emmo",
		"enda",
		"ende",
		"endi",
		"endo",
		"erai",
		"eranno",
		"ere",
		"erebbe",
		"erebbero",
		"erei",
		"eremmo",
		"eremo",
		"ereste",
		"eresti",
		"erete",
		"erono",
		"essero",
		"ete",
		"eva",
		"evamo",
		"evano",
		"evate",
		"evi",
		"evo",
		"iamo",
		"immo",
		"irai",
		"iranno",
		"ire",
		"irebbe",
		"irebbero",
		"irei",
		"iremmo",
		"iremo",
		"ireste",
		"iresti",
		"irete",
		"irono",
		"isca",
		"iscano",
		"isce",
		"isci",
		"isco",
		"iscono",
		"issero",
		"ita",
		"ite",
		"iti",
		"ito",
		"iva",
		"ivamo",
		"ivano",
		"ivate",
		"ivi",
		"ivo",
		"ono",
		"uta",
		"ute",
		"uti",
		"uto",
		"ar",
		"ir",
	],
]);

/** Marks u after q, then u and i between vowels, as `U`, `I` (non-vowels from then on). */
const mark = (word: string): string => {
	let s = word;
	for (let i = s.indexOf("qu"); i >= 0; i = s.indexOf("qu", i + 2)) s = setAt(s, i + 1, "U");
	for (let i = 1; i + 1 < s.length; i++) {
		const c = s.charCodeAt(i);
		if ((c === 117 || c === 105) && isIn(V, s, i - 1) && isIn(V, s, i + 1)) s = setAt(s, i, c === 117 ? "U" : "I");
	}
	return s;
};

/** Italian stem of a lower-case, unaccented word. */
export const stemItalian = (word: string): string => {
	let w = mark(word);
	const pV = isIn(V, w, 0) || !w.startsWith("divan") ? romanceRV(w, V) : 5;
	const p1 = regionAfter(w, 0, V);
	const p2 = regionAfter(w, p1, V);

	// Step 0: attached pronoun after a gerund or infinitive in RV (`guardandogli` → `guardando`,
	// `accomodarci` → `accomodare`).
	const pr = PRONOUN(w);
	if (pr !== undefined) {
		const k = w.length - pr.word.length;
		const verb = PRONOUN_AFTER(w, 0, k);
		if (verb !== undefined && k - verb.word.length >= pV)
			w = verb.group === 0 ? w.slice(0, k) : `${w.slice(0, k)}e`;
	}

	// Step 1: standard suffixes.
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
					if (w.endsWith("ic") && k - 2 >= p2) w = w.slice(0, -2);
				}
				break;
			case 2:
				if (k >= p2) [w, done] = [`${head}log`, true];
				break;
			case 3:
				if (k >= p2) [w, done] = [`${head}u`, true];
				break;
			case 4:
				if (k >= p2) [w, done] = [`${head}ente`, true];
				break;
			case 5:
				if (k >= pV) [w, done] = [head, true];
				break;
			case 6:
				if (k >= p1) {
					[w, done] = [head, true];
					const a = AFTER_AMENTE(w);
					if (a !== undefined && k - a.word.length >= p2) {
						w = w.slice(0, k - a.word.length);
						if (a.group === 0 && w.endsWith("at") && k - 4 >= p2) w = w.slice(0, -2);
					}
				}
				break;
			case 7:
				if (k >= p2) {
					[w, done] = [head, true];
					const a = AFTER_ITA(w);
					if (a !== undefined && k - a.word.length >= p2) w = w.slice(0, k - a.word.length);
				}
				break;
			default:
				if (k >= p2) {
					[w, done] = [head, true];
					if (w.endsWith("at") && k - 2 >= p2) {
						w = w.slice(0, -2);
						if (w.endsWith("ic") && k - 4 >= p2) w = w.slice(0, -2);
					}
				}
		}
	}

	// Step 2: verb suffixes in RV.
	if (!done) {
		const v = VERB(w, pV);
		if (v !== undefined) w = w.slice(0, w.length - v.word.length);
	}

	// Step 3a: a final vowel in RV, and an i before it in RV (`crocchi`, `crocchio` → `crocch`).
	let n = w.length;
	if (isIn(AEIO, w, n - 1) && n - 1 >= pV) {
		w = w.slice(0, -1);
		n--;
		if (w.charCodeAt(n - 1) === 105 && n - 1 >= pV) w = w.slice(0, -1);
	}
	// Step 3b: final ch, gh in RV → c, g.
	n = w.length;
	const before = w.charCodeAt(n - 2);
	if (w.charCodeAt(n - 1) === 104 && (before === 99 || before === 103) && n - 2 >= pV) w = w.slice(0, -1);
	return unmark(w);
};
