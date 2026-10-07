/**
 * English: the Porter2 algorithm (Snowball "english", as published at snowballstem.org, version 3.1),
 * with its exception list and its R1 prefixes. Our own code from the algorithm description.
 *
 * Tokens never contain apostrophes (the tokenizer splits on them), so the apostrophe steps are left out.
 */

import { hasIn, isIn, isOut, letterSet, regionAfter, suffixMatcher } from "./snowball";

type Rule = readonly [replacement: string, suffixes: readonly string[]];

const V = letterSet("aeiouy");
/** Letters that cannot end a short syllable besides the vowels: w, x and a consonant y (`Y`). */
const WXY = letterSet("wxY");
const LI = letterSet("cdeghkmnrt");
const AEO = letterSet("aeo");
const DOUBLE = letterSet("bdfgmnprt");

/** Whole words stemmed specially, or left as they are. */
const EXCEPTIONS = new Map<string, string>([
	["skis", "ski"],
	["skies", "sky"],
	["idly", "idl"],
	["gently", "gentl"],
	["ugly", "ugli"],
	["early", "earli"],
	["only", "onli"],
	["singly", "singl"],
	["sky", "sky"],
	["news", "news"],
	["howe", "howe"],
	["atlas", "atlas"],
	["cosmos", "cosmos"],
	["bias", "bias"],
	["andes", "andes"],
]);

/** Words beginning with these have R1 right after them (generate/general, past/paste, univers…). */
const R1_PREFIXES = ["gener", "commun", "arsen", "past", "univers", "later", "emerg", "organ", "inter"];

const STEP1A = suffixMatcher([["sses"], ["ied", "ies"], ["s"], ["us", "ss"]]);
const STEP1B = suffixMatcher([["eed", "eedly"], ["ed", "edly", "ingly"], ["ing"]]);
/** -ing words left alone (inning, outing, canning, herring, earring, evening). */
const ING_KEEP = new Set(["inn", "out", "cann", "herr", "earr", "even"]);

/** Step 2, in R1. `-ogi` needs a preceding l and `-li` a valid li-ending (below). */
const STEP2_RULES: readonly Rule[] = [
	["tion", ["tional"]],
	["ence", ["enci"]],
	["ance", ["anci"]],
	["able", ["abli"]],
	["ent", ["entli"]],
	["ize", ["izer", "ization"]],
	["ate", ["ational", "ation", "ator"]],
	["al", ["alism", "aliti", "alli"]],
	["ful", ["fulness"]],
	["ous", ["ousli", "ousness"]],
	["ive", ["iveness", "iviti"]],
	["ble", ["biliti", "bli"]],
	["og", ["ogist"]],
	["og", ["ogi"]],
	["ful", ["fulli"]],
	["less", ["lessli"]],
	["", ["li"]],
];
const STEP2 = suffixMatcher(STEP2_RULES.map((r) => r[1]));
const STEP2_OGI = 13;
const STEP2_LI = 16;

/** Step 3, in R1; `-ative` in R2. */
const STEP3_RULES: readonly Rule[] = [
	["tion", ["tional"]],
	["ate", ["ational"]],
	["al", ["alize"]],
	["ic", ["icate", "iciti", "ical"]],
	["", ["ful", "ness"]],
	["", ["ative"]],
];
const STEP3 = suffixMatcher(STEP3_RULES.map((r) => r[1]));
const STEP3_ATIVE = 5;

/** Step 4, deleted in R2; `-ion` only after s or t. */
const STEP4 = suffixMatcher([
	[
		"al",
		"ance",
		"ence",
		"er",
		"ic",
		"able",
		"ible",
		"ant",
		"ement",
		"ment",
		"ent",
		"ism",
		"ate",
		"iti",
		"ous",
		"ive",
		"ize",
	],
	["ion"],
]);

/**
 * Whether `s` before `k` ends in a short syllable: consonant–vowel–consonant (the last not w, x or Y),
 * a vowel–consonant word start, or `past`.
 */
const endsShort = (s: string, k: number): boolean =>
	(k >= 3 && isOut(V, s, k - 1) && !isIn(WXY, s, k - 1) && isIn(V, s, k - 2) && isOut(V, s, k - 3)) ||
	(k === 2 && isIn(V, s, 0) && isOut(V, s, 1)) ||
	(k >= 4 && s.startsWith("past", k - 4));

