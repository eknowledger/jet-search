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
	"which",
	"does",
	"did",
	"can",
	"should",
	"is",
	"are",
	"was",
	"were",
	"do",
]);

export const isQuestion = (text: string): boolean => {
	const t = text.trim();
	// A filter piece is `#tag`, `@scope` or `key:value` with a key of letters: "10:30" and "https://…" are words.
	if (!t || t.includes('"') || /(^|\s)([#@]\S|[\p{L}_-]+:(?!\/\/)\S)/u.test(t)) return false;
	const words = t.split(/\s+/u).filter((w) => /\p{L}/u.test(w));
	if (words.length < 3) return false;
	// The question word only: "what's" and "what’s" are "what"; "Will Smith" is a name.
	const first = /^\p{L}+/u.exec((words[0] ?? "").toLowerCase())?.[0] ?? "";
	return t.endsWith("?") || STARTS.has(first);
};

/** The words a meaning row's excerpt looks for: the question's, without the small ones. */
const SMALL = new Set([
	...STARTS,
	"whom",
	"whose",
	"could",
	"would",
	"will",
	"has",
	"have",
	"had",
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
