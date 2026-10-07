/**
 * Tier 0 text folding: a name, alias or path folded one character at a time with the
 * analyzer's rules (lower case, accents removed, `ß` → `ss`, Arabic letter variants), keeping letters and
 * digits only. Every folded UTF-16 unit remembers the range of the original string it came from, so a
 * match can be highlighted in the text as written, and whether a word or token starts or ends there.
 * Pure: built once per string, never per keystroke.
 */
import { normalize } from "../engine/analyzer";

/** Flag: a word starts here (string start, after a separator, camelCase or letter–digit boundary). */
export const WORD = 1;
/** Flag: a token starts here (string start, or after a space or punctuation). */
export const STRONG = 2;
/** Flag: a word (a compound part) ends here. */
export const PART_END = 4;
/** Flag: a token ends here (before a separator, or at the end). */
export const TOKEN_END = 8;

const SEP = 0;
const UPPER = 1;
const LOWER = 2;
const OTHER = 3;
const DIGIT = 4;
const MARK = 5;
const CJK_BIT = 8;

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]/u;
const KEEP = /[\p{L}\p{M}\p{N}]/u;
const classes = new Map<number, number>();
const folds = new Map<number, string>();

/** The class of a code point (`CJK_BIT` added for Chinese and Japanese), cached. */
const classOf = (cp: number): number => {
	if (cp < 128)
		return cp >= 97 && cp <= 122 ? LOWER : cp >= 65 && cp <= 90 ? UPPER : cp >= 48 && cp <= 57 ? DIGIT : SEP;
	let c = classes.get(cp);
	if (c === undefined) {
		const ch = String.fromCodePoint(cp);
		c = /\p{M}/u.test(ch)
			? MARK
			: /[\p{Lu}\p{Lt}]/u.test(ch)
				? UPPER
				: /\p{Ll}/u.test(ch)
					? LOWER
					: /\p{L}/u.test(ch)
						? OTHER
						: /\p{N}/u.test(ch)
							? DIGIT
							: SEP;
		if (CJK.test(ch)) c |= CJK_BIT;
		classes.set(cp, c);
	}
	return c;
};

/** A non-ASCII code point folded by the analyzer's `normalize`, letters, marks and digits kept, cached. */
const foldOf = (cp: number): string => {
	let f = folds.get(cp);
	if (f === undefined) {
		f = "";
		for (const ch of normalize(String.fromCodePoint(cp))) if (KEEP.test(ch)) f += ch;
		folds.set(cp, f);
	}
	return f;
};

/** Scripts that change mark a word start: cased letters, digits, Chinese/Japanese, other letters. */
const group = (cls: number): number => {
	const c = cls & 7;
	return c === UPPER || c === LOWER ? 1 : c === DIGIT ? 2 : cls & CJK_BIT ? 3 : 4;
};

/** The class of the next character that is not a mark (for `XMLParser` → XML, Parser). */
const nextClass = (cps: readonly number[], k: number): number => {
	for (let x = k + 1; x < cps.length; x++) {
		const c = classOf(cps[x] as number) & 7;
		if (c !== MARK) return c;
	}
	return SEP;
};

/** A string folded for matching. Arrays are per folded unit, parallel to `sq`. */
export type Folded = {
	/** The folded letters and digits; separators removed. */
	sq: string;
	/** `WORD`, `STRONG`, `PART_END`, `TOKEN_END` bits. */
	flags: number[];
	/** Where the unit's character starts in the original string. */
	start: number[];
	/** Where it ends (past any accents that folded away). */
	end: number[];
};

/** Folds `text[0, limit)` for matching (see `Folded`). */
export const fold = (text: string, limit = text.length): Folded => {
	const cps: number[] = [];
	const at: number[] = [];
	let i = 0;
	while (i < limit) {
		const cp = text.codePointAt(i) as number;
		cps.push(cp);
		at.push(i);
		i += cp > 0xffff ? 2 : 1;
	}
	at.push(i);
	const units: number[] = [];
	const flags: number[] = [];
	const start: number[] = [];
	const end: number[] = [];
	let prev = SEP;
	let prevGroup = 0;
	let pending = 0;
	const emit = (unit: number, flag: number, from: number, to: number): void => {
		units.push(unit);
		flags.push(flag);
		start.push(from);
		end.push(to);
	};
	for (let k = 0; k < cps.length; k++) {
		const cp = cps[k] as number;
		const from = at[k] as number;
		const to = at[k + 1] as number;
		const cls = classOf(cp);
		const c = cls & 7;
		if (c === SEP) {
			prev = SEP;
			pending = 0;
			continue;
		}
		let flag = 0;
		if (c === MARK) {
			// A mark belongs to the character before it; with nothing before, it starts a word.
			if (prev === SEP) {
				flag = WORD | STRONG;
				prev = OTHER;
				prevGroup = 4;
			}
		} else {
			const g = group(cls);
			if (prev === SEP) flag = WORD | STRONG;
			else if (g !== prevGroup) flag = WORD;
			else if (c === UPPER && (prev === LOWER || (prev === UPPER && nextClass(cps, k) === LOWER))) flag = WORD;
			prev = c;
			prevGroup = g;
		}
		if (cp < 128) {
			emit(c === UPPER ? cp + 32 : cp, flag | pending, from, to);
			pending = 0;
			continue;
		}
		const f = foldOf(cp);
		if (!f) {
			// Folded away (an accent, a tatweel): its source joins the unit before, its flags the next.
			pending |= flag;
			const last = end.length - 1;
			if (last >= 0 && end[last] === from) end[last] = to;
			continue;
		}
		for (let u = 0; u < f.length; u++) emit(f.charCodeAt(u), u === 0 ? flag | pending : 0, from, to);
		pending = 0;
	}
	const n = units.length;
	for (let j = 0; j < n; j++) {
		const next = j + 1 < n ? (flags[j + 1] as number) : WORD | STRONG;
		let f = flags[j] as number;
		if (next & WORD) f |= PART_END;
		if (next & STRONG) f |= TOKEN_END;
		flags[j] = f;
	}
	let sq = "";
	for (let j = 0; j < n; j += 4096) sq += String.fromCharCode(...units.slice(j, j + 4096));
	return { sq, flags, start, end };
};

/** A typed query word folded like `fold`'s `sq`: letters and digits only. */
export const foldWord = (word: string): string => {
	let out = "";
	let i = 0;
	while (i < word.length) {
		const cp = word.codePointAt(i) as number;
		i += cp > 0xffff ? 2 : 1;
		const c = classOf(cp) & 7;
		if (c === SEP) continue;
		out += cp < 128 ? String.fromCharCode(c === UPPER ? cp + 32 : cp) : foldOf(cp);
	}
	return out;
};

/** The mask bit of a folded unit: one per letter a–z, one for digits, four buckets for everything else. */
export const bitOf = (unit: number): number =>
	unit >= 97 && unit <= 122 ? 1 << (unit - 97) : unit >= 48 && unit <= 57 ? 1 << 26 : 1 << (27 + (unit & 3));

/** Whether a folded word has Chinese or Japanese in it (matched as a plain substring). */
export const hasCjk = (word: string): boolean => CJK.test(word);