/** Marks a consonant y as `Y`: at the start, or after a vowel. */
const markY = (word: string): string => {
	let s = word;
	for (let i = s.indexOf("y"); i >= 0; i = s.indexOf("y", i + 1))
		if (i === 0 || isIn(V, s, i - 1)) s = `${s.slice(0, i)}Y${s.slice(i + 1)}`;
	return s;
};

/** Step 1b's -ed/-ing removal and repair (`hopp` → `hop`, `luxuriat` → `luxuriate`, `hop` → `hope`). */
const stripEdIng = (s: string, k: number, p1: number): string => {
	if (!hasIn(V, s, 0, k)) return s;
	const w = s.slice(0, k);
	const n = w.length;
	if (w.endsWith("at") || w.endsWith("bl") || w.endsWith("iz")) return `${w}e`;
	if (n >= 2 && w.charCodeAt(n - 1) === w.charCodeAt(n - 2) && isIn(DOUBLE, w, n - 1))
		return n === 3 && isIn(AEO, w, 0) ? w : w.slice(0, -1);
	return n === p1 && endsShort(w, n) ? `${w}e` : w;
};

/** Porter2 stem of a lower-case word. */
export const stemEnglish = (word: string): string => {
	const special = EXCEPTIONS.get(word);
	if (special !== undefined) return special;
	if (word.length < 3) return word;

	let w = word.includes("y") ? markY(word) : word;
	const prefix = R1_PREFIXES.find((p) => w.startsWith(p));
	const p1 = prefix !== undefined ? prefix.length : regionAfter(w, 0, V);
	const p2 = regionAfter(w, p1, V);

	// Step 1a: plurals.
	const a = STEP1A(w);
	if (a !== undefined) {
		if (a.group === 0) w = w.slice(0, -2);
		else if (a.group === 1) w = w.length > 4 ? w.slice(0, -2) : w.slice(0, -1);
		else if (a.group === 2 && hasIn(V, w, 0, w.length - 2)) w = w.slice(0, -1);
	}

	// Step 1b: -eed, -ed, -ing.
	const b = STEP1B(w);
	if (b !== undefined) {
		const k = w.length - b.word.length;
		if (b.group === 0) {
			if (k >= p1) {
				const head = w.slice(0, k);
				if (head !== "proc" && head !== "exc" && head !== "succ") w = `${head}ee`;
			}
		} else if (b.group === 2 && k === 2 && w.charCodeAt(1) === 121 && isOut(V, w, 0)) {
			w = `${w.slice(0, 1)}ie`; // dying → die, lying → lie
		} else if (b.group !== 2 || !ING_KEEP.has(w.slice(0, k))) {
			w = stripEdIng(w, k, p1);
		}
	}

	// Step 1c: final y after a consonant that is not the first letter → i.
	let n = w.length;
	const last = w.charCodeAt(n - 1);
	if ((last === 121 || last === 89) && n >= 3 && isOut(V, w, n - 2)) w = `${w.slice(0, -1)}i`;

	// Step 2.
	const s2 = STEP2(w);
	if (s2 !== undefined) {
		const k = w.length - s2.word.length;
		const ok =
			k >= p1 &&
			(s2.group !== STEP2_OGI || w.charCodeAt(k - 1) === 108) &&
			(s2.group !== STEP2_LI || isIn(LI, w, k - 1));
		if (ok) w = w.slice(0, k) + (STEP2_RULES[s2.group]?.[0] ?? "");
	}

	// Step 3.
	const s3 = STEP3(w);
	if (s3 !== undefined) {
		const k = w.length - s3.word.length;
		if (k >= p1 && (s3.group !== STEP3_ATIVE || k >= p2)) w = w.slice(0, k) + (STEP3_RULES[s3.group]?.[0] ?? "");
	}

	// Step 4.
	const s4 = STEP4(w);
	if (s4 !== undefined) {
		const k = w.length - s4.word.length;
		const c = w.charCodeAt(k - 1);
		if (k >= p2 && (s4.group === 0 || c === 115 || c === 116)) w = w.slice(0, k);
	}

	// Step 5: final e (in R2, or in R1 after a long syllable); ll in R2.
	n = w.length;
	const end = w.charCodeAt(n - 1);
	if (end === 101) {
		if (n - 1 >= p2 || (n - 1 >= p1 && !endsShort(w, n - 1))) w = w.slice(0, -1);
	} else if (end === 108 && n - 1 >= p2 && w.charCodeAt(n - 2) === 108) {
		w = w.slice(0, -1);
	}

	return w.includes("Y") ? w.replace(/Y/g, "y") : w;
};
