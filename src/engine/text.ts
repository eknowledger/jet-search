/**
 * Text for the search index: normalization, tokens, and a note's fields.
 * Pure functions: they run in the worker and in tests.
 */

/** Lower case, accents removed (é → e), as Omnisearch with "ignore diacritics". */
export const normalize = (s: string): string =>
	s
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase();

/** Words: runs of letters and digits, normalized. One-letter tokens are dropped, except digits. */
export const tokens = (s: string): string[] => {
	const out: string[] = [];
	for (const m of normalize(s).matchAll(/[\p{L}\p{N}]+/gu)) {
		const t = m[0];
		if (t.length > 1 || /\d/.test(t)) out.push(t);
	}
	return out;
};

/** Field order in the index; weights as Omnisearch's settings (basename 10 … body 1). */
export const FIELDS = ["name", "folder", "h1", "h2", "h3", "tags", "body"] as const;
export type Field = (typeof FIELDS)[number];
export const WEIGHTS: Record<Field, number> = { name: 10, folder: 7, h1: 6, h2: 5, h3: 4, tags: 2, body: 1 };

export type NoteFields = Record<Field, string[]>;

/**
 * A note's fields from its path and text: the file name, its folders, H1–H3
 * headings, tags (frontmatter and inline), and the body (everything, headings
 * included, so a phrase across a heading still matches).
 */
export const noteFields = (path: string, text: string): NoteFields => {
	const parts = path.split("/");
	const file = parts.pop() ?? "";
	const name = file.replace(/\.[^.]+$/, "");
	const fields: NoteFields = {
		name: tokens(name),
		folder: tokens(parts.join(" ")),
		h1: [],
		h2: [],
		h3: [],
		tags: [],
		body: [],
	};
	let body = text;
	// Frontmatter: its tags count as tags; the rest is body text (aliases, titles…).
	const fm = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
	if (fm) {
		const yaml = fm[1] ?? "";
		const inline = /^tags:\s*\[?([^\n\]]*)\]?\s*$/m.exec(yaml)?.[1] ?? "";
		const list = /^tags:\s*\n((?:\s*-\s*.*\n?)+)/m.exec(yaml)?.[1] ?? "";
		fields.tags.push(...tokens(`${inline} ${list}`));
	}
	for (const m of body.matchAll(/^(#{1,3})\s+(.+)$/gm)) {
		const level = m[1]?.length ?? 0;
		const t = tokens(m[2] ?? "");
		if (level === 1) fields.h1.push(...t);
		else if (level === 2) fields.h2.push(...t);
		else fields.h3.push(...t);
	}
	for (const m of body.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)) fields.tags.push(...tokens(m[1] ?? ""));
	// Links keep their visible words: [[Note|Alias]] and [text](url) both index the words, not the URL.
	body = body.replace(/\]\((?:[^)\s]+)\)/g, "]");
	fields.body = tokens(body);
	return fields;
};

/** A query: words to find, words that must not be there, and "quoted phrases". */
export type Query = { terms: string[]; excluded: string[]; phrases: string[] };

export const parseQuery = (q: string): Query => {
	const phrases: string[] = [];
	const rest = q.replace(/"([^"]+)"/g, (_, p: string) => {
		phrases.push(normalize(p).trim());
		return " ";
	});
	const terms: string[] = [];
	const excluded: string[] = [];
	for (const word of rest.split(/\s+/)) {
		if (!word) continue;
		if (word.startsWith("-") && word.length > 1) excluded.push(...tokens(word.slice(1)));
		else terms.push(...tokens(word));
	}
	for (const p of phrases) terms.push(...tokens(p));
	return { terms: [...new Set(terms)], excluded: [...new Set(excluded)], phrases };
};

/** Whether `a` and `b` are at most one edit apart (insert, delete or replace one letter). */
export const withinOneEdit = (a: string, b: string): boolean => {
	if (a === b) return true;
	const la = a.length;
	const lb = b.length;
	if (Math.abs(la - lb) > 1) return false;
	let i = 0;
	let j = 0;
	let edits = 0;
	while (i < la && j < lb) {
		if (a[i] === b[j]) {
			i++;
			j++;
			continue;
		}
		if (++edits > 1) return false;
		if (la > lb) i++;
		else if (lb > la) j++;
		else {
			i++;
			j++;
		}
	}
	return edits + (la - i) + (lb - j) <= 1;
};

/**
 * An excerpt around the first match of any term: about `width` characters on
 * one line, with the matched words' ranges for highlighting.
 */
export const excerpt = (
	text: string,
	terms: readonly string[],
	width = 160,
): { text: string; marks: Array<[number, number]>; line: number } | null => {
	const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, (m) => "\n".repeat(m.split("\n").length - 1));
	const norm = normalize(body);
	if (norm.length !== body.length) return excerptPlain(body, terms, width);
	return cut(body, norm, terms, width);
};

/** For text whose normalized form changes length (rare ligatures): match on the lower-cased text instead. */
const excerptPlain = (body: string, terms: readonly string[], width: number) =>
	cut(body, body.toLowerCase(), terms, width);

const cut = (body: string, norm: string, terms: readonly string[], width: number) => {
	let at = -1;
	for (const t of terms) {
		const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])(${escape(t)})`, "u");
		const m = re.exec(norm);
		if (m && (at < 0 || m.index < at)) at = m.index + m[0].length - (m[1]?.length ?? 0);
	}
	if (at < 0) return null;
	const lineStart = norm.lastIndexOf("\n", at) + 1;
	let lineEnd = norm.indexOf("\n", at);
	if (lineEnd < 0) lineEnd = norm.length;
	const from = Math.max(lineStart, at - Math.floor(width / 3));
	const to = Math.min(lineEnd, from + width);
	const piece = body.slice(from, to);
	const pnorm = norm.slice(from, to);
	const marks: Array<[number, number]> = [];
	for (const t of terms) {
		const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])(${escape(t)}[\\p{L}\\p{N}]*)`, "gu");
		for (const m of pnorm.matchAll(re)) {
			const start = (m.index ?? 0) + m[0].length - (m[1]?.length ?? 0);
			marks.push([start, start + (m[1]?.length ?? 0)]);
		}
	}
	marks.sort((a, b) => a[0] - b[0]);
	const line = body.slice(0, at).split("\n").length - 1;
	return {
		text: (from > lineStart ? "…" : "") + piece + (to < lineEnd ? "…" : ""),
		marks: marks.map(([a, b]): [number, number] => [
			a + (from > lineStart ? 1 : 0),
			b + (from > lineStart ? 1 : 0),
		]),
		line,
	};
};

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
