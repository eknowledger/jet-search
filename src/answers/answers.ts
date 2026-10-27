/**
 * Answers (experiment):
 * for a question, the notes words and meaning already list, re-ranked by the line that best answers it,
 * and that line shown. Nothing is stored and no model is added: the question's rare words (rarity from
 * the word index), the line's heading, the kind of answer the question asks for (a share wants "%", a
 * latency a time…), and the static model's closeness for each note's best few lines. Pure: the caller
 * gives the notes' text, the words' rarity and the closeness.
 */
import { normalize, tokenize } from "../engine/analyzer";
import { stemEnglish } from "../engine/stem/english";

/** One line of a note: a list item, a table row, or a sentence of a long paragraph, with its heading. */
export type AnswerLine = { text: string; heading: string; offset: number };

/** A note offered to the re-rank: its text, where its body starts, and which list had it. */
export type AnswerCandidate = {
	path: string;
	title: string;
	text: string;
	bodyStart: number;
	from: "words" | "meaning" | "both";
};

export type AnswerResult = {
	path: string;
	score: number;
	/** The line shown as the reason (null: the title answered it, or no line has the question's words). */
	line: AnswerLine | null;
	/** How much of the question the line (or the title) holds: its words' rarity found, over all of them (0–1). */
	cover: number;
	from: AnswerCandidate["from"];
};

/** Lines of a sentence or more; longer paragraphs are cut at sentence ends. */
const MIN_LINE = 12;
const LONG_LINE = 400;
/** Lines per note weighed by the static model (a few: a line is short enough for an average to mean something). */
export const SIMILAR_LINES = 3;

