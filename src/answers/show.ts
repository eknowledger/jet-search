/**
 * How an answer line is shown (answers experiment): as a row's excerpt, its Markdown read as
 * text, the question's words marked and the answer's figures coloured; and how close it is, as a
 * meter. Pure.
 */
import { findHits } from "../excerpt/excerpt";
import { answerSpans, questionStems } from "./answers";

export type Ranges = Array<[number, number]>;
export type AnswerShown = { text: string; marks: Ranges; nums: Ranges };

/** About two rows of excerpt. */
const WIDTH = 200;

/** A line's Markdown as text: no list marker, emphasis, link target or table pipes. */
export const plainLine = (s: string): string =>
	s
		.replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)+/u, "")
		.replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/(\*\*|__|`)/g, "")
		.replace(/^\|\s*|\s*\|\s*$/g, "")
		.replace(/\s*\|\s*/g, " · ")
		.replace(/\s+/g, " ")
		.trim();

/** The line as a row shows it: about WIDTH characters around its answer, marked and coloured. */
export const answerExcerpt = (line: string, question: string, width = WIDTH): AnswerShown => {
	const full = plainLine(line);
	const nums = answerSpans(question, full);
	const marks = findHits(full, questionStems(question), { limit: 50 });
	if (full.length <= width) return { text: full, marks, nums };
	// A long line: from a little before its first figure (or first word of the question).
	const at = nums[0]?.[0] ?? marks[0]?.[0] ?? 0;
	let from = Math.max(0, Math.min(at - 60, full.length - width));
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

/** How close a line is to the question, as the row's meter says it: how much of the question it holds. */
export const closeness = (cover: number): { pct: number; word: "close" | "fair" | "loose" } => ({
	pct: Math.round(100 * Math.max(0.1, Math.min(1, cover))),
	word: cover >= 0.8 ? "close" : cover >= 0.5 ? "fair" : "loose",
});
