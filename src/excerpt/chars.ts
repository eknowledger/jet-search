import { normalize } from "../engine/analyzer";

/**
 * Character kinds and the exact word rules of the analyzer checked on raw text:
 * where a word or compound part starts and ends (camelCase, letter–digit), the Arabic article, and a
 * per-character fold. Kinds come from Unicode properties, looked up once per character and cached, so
 * the regular expressions that find candidates never carry `\p{…}` classes (they cost ~1 ms to compile).
 */

const OTHER = 0;
const LOWER = 1;
const UPPER = 2;
const DIGIT = 3;
const MARK = 4;
/** A letter without case (Arabic, Hebrew…) from a script written with spaces. */
const LETTER = 5;
/** A letter from a script without spaces (Han, kana, Thai…). */
const SPACELESS = 6;

/** Scripts written without spaces: their terms match anywhere, with no word boundary. */
const FREE =
	"\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}\\u30fc" +
	"\\p{Script=Thai}\\p{Script=Lao}\\p{Script=Khmer}\\p{Script=Myanmar}";
const STARTS_FREE = new RegExp(`^[${FREE}]`, "u");

/** Whether a word is from a script without spaces (Chinese/Japanese pairs, segmented Thai…). */
export const isFree = (word: string): boolean => STARTS_FREE.test(word);

const P_M = /\p{M}/u;
const P_LL = /\p{Ll}/u;
const P_LU = /[\p{Lu}\p{Lt}]/u;
const P_N = /\p{N}/u;
const P_FREE = new RegExp(`[${FREE}]`, "u");
const P_L = /\p{L}/u;

const classify = (ch: string): number => {
	// The tatweel only stretches a word: treat it like a mark.
	if (P_M.test(ch) || ch === "\u0640") return MARK;
	if (P_LL.test(ch)) return LOWER;
	if (P_LU.test(ch)) return UPPER;
	if (P_N.test(ch)) return DIGIT;
	if (P_FREE.test(ch)) return SPACELESS;
	return P_L.test(ch) ? LETTER : OTHER;
};

/** Kinds of BMP characters, filled on first sight (0 = not yet known, else kind + 1). */
const known = new Uint8Array(0x10000);

/** The kind of the character at `i` (a whole surrogate pair when `i` starts one); OTHER out of range. */
const kindAt = (text: string, i: number): number => {
	if (i < 0 || i >= text.length) return OTHER;
	const c = text.charCodeAt(i);
	if (c < 0x80) {
		if (c >= 0x61 && c <= 0x7a) return LOWER;
		if (c >= 0x41 && c <= 0x5a) return UPPER;
		return c >= 0x30 && c <= 0x39 ? DIGIT : OTHER;
	}
	if (c >= 0xd800 && c <= 0xdbff) return classify(String.fromCodePoint(text.codePointAt(i) ?? c));
	const k = known[c] ?? 0;
	if (k > 0) return k - 1;
	const kind = classify(String.fromCharCode(c));
	known[c] = kind + 1;
	return kind;
};

/** Code units of the character at `i`. */
const sizeAt = (text: string, i: number): number => {
	const c = text.charCodeAt(i);
	if (c < 0xd800 || c > 0xdbff) return 1;
	const d = text.charCodeAt(i + 1);
	return d >= 0xdc00 && d <= 0xdfff ? 2 : 1;
};

/** Start of the character before `i`, skipping marks; -1 at the text start. */
const baseBefore = (text: string, i: number): number => {
	let j = i - 1;
	for (;;) {
		if (j < 0) return -1;
		const c = text.charCodeAt(j);
		if (c >= 0xdc00 && c <= 0xdfff && j > 0) {
			const h = text.charCodeAt(j - 1);
			if (h >= 0xd800 && h <= 0xdbff) j--;
		}
		if (kindAt(text, j) !== MARK) return j;
		j--;
	}
};

/** Kind of the first character from `i` on that is not a mark. */
const kindAfterMarks = (text: string, i: number): number => {
	while (i < text.length) {
		const k = kindAt(text, i);
		if (k !== MARK) return k;
		i += sizeAt(text, i);
	}
	return OTHER;
};

const isLetter = (k: number): boolean => k === LOWER || k === UPPER || k === LETTER || k === SPACELESS;

/**
 * Whether a word or compound part starts at `i`: at the text start or after a non-letter, after or at a
 * spaceless script, at camelCase (`Nebula|SDK`, `HTML|Parser`) or at a letter–digit boundary (`Atlas|2026`).
 */
export const startsWord = (text: string, i: number): boolean => {
	const p = baseBefore(text, i);
	const kp = kindAt(text, p);
	if (kp === OTHER || kp === SPACELESS) return true;
	const k = kindAt(text, i);
	if (k === DIGIT) return kp !== DIGIT;
	if (kp === DIGIT || k === SPACELESS) return true;
	if (k !== UPPER) return false;
	return kp !== UPPER || kindAfterMarks(text, i + sizeAt(text, i)) === LOWER;
};

