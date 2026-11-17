import type { Hit } from "./engine/jet-engine";
import { tokenize } from "./engine/analyzer";
import { MAX_BODY_CHARS } from "./engine/fields";
import { hasPhrase } from "./excerpt/excerpt";

/** As far as the index reads a note (its body to 2 MB, plus room for the frontmatter). */
const PHRASE_SCAN = MAX_BODY_CHARS + 64_000;

/** Notes checked for a quoted phrase, in rank order. */
export const PHRASE_CHECK_LIMIT = 500;
export const PHRASE_CONFIRM_LIMIT = 50;
/** How much a note's score is multiplied when an unquoted query's words appear in it in order. */
export const SEQUENCE_BOOST = 1.5;
/** Notes checked for that order, in rank order: past the first 20 the gain is under a point. */
export const SEQUENCE_CHECK_LIMIT = 20;
/** How far into a note the order is looked for (characters): bounds the cost of a long note. */
export const SEQUENCE_SCAN = 64_000;

/** The quoted phrases of a query (what must appear as written). */
export const quotedPhrases = (text: string): string[] =>
	[...text.matchAll(/"([^"]+)"/g)].map((m) => (m[1] ?? "").trim()).filter((p) => tokenize(p).length > 0);

/**
 * Keep the hits whose text contains every quoted phrase, in rank order, checking at most 500 notes and
 * stopping at 50 confirmed. `text` reads a note (Obsidian's cached read).
 */
export const filterPhrases = async (
	hits: readonly Hit[],
	phrases: readonly string[],
	text: (path: string) => Promise<string | null>,
): Promise<Hit[]> => {
	if (!phrases.length) return [...hits];
	const out: Hit[] = [];
	for (const h of hits.slice(0, PHRASE_CHECK_LIMIT)) {
		const t = await text(h.path);
		if (t !== null && phrases.every((p) => hasPhrase(t, p, { scanLimit: PHRASE_SCAN }))) out.push(h);
		if (out.length >= PHRASE_CONFIRM_LIMIT) break;
	}
	return out;
};

/** The words to look for in order: what was typed without exclusions, or null when no order is asked for. */
const sequenceOf = (query: string): string | null => {
	if (query.includes('"')) return null;
	const phrase = query.replace(/(^|\s)-\S+/g, " ").trim();
	// Two typed words, not one word the index cuts in parts (a run of Chinese characters).
	return phrase.split(/\s+/u).length >= 2 && tokenize(phrase).length >= 2 ? phrase : null;
};

const byRank = (a: Hit, b: Hit): number => b.matched - a.matched || b.score - a.score;

/**
 * For a query of several words without quotes, notes where the words appear in order (as typed) rank
 * above notes that merely contain them all: their score gains `SEQUENCE_BOOST`, within the same
 * number of words matched. `text` gives a note's text, or null when it was not read.
 */
export const applySequenceBoost = (
	hits: readonly Hit[],
	query: string,
	text: (path: string) => string | null,
): Hit[] => {
	const phrase = sequenceOf(query);
	if (phrase === null) return [...hits];
	return hits
		.map((h) => {
			const t = text(h.path);
			return t !== null && hasPhrase(t, phrase, { scanLimit: SEQUENCE_SCAN })
				? { ...h, score: h.score * SEQUENCE_BOOST }
				: h;
		})
		.sort(byRank);
};

/**
 * `applySequenceBoost` for the first `SEQUENCE_CHECK_LIMIT` hits, with their texts read first
 * (Obsidian's cached read is asynchronous). The other hits keep their score.
 */
export const boostSequences = async (
	hits: readonly Hit[],
	query: string,
	text: (path: string) => Promise<string | null>,
): Promise<Hit[]> => {
	if (sequenceOf(query) === null) return [...hits];
	const head = hits.slice(0, SEQUENCE_CHECK_LIMIT);
	const texts = new Map(await Promise.all(head.map(async (h) => [h.path, await text(h.path)] as const)));
	const boosted = applySequenceBoost(head, query, (p) => texts.get(p) ?? null);
	return [...boosted, ...hits.slice(SEQUENCE_CHECK_LIMIT)].sort(byRank);
};
