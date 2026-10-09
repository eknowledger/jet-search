import type { Hit } from "./engine/jet-engine";
import { tokenize } from "./engine/analyzer";
import { MAX_BODY_CHARS } from "./engine/fields";
import { hasPhrase } from "./excerpt/excerpt";

/** As far as the index reads a note (its body to 2 MB, plus room for the frontmatter). */
const PHRASE_SCAN = MAX_BODY_CHARS + 64_000;

/** Notes checked for a quoted phrase, in rank order. */
export const PHRASE_CHECK_LIMIT = 500;
export const PHRASE_CONFIRM_LIMIT = 50;
/** How much a note gains when an unquoted query's words appear in it in order (a proposed boost). */
export const SEQUENCE_BOOST = 1.5;

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
	if (query.includes('"') || tokenize(query).length < 2) return [...hits];
	const phrase = query.replace(/(^|\s)-\S+/g, " ").trim();
	return hits
		.map((h) => {
			const t = text(h.path);
			return t !== null && hasPhrase(t, phrase) ? { ...h, score: h.score * SEQUENCE_BOOST } : h;
		})
		.sort((a, b) => b.matched - a.matched || b.score - a.score);
};

/** `applySequenceBoost` with the texts read first (Obsidian's cached read is asynchronous). */
export const boostSequences = async (
	hits: readonly Hit[],
	query: string,
	text: (path: string) => Promise<string | null>,
): Promise<Hit[]> => {
	if (query.includes('"') || tokenize(query).length < 2) return [...hits];
	const texts = new Map(await Promise.all(hits.map(async (h) => [h.path, await text(h.path)] as const)));
	return applySequenceBoost(hits, query, (p) => texts.get(p) ?? null);
};
