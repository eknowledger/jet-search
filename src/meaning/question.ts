/**
 * Whether a search reads like a question: it starts with a question word or ends with
 * "?", has at least 3 words, and no quoted phrase or filter piece (those ask for words). Pure.
 */
const STARTS = new Set([
	"how",
	"why",
	"what",
	"when",
	"where",
	"who",
	"whom",
	"whose",
	"which",
	"can",
	"could",
	"should",
	"would",
	"does",
	"did",
	"do",
	"is",
	"are",
	"was",
	"were",
	"will",
	"has",
	"have",
	"had",
]);

export const isQuestion = (text: string): boolean => {
	const t = text.trim();
	if (!t || t.includes('"') || /(^|\s)([#@]\S|\S+:\S)/u.test(t)) return false;
	const words = t.split(/\s+/u).filter((w) => /\p{L}/u.test(w));
	if (words.length < 3) return false;
	return t.endsWith("?") || STARTS.has((words[0] ?? "").toLowerCase().replace(/[^\p{L}']/gu, ""));
};

/** The words a meaning row's excerpt looks for: the question's, without the small ones. */
const SMALL = new Set([
	...STARTS,
	"a",
	"an",
	"the",
	"of",
	"to",
	"in",
	"on",
	"for",
	"and",
	"or",
	"we",
	"i",
	"you",
	"it",
	"my",
	"our",
	"me",
	"us",
	"with",
	"about",
	"from",
	"at",
	"by",
	"this",
	"that",
	"be",
	"there",
	"they",
	"them",
	"if",
	"so",
]);
export const contentWords = (text: string): string[] =>
	text
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((w) => w.length > 2 && !SMALL.has(w));