/** Alef and its hamza/madda/wasla forms; the prepositions wa-, bi-, ka-, fa- joined before the article. */
const ALIF = "\u0627\u0622\u0623\u0625\u0671";
const PREPOSITION = "\u0648\u0628\u0643\u0641";
const LAM = "\u0644";

/** Whether `i` follows an Arabic article at a word start (al-, wal-, bil-, kal-, fal-, lil-), marks allowed. */
export const afterArticle = (text: string, i: number): boolean => {
	const lam = baseBefore(text, i);
	if (lam < 0 || text[lam] !== LAM) return false;
	const a = baseBefore(text, lam);
	if (a < 0 || !(ALIF.includes(text[a] ?? "x") || text[a] === LAM)) return false;
	const b = baseBefore(text, a);
	if (!isLetter(kindAt(text, b))) return true;
	return text[a] !== LAM && PREPOSITION.includes(text[b] ?? "x") && !isLetter(kindAt(text, baseBefore(text, b)));
};

/** Whether a word part ends at `i` (exact words, phrases): before a non-letter, a spaceless script or a part. */
export const endsWord = (text: string, i: number): boolean => {
	const k = kindAfterMarks(text, i);
	if (k === OTHER || k === SPACELESS) return true;
	const kp = kindAt(text, baseBefore(text, i));
	if (k === DIGIT || kp === DIGIT) return k !== kp;
	if (k !== UPPER) return false;
	if (kp !== UPPER) return true;
	let j = i;
	while (kindAt(text, j) === MARK) j++;
	return kindAfterMarks(text, j + sizeAt(text, j)) === LOWER;
};

/**
 * Where the word part of a hit ends, for highlighting: a prefix term `spee` matched at `start..end`
 * extends over the rest of `speech`, but stops at the next compound part (`Nebula|SDK`, `Atlas|2026`,
 * `HTML|Parser`). Spaceless scripts are not extended (a Chinese run is a whole sentence).
 */
export const wordEnd = (text: string, start: number, end: number): number => {
	let prev = OTHER;
	for (let i = start; i < end; i += sizeAt(text, i)) {
		const k = kindAt(text, i);
		if (k === SPACELESS) return end;
		if (k !== MARK) prev = k;
	}
	let i = end;
	while (i < text.length) {
		const k = kindAt(text, i);
		const n = sizeAt(text, i);
		if (k === MARK) {
			i += n;
			continue;
		}
		if (k === OTHER || k === SPACELESS) break;
		if (prev === DIGIT ? k !== DIGIT : k === DIGIT) break;
		if (k === UPPER && (prev !== UPPER || kindAfterMarks(text, i + n) === LOWER)) break;
		prev = k;
		i += n;
	}
	return i;
};

/** Whether the character at `i` is a letter, digit or mark (part of a word). */
export const inWord = (text: string, i: number): boolean => kindAt(text, i) !== OTHER;

/** Per-character folds as the analyzer would give them (`É` → `e`, `ß` → `ss`, marks → ""), cached. */
const folds = new Map<number, string>();

/** The character at `i` folded like the index (σ and ς as one letter), and its length in code units. */
export const foldAt = (text: string, i: number): [string, number] => {
	const c = text.charCodeAt(i);
	if (c < 0x80) return [c >= 0x41 && c <= 0x5a ? String.fromCharCode(c + 32) : String.fromCharCode(c), 1];
	const n = sizeAt(text, i);
	const cp = n === 2 ? (text.codePointAt(i) ?? c) : c;
	let f = folds.get(cp);
	if (f === undefined) {
		f = normalize(String.fromCodePoint(cp)).replace(/ς/g, "σ");
		folds.set(cp, f);
	}
	return [f, n];
};

/** Whether the character at `i` continues the one before it (low surrogate, mark, joiner, selector…). */
const continues = (text: string, i: number): boolean => {
	if (i <= 0 || i >= text.length) return false;
	const c = text.charCodeAt(i);
	if (c >= 0xdc00 && c <= 0xdfff) return true;
	if (c === 0x200d || (c >= 0xfe00 && c <= 0xfe0f) || text.charCodeAt(i - 1) === 0x200d) return true;
	const cp = text.codePointAt(i) ?? c;
	// Emoji skin tones and tag characters (flag sequences).
	if ((cp >= 0x1f3fb && cp <= 0x1f3ff) || (cp >= 0xe0020 && cp <= 0xe007f)) return true;
	return c >= 0x300 && kindAt(text, i) === MARK;
};

/** `i`, moved back to the start of the character cluster it falls in, so a cut never splits one. */
export const clusterStart = (text: string, i: number): number => {
	while (i > 0 && continues(text, i)) i--;
	return i;
};

/** `i`, moved forward past the rest of the cluster it falls in, so a cut never splits one. */
export const clusterEnd = (text: string, i: number): number => {
	while (i < text.length && continues(text, i)) i++;
	return i;
};
