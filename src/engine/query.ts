import { tokenize } from "./analyzer";

/**
 * A query as the engine takes it (simplified): the words to find (the
 * last one also as a prefix while typing), words that must not be there, and quoted phrases. Filters
 * and scopes arrive later; until then `key:value` and `#tag` contribute their value as a word.
 */
export type Query = { words: string[]; excluded: string[]; phrases: string[]; lastIsPrefix: boolean };

export const parseQuery = (text: string): Query => {
	const phrases: string[] = [];
	const rest = text.replace(/"([^"]*)"?/g, (_, p: string) => {
		if (p.trim()) phrases.push(p.trim());
		return ` ${p} `;
	});
	const words: string[] = [];
	const excluded: string[] = [];
	for (let piece of rest.split(/\s+/)) {
		if (!piece) continue;
		if (piece.startsWith("-") && piece.length > 1) {
			excluded.push(...tokenize(piece.slice(1)));
			continue;
		}
		piece = piece.replace(/^#/, "").replace(/^[\p{L}\p{N}_-]+:(?=.)/u, "");
		words.push(...tokenize(piece));
	}
	return {
		words: [...new Set(words)],
		excluded: [...new Set(excluded)],
		phrases,
		lastIsPrefix: !/\s$/.test(text) && !text.trim().endsWith('"'),
	};
};
