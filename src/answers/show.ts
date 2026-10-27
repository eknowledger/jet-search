/**
 * How an answer line is shown (answers experiment): as a row's excerpt, its Markdown read as
 * text, the question's words marked and the answer's figures coloured; and how close it is, as a
 * meter. Pure.
 */
import { answerSpans, questionWordSpans } from "./answers";

export type Ranges = Array<[number, number]>;
export type AnswerShown = { text: string; marks: Ranges; nums: Ranges };

/** About two rows of excerpt. */
const WIDTH = 180;
/** Of it, the context kept before the answer's first figure. */
const LEAD = 40;

/** A line's Markdown as text: no list marker, emphasis, link target or table pipes. */
export const plainLine = (s: string): string =>
	s
		.replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)+/u, "")
		.replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/(\*\*|__|`)/g, "")
		.replace(/(^|[^\p{L}\p{N}])[*_](?=\S)([^*_\n]*?\S)[*_](?![\p{L}\p{N}])/gu, "$1$2")
		.replace(/^\|\s*|\s*\|\s*$/g, "")
		.replace(/\s*\|\s*/g, " · ")
		.replace(/\s+/g, " ")
		.trim();

/** The line as a row shows it: about WIDTH characters around its answer, marked and coloured. */
export const answerExcerpt = (line: string, question: string, width = WIDTH): AnswerShown => {
	const full = plainLine(line);
	const nums = answerSpans(question, full);
	const marks = questionWordSpans(question, full);
	if (full.length <= width) return { text: full, marks, nums };
	// A long line: from a little before its first figure (or first word of the question).
	const at = nums[0]?.[0] ?? marks[0]?.[0] ?? 0;
	let from = Math.max(0, Math.min(at - LEAD, full.length - width));
	if (from > 0) {
		const space = full.lastIndexOf(" ", from);
		from = space > 0 && from - space < 20 ? space + 1 : from;
	}
	const to = Math.min(full.length, from + width);
	const lead = from > 0 ? "…" : "";
	const text = `${lead}${full.slice(from, to)}${to < full.length ? "…" : ""}`;
	const shift = (r: Ranges): Ranges =>
		r
			.filter(([a, b]) => b > from && a < to)
			.map(([a, b]) => [Math.max(a, from) - from + lead.length, Math.min(b, to) - from + lead.length]);
	return { text, marks: shift(marks), nums: shift(nums) };
};

/**
 * How close a row's line is to the question, as its meter says it: its score against the
 * first row's, close within 5%, fair within 15%, loose beyond.
 */
export const closeness = (strength: number): { pct: number; word: "close" | "fair" | "loose" } => ({
	pct: Math.round(100 * Math.max(0.1, Math.min(1, strength))),
	word: strength >= 0.95 ? "close" : strength >= 0.85 ? "fair" : "loose",
});