/** Every line of a note's body worth reading as an answer, with its heading and where it starts. */
export const linesOf = (text: string, bodyStart = 0): AnswerLine[] => {
	const out: AnswerLine[] = [];
	let heading = "";
	let fence = false;
	let at = bodyStart;
	for (const raw of text.slice(bodyStart).split("\n")) {
		const start = at;
		at += raw.length + 1;
		if (/^\s*(```|~~~)/.test(raw)) {
			fence = !fence;
			continue;
		}
		if (fence) continue;
		const h = /^#{1,6}\s+(.*)$/.exec(raw);
		if (h) {
			heading = (h[1] ?? "").trim();
			continue;
		}
		const t = raw.trim();
		// Too short to answer anything, or a table's rule row.
		if (t.length < MIN_LINE || /^\|?\s*:?-{3}/.test(t)) continue;
		const lead = raw.length - raw.trimStart().length;
		if (t.length <= LONG_LINE) {
			out.push({ text: t, heading, offset: start + lead });
			continue;
		}
		let from = 0;
		for (const m of t.matchAll(/[.!?](\s+|$)/g)) {
			const end = (m.index ?? 0) + 1;
			const piece = t.slice(from, end).trim();
			if (piece.length >= MIN_LINE) out.push({ text: piece, heading, offset: start + lead + from });
			from = end + (m[1]?.length ?? 0);
		}
		const tail = t.slice(from).trim();
		if (tail.length >= MIN_LINE) out.push({ text: tail, heading, offset: start + lead + from });
	}
	return out;
};

/** The small words that say nothing about the answer. */
const STOP = new Set(
	(
		"a an the of to in on for and or is are was were be been being do does did can could should would will has have had " +
		"how why what when where who whom whose which that this these those it its we our us you your i me my they them their " +
		"there here with about from at by as into than then so if not no yes up out any all some much many more most very " +
		"get got make made need needs take takes go goes come"
	).split(" "),
);

/** The question's content words, as the index reads them (no small words). */
export const contentTerms = (q: string): string[] => [...new Set(tokenize(q).filter((w) => !STOP.has(w)))];

/**
 * Where a text has the question's words, the forms that count (as the line was scored: "orders" for
 * "order", not "keyboard" for "key"), joined words' parts too: what a row marks.
 */
export const questionWordSpans = (question: string, text: string): Array<[number, number]> => {
	const stems = new Set(contentTerms(question).map((w) => TUNING.stem(w)));
	const out: Array<[number, number]> = [];
	if (!stems.size) return out;
	const add = (m: RegExpMatchArray): void => {
		const a = m.index ?? 0;
		if (stems.has(TUNING.stem(normalize(m[0])))) out.push([a, a + m[0].length]);
	};
	for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) {
		const before = out.length;
		add(m);
		// No whole-word hit: its parts (NebulaSDK, AutoSave).
		if (out.length === before && /\p{Ll}\p{Lu}/u.test(m[0]))
			for (const p of m[0].matchAll(/\p{Lu}?\p{Ll}+|\p{Lu}+(?!\p{Ll})|\p{N}+/gu))
				add(Object.assign([p[0]], { index: (m.index ?? 0) + (p.index ?? 0) }) as RegExpMatchArray);
	}
	return out;
};

/**
 * A line's text as read for words: a link's shown text, not its target; the parts of a joined word
 * apart, as the index reads them ("AutoSave" is auto and save); lower case, letters folded.
 */
const readable = (s: string): string =>
	normalize(
		(s.includes("[")
			? s.replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
			: s
		).replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2"),
	);
const LETTER = /[\p{L}\p{N}]/u;
/** Whether a character continues a word (ASCII letters and digits at once, the rest by Unicode class). */
const wordChar = (s: string, i: number): boolean => {
	const c = s.charCodeAt(i);
	if (c < 128) return (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || (c >= 65 && c <= 90);
	return LETTER.test(s[i] ?? "");
};

/** The broad kind of answer a question asks for (the question's own words; English, as the question test). */
export type AnswerKind = "number" | "who" | "when" | "why" | null;
export const answerKind = (q: string): AnswerKind => {
	const t = q.toLowerCase();
	if (
		/\b(how (much|many|long|often|fast|slow|big|small|close|accurate|cheap|confident)|percent|percentage|share|rate|ratio|latency|size|cost|budget|limit)\b/.test(
			t,
		)
	)
		return "number";
	if (/^who\b|\bwho (owns|is|leads|runs)\b|\bowner\b/.test(t)) return "who";
	if (/^when\b|\bby when\b|\bdeadline\b|\bdue\b|\bwhat date\b/.test(t)) return "when";
	if (/^why\b/.test(t)) return "why";
	return null;
};

const DATE =
	/\b(20\d\d-\d\d-\d\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s?\d{1,2}|\b(end of|by) (january|february|march|april|may|june|july|august|september|october|november|december|q[1-4])|\b\d{1,2}[/-]\d{1,2}\b/i;
const KIND: Record<Exclude<AnswerKind, null>, RegExp> = {
	number: /\d[\d.,]*\s?(%|×|x\b|ms|s\b|mb|gb|kb|k\b|m\b|tps|staff|engineers|weeks?|days?|hours?)|\d+[-–]\d+|~\d|\d+\.\d/i,
	who: /\b(owner|owns|led by|lead)\b|\b[A-Z][a-z]+ [A-Z][a-z]+\b/,
	when: DATE,
	why: /\b(because|due to|since|so that|reason)\b/i,
};

/**
 * What the answer itself should look like, from the question's words (the expected answer type of
 * question answering): a share wants "%", a latency or a duration a time unit, a size bytes, "how often"
 * a rate, "slower/cheaper" a factor, "which… won/chose" a decision word, "who" a name, "when" a date.
 */
export const answerShapes = (q: string): RegExp[] => {
	const t = q.toLowerCase();
	const out: RegExp[] = [];
	if (/\b(percent|percentage|share|rate|fraction|accurate|accuracy|coverage|confident|confidence)\b/.test(t))
		out.push(/\d\s?%/);
	if (/\b(latency|how long|how fast|how slow|delay|buffer|timer|time)\b/.test(t))
		out.push(/\d\s?(ms|s|sec|seconds?|minutes?|hours?|days?|weeks?|months?)\b/i);
	if (/\b(memory|space|disk|size|how big|how small|footprint|storage)\b/.test(t))
		out.push(/\d\s?(kb|mb|gb|tb|bytes?)\b/i);
	if (/\bhow often\b/.test(t)) out.push(/\b(every|per|each|a day|a week|times)\b/i);
	if (/\b(slower|faster|cheaper|bigger|smaller|more expensive)\b/.test(t)) out.push(/\d\s?(×|x\b|times)|\d\s?%/i);
	if (/\bhow many\b/.test(t)) out.push(/\b\d[\d,.]*\b/);
	if (/\b(won|win|chose|choose|picked|decided|preferred|winner)\b/.test(t))
		out.push(/\b(won|winner|chose|chosen|decided|decision|picked|preferred|recommend)/i);
	if (/^who\b|\bwho (owns|is|leads|runs)\b/.test(t)) out.push(KIND.who);
	if (/^when\b|\bby when\b|\bdeadline\b|\bdue\b/.test(t)) out.push(DATE);
	return out;
};

/**
 * Where a text has the answer's shape or kind (a "%" figure for a share, a date for "when"), merged:
 * what the row and the preview colour as the answer.
 */
export const answerSpans = (question: string, text: string): Array<[number, number]> => {
	const kind = answerKind(question);
	const res = [...answerShapes(question), ...(kind === "number" || kind === "when" ? [KIND[kind]] : [])];
	const spans: Array<[number, number]> = [];
	for (const r of res)
		for (const m of text.matchAll(new RegExp(r.source, r.flags.includes("g") ? r.flags : `${r.flags}g`)))
			if (m[0].trim()) spans.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
	spans.sort((a, b) => a[0] - b[0]);
	const out: Array<[number, number]> = [];
	for (const [a, b] of spans) {
		const last = out[out.length - 1];
		if (last && a <= last[1]) last[1] = Math.max(last[1], b);
		else out.push([a, b]);
	}
	return out;
};

/** The weights Tuned by measurement. */
export type AnswerTuning = {
	/** A question word only in the line's heading counts this much of itself. */
	heading: number;
	/** A question word only in the note's name or folders (what the whole note is about) counts this much. */
	context: number;
	/** The line has the shape of the answer asked for (a "%" for a share). */
	shape: number;
	/** The line has the kind of answer asked for (a number for "how much"), without the exact shape. */
	kind: number;
	/** How much the static model's closeness of a line to the question adds (×(1 + this × closeness)). */
	closeness: number;
	/** The title as a line, for this much. */
	title: number;
	/** How word forms meet: the stem of a word. */
	stem: (w: string) => string;
};
const englishStem = (w: string): string => (/^[a-z]+$/.test(w) && w.length > 3 ? stemEnglish(w) : w);
export const TUNING: AnswerTuning = {
	heading: 0.5,
	context: 0.5,
	shape: 2,
	kind: 1.15,
	closeness: 0.6,
	title: 0.8,
	stem: englishStem,
};

type Term = { stem: string; weight: number; key: string };

/** The longest start a word and its stem share: a line without it has neither (a fast first test). */
const keyOf = (w: string, s: string): string => {
	let i = 0;
	while (i < w.length && i < s.length && w[i] === s[i]) i++;
	return w.slice(0, Math.max(i, Math.min(3, w.length)));
};

/** A line as scored: its text read for words (lower case, letters folded) kept once made. */
type Line = AnswerLine & { low?: string };

/** The scorer for one question: its words by rarity, the answer's kind and shape, word forms met once. */
const scorer = (terms: readonly Term[], kind: AnswerKind, shapes: readonly RegExp[], tune: AnswerTuning) => {
	const stems = new Map<string, string>();
	const stemOf = (w: string): string => {
		let s = stems.get(w);
		if (s === undefined) stems.set(w, (s = tune.stem(w)));
		return s;
	};
	/**
	 * The question's words a text has (their stems), or null when it has none. Only the words that start
	 * as a question word does are read and stemmed, found by a substring search: the rest of the line is
	 * never split.
	 */
	const has = (low: string): Set<string> | null => {
		let own: Set<string> | null = null;
		for (const t of terms) {
			for (let i = low.indexOf(t.key); i >= 0; i = low.indexOf(t.key, i + 1)) {
				if (i > 0 && wordChar(low, i - 1)) continue;
				let end = i + t.key.length;
				while (end < low.length && wordChar(low, end)) end++;
				if (stemOf(low.slice(i, end)) === t.stem) {
					own ??= new Set();
					own.add(t.stem);
					break;
				}
			}
		}
		return own;
	};
	const heads = new Map<string, Set<string> | null>();
	const headOf = (h: string): Set<string> | null => {
		let s = heads.get(h);
		if (s === undefined) heads.set(h, (s = h ? has(readable(h)) : null));
		return s;
	};
	const total = terms.reduce((n, t) => n + t.weight, 0) || 1;
	return {
		/** The question's words in a note's name and folders: what every line of it is about. */
		context(path: string): Set<string> | null {
			return tune.context ? has(readable(path.replace(/\.md$/i, "").replace(/\//g, " "))) : null;
		},
		/** How much of the question's weight a line holds (its heading's and its note's words for less). */
		cover(l: Line, ctx: Set<string> | null = null): number {
			const own = has((l.low ??= readable(l.text)));
			const head = headOf(l.heading);
			let w = 0;
			for (const t of terms)
				if (own?.has(t.stem)) w += t.weight;
				else if (head?.has(t.stem)) w += t.weight * tune.heading;
				else if (ctx?.has(t.stem)) w += t.weight * tune.context;
			return w / total;
		},
		/** A line's score: its question words by rarity, its heading's for less, all of them together, the answer's shape. */
		line(l: Line, useShape = true, ctx: Set<string> | null = null): number {
			const own = has((l.low ??= readable(l.text)));
			const head = headOf(l.heading);
			// A line needs a question word of its own or under its heading: the note's name alone is the title's.
			if (!own && !head) return 0;
			let score = 0;
			let found = 0;
			for (const t of terms)
				if (own?.has(t.stem)) {
					score += t.weight;
					found++;
				} else if (head?.has(t.stem)) {
					score += t.weight * tune.heading;
					found += tune.heading;
				} else if (ctx?.has(t.stem)) {
					score += t.weight * tune.context;
					found += tune.context;
				}
			if (!score) return 0;
			score *= 0.5 + 0.5 * (found / terms.length);
			if (!useShape) return score;
			if (shapes.some((r) => r.test(l.text))) score *= tune.shape;
			else if (kind && KIND[kind].test(l.text)) score *= tune.kind;
			return score;
		},
	};
};

export type AnswerDeps = {
	/** How many notes hold each word (its forms too), and the number of notes: the words' rarity. */
	rarity(terms: readonly string[]): Promise<{ notes: number; df: number[] }>;
	/** The static model's closeness of each line to the question (0–1); empty when there is no model. */
	closeness?(question: string, lines: readonly string[]): Promise<number[]>;
	/**
	 * Called between notes: lets other work run (a query typed meanwhile), and answers true when this
	 * re-rank is no longer wanted (a newer question came): it stops with null.
	 */
	pause?(): Promise<boolean>;
};

/** Notes read between two pauses. */
const SLICE = 8;

/**
 * The candidates re-ranked by their best line for the question (each result carries its line). The
 * order to show is answerOrder's: a fact question by the line alone, any other fused with meaning's.
 */
export const rankAnswers = async (
	question: string,
	candidates: readonly AnswerCandidate[],
	deps: AnswerDeps,
	tune: AnswerTuning = TUNING,
): Promise<AnswerResult[] | null> => {
	const content = contentTerms(question);
	if (!content.length) return candidates.map((c) => ({ path: c.path, score: 0, line: null, cover: 0, from: c.from }));
	const { notes, df } = await deps.rarity(content);
	const n = Math.max(1, notes);
	const terms: Term[] = content.map((w, i) => {
		const stem = tune.stem(w);
		return { stem, weight: Math.log(1 + n / (1 + (df[i] ?? 0))), key: keyOf(w, stem) };
	});
	const score = scorer(terms, answerKind(question), answerShapes(question), tune);
	const best: Array<{
		c: AnswerCandidate;
		ctx: Set<string> | null;
		top: Array<{ l: Line; s: number }>;
		title: number;
		name: Line;
		prior: number;
	}> = [];
	for (const [i, c] of candidates.entries()) {
		if (deps.pause && i && i % SLICE === 0 && (await deps.pause())) return null;
		const ctx = score.context(c.path);
		const scored: Array<{ l: Line; s: number }> = [];
		for (const l of linesOf(c.text, c.bodyStart) as Line[]) {
			const s = score.line(l, true, ctx);
			if (s > 0) scored.push({ l, s });
		}
		scored.sort((a, b) => b.s - a.s);
		// The title counts as a line (a note named after the question), for a little less.
		const name: Line = { text: c.title, heading: "", offset: -1 };
		const title = score.line(name, false) * tune.title;
		// A little of the first order stays: ties go to the note words or meaning put first.
		const prior = (0.02 * (candidates.length - i)) / Math.max(1, candidates.length);
		best.push({ c, ctx, top: scored.slice(0, SIMILAR_LINES), title, name, prior });
	}
	// The static model on each note's best lines: one call for all of them.
	const flat = best.flatMap((b) => b.top.map((x) => x.l.text));
	const close = flat.length && deps.closeness && tune.closeness ? await deps.closeness(question, flat) : [];
	let k = 0;
	const out: AnswerResult[] = best.map(({ c, ctx, top, title, name, prior }) => {
		let pick: { l: Line; s: number } | null = null;
		for (const x of top) {
			const s = x.s * (1 + tune.closeness * Math.max(0, close[k++] ?? 0));
			if (!pick || s > pick.s) pick = { l: x.l, s };
		}
		const lineScore = pick?.s ?? 0;
		return lineScore >= title && pick
			? {
					path: c.path,
					score: lineScore + prior,
					line: { text: pick.l.text, heading: pick.l.heading, offset: pick.l.offset },
					cover: score.cover(pick.l, ctx),
					from: c.from,
				}
			: { path: c.path, score: title + prior, line: null, cover: score.cover(name), from: c.from };
	});
	return out.sort((a, b) => b.score - a.score);
};

/** A first line holding this much of the question's weight answers it: the order is the lines'. */
export const SURE_COVER = 0.8;

/**
 * The order shown. By the best lines alone when the first holds most of the question (SURE_COVER) or
 * the question asks for a fact (a number, a name, a date, a reason); otherwise the lines' order and
 * meaning's fused, since a topic is what meaning reads well.
 */
export const answerOrder = (question: string, ranked: readonly AnswerResult[], meaning: readonly string[]): string[] =>
	(ranked[0]?.cover ?? 0) >= SURE_COVER || answerKind(question)
		? ranked.map((r) => r.path)
		: fuseOrders([ranked.map((r) => r.path), meaning]);

/** Reciprocal rank fusion of orders (k 60): a topic question keeps meaning's order beside the lines'. */
export const fuseOrders = (lists: ReadonlyArray<readonly string[]>, k = 60): string[] => {
	const s = new Map<string, number>();
	for (const l of lists) l.slice(0, 100).forEach((p, i) => s.set(p, (s.get(p) ?? 0) + 1 / (k + i + 1)));
	return [...s].sort((a, b) => b[1] - a[1]).map(([p]) => p);
};
