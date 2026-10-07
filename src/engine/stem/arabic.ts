/**
 * Arabic: a light stemmer in the spirit of Larkey et al.'s light10 and Lucene's ArabicStemmer (our own
 * code). It strips one prefix (و، ال، بال، كال، فال، لل، وال) and then, in turn, each of the suffixes
 * ها، ان، ات، ون، ين، يه، ه، ي that ends the word, always keeping at least two letters (three after و).
 *
 * Words arrive folded (analyzer.ts): short vowels removed, أ إ آ ٱ → ا, ى → ي, ة → ه, no tatweel; so
 * the light10 suffixes ية and ة appear here as يه and ه (`مكتبة` → `مكتبه` → `مكتب`).
 */

/** Prefixes, longest first; a word keeps at least two letters after them. */
const PREFIXES = ["وال", "بال", "كال", "فال", "ال", "لل"];
/** و (wa-, "and"): removed only when three letters remain. */
const WAW = "و";
/** Suffixes, each removed in this order when it ends the word and two letters remain. */
const SUFFIXES = ["ها", "ان", "ات", "ون", "ين", "يه", "ه", "ي"];

/** Light stem of a folded Arabic word. */
export const stemArabic = (word: string): string => {
	let w = word;
	const p = PREFIXES.find((x) => w.length >= x.length + 2 && w.startsWith(x));
	if (p !== undefined) w = w.slice(p.length);
	else if (w.length >= 4 && w.startsWith(WAW)) w = w.slice(1);
	for (const s of SUFFIXES) if (w.length >= s.length + 2 && w.endsWith(s)) w = w.slice(0, -s.length);
	return w;
};
