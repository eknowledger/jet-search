import { tokenize } from "./analyzer";

/**
 * A query as the engine takes it (simplified): the words to find (the
 * last one also as a prefix while typing), words that must not be there, and quoted phrases. Filters
 * and scopes arrive later; until then `key:value` and `#tag` contribute their value as a word.
 */
export type Query = { words: string[]; excluded: string[]; phrases: string[]; lastIsPrefix: boolean };

export const parseQuery = (text: string): Query => {
	const phrases: string[] = [];
	const words: string[] = [];
	const excluded: string[] = [];
	// In order: a quoted phrase's words are words as they are (`"git push --force"`);
	// outside quotes `-word` excludes, and `#tag` / `key:value` give their value.
	for (const m of text.matchAll(/"([^"]*)"?|[^\s"]+/gu)) {
		if (m[1] !== undefined) {
			const p = m[1].trim();
			if (p) phrases.push(p);
			words.push(...tokenize(p));
			continue;
		}
		let piece = m[0];
		const minus = piece.startsWith("-") && piece.length > 1;
		if (minus) piece = piece.slice(1);
		// `-status:draft` excludes the value, not every note with the word "status".
		piece = piece.replace(/^#/, "").replace(/^[\p{L}\p{N}_-]+:(?=.)/u, "");
		(minus ? excluded : words).push(...tokenize(piece));
	}
	return {
		words: [...new Set(words)],
		excluded: [...new Set(excluded)],
		phrases,
		lastIsPrefix: !/\s$/.test(text) && !text.trim().endsWith('"'),
	};
};
