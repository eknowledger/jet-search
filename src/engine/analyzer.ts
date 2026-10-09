/**
 * Text analysis: the one set of rules that turns text into index terms, used for
 * notes and queries alike, so a word typed matches the word stored. Pure: runs in the worker and tests.
 */

/** Marks removed after NFKD: Latin/Greek/Cyrillic accents, Hebrew points, Arabic short vowels. */
const MARKS = /[\u0300-\u036f\u0591-\u05c7\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g;
const NON_ASCII = /[\u0080-\uffff]/;
/** A run of letters, marks and digits in any script: a word, or a stretch of a script without spaces. */
const RUN = /[\p{L}\p{M}\p{N}]+/gu;
/** Chinese and Japanese: indexed as overlapping two-character pairs. */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]/u;
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu;
/** Scripts without spaces that need a word segmenter. */
const SEGMENTED = /[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
/** Arabic prefixes peeled to give a second form (al-, wal-, bil-, kal-, fal-, lil-). */
const AR_PREFIX =
	/^(?:\u0648\u0627\u0644|\u0628\u0627\u0644|\u0643\u0627\u0644|\u0641\u0627\u0644|\u0627\u0644|\u0644\u0644)/;
const ARABIC = /[\u0600-\u06ff]/;

let segmenter: Intl.Segmenter | null | undefined;
const segment = (s: string): string[] => {
	if (segmenter === undefined)
		segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("th", { granularity: "word" }) : null;
	if (!segmenter) return [s];
	const out: string[] = [];
	for (const x of segmenter.segment(s)) if (x.isWordLike) out.push(x.segment);
	return out;
};

/** Arabic letter variants folded (hamza on alef, alef maqsura, taa marbuta) and tatweel dropped. */
const foldArabic = (s: string): string =>
	s
		.replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
		.replace(/\u0649/g, "\u064a")
		.replace(/\u0629/g, "\u0647")
		.replace(/\u0640/g, "");

/** Lower case; accents and similar marks removed only when the text is not plain ASCII (fast path). */
export const normalize = (s: string): string => {
	if (!NON_ASCII.test(s)) return s.toLowerCase();
	let t = s.normalize("NFKD").replace(MARKS, "").normalize("NFC").toLowerCase();
	if (ARABIC.test(t)) t = foldArabic(t);
	return t.replace(/\u00df/g, "ss");
};

/** A run's compound parts: camelCase and letter–digit boundaries (`NebulaSDK` → Nebula, SDK). */
const parts = (run: string): string[] => run.match(/\p{Lu}+(?!\p{Ll})|\p{Lu}?\p{Ll}+|\p{N}+|[\p{L}\p{M}]+/gu) ?? [run];

const keep = (t: string): boolean => t.length > 1 || /\p{N}/u.test(t);

/** Two-character pairs of a Chinese/Japanese run; a single character stands alone. */
const pairs = (run: string, out: string[]): void => {
	const chars = [...run];
	if (chars.length === 1) out.push(chars[0] as string);
	for (let i = 0; i + 1 < chars.length; i++) out.push((chars[i] as string) + (chars[i + 1] as string));
};

export type TokenizeOptions = {
	/** Also emit compound parts and Arabic article-less forms (notes: yes; queries: no). */
	parts?: boolean;
};

/**
 * Text to terms, in order: runs of letters and digits, normalized; compound parts and
 * Arabic forms without the article when `parts`; Chinese/Japanese as two-character pairs; Thai, Lao,
 * Khmer and Burmese through the word segmenter. One-letter terms are dropped, except digits and CJK.
 */
export const tokenize = (text: string, opts: TokenizeOptions = {}): string[] => {
	const out: string[] = [];
	const ascii = !NON_ASCII.test(text);
	const src = ascii ? text : text.normalize("NFKD").replace(MARKS, "").normalize("NFC");
	for (const m of src.matchAll(RUN)) {
		const run = m[0];
		if (!ascii && CJK.test(run)) {
			// Split the run into its CJK stretches (pairs) and the rest (ordinary words).
			let last = 0;
			for (const c of run.matchAll(CJK_RUN)) {
				const at = c.index ?? 0;
				if (at > last) word(run.slice(last, at), out, opts);
				pairs(c[0], out);
				last = at + c[0].length;
			}
			if (last < run.length) word(run.slice(last), out, opts);
			continue;
		}
		if (!ascii && SEGMENTED.test(run)) {
			for (const w of segment(run)) word(w, out, opts);
			continue;
		}
		word(run, out, opts);
	}
	return out;
};

const word = (run: string, out: string[], opts: TokenizeOptions): void => {
	const whole = normalize(run);
	if (keep(whole)) out.push(whole);
	if (!opts.parts) return;
	const ps = parts(run);
	if (ps.length > 1)
		for (const p of ps) {
			const t = normalize(p);
			if (keep(t) && t !== whole) out.push(t);
		}
	if (ARABIC.test(whole)) {
		const bare = whole.replace(AR_PREFIX, "");
		if (bare !== whole && bare.length >= 2) out.push(bare);
	}
};

/** Whether a term is from a script where typos are not tolerated (CJK pairs, segmented scripts). */
/** One Chinese or Japanese character: indexed inside pairs, so it is looked up as the pairs that hold it. */
export const cjkChar = (term: string): boolean => term.length === 1 && CJK.test(term);

export const noTypos = (term: string): boolean => CJK.test(term) || SEGMENTED.test(term);
