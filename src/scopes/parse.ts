/**
 * Typing a scope, pure. A scope's name or alias anywhere
 * in the text, with other words around it, is a suggestion: the results stay unscoped until Tab. The
 * name alone is a normal search with a hint. `in:name` and `@name` anywhere apply the scope, whatever
 * its mode; so does the start of one scope's name or alias (`@cob`). Names match folded (case, accents, `-` `_` `.` as spaces), longest first; quoted words never.
 */
import type { Scope } from "./model";
import { compact, fold } from "./names";

export type Parsed = {
	/** The text to search for: the input, without an explicit `in:` / `@` form. */
	text: string;
	/** Applied by `in:name` or `@name` (the first scope of that name). */
	applied?: Scope;
	/**
	 * The explicit form is finished: quoted, or a space follows it. While `@cob` is still being typed
	 * it may already name a scope by an alias; the modal waits for the space.
	 */
	complete?: boolean;
	/**
	 * The scopes whose name is in the text (whole words, anywhere outside quotes), the name as typed,
	 * where it starts, and the text without it.
	 */
	suggest?: { scopes: Scope[]; name: string; rest: string; at: number };
	/** The text is a scope's name alone. */
	hint?: Scope;
};

/** Words in a name: the longest name tried first is this long. */
const MAX_NAME_WORDS = 8;
/** `in:word`, `in:"two words"`, `@word`, `@"two words"` at the start of a word. */
const EXPLICIT = /(^|\s)(?:in:|@)(?:"([^"]+)"|(\S+))/iu;

const typed = (s: Scope): boolean => s.mode !== "in-only";

/**
 * Folded name → the typed scopes of that name. Kept while the names and modes stay the same (settings
 * edit scopes in place, so the list itself is no key); checking that costs a join, not 100 folds.
 */
let table: { key: string; byName: Map<string, Scope[]> } | null = null;
const namesOf = (scopes: readonly Scope[]): Map<string, Scope[]> => {
	const key = scopes
		.map((s) => `${s.id}\u0001${s.mode}\u0001${s.name}\u0001${s.aliases.join("\u0002")}`)
		.join("\u0003");
	if (table?.key === key) return table.byName;
	const byName = new Map<string, Scope[]>();
	for (const s of scopes)
		if (typed(s))
			for (const n of new Set([s.name, ...s.aliases].map(fold)))
				if (n) byName.set(n, [...(byName.get(n) ?? []), s]);
	table = { key, byName };
	return byName;
};

export const parseScope = (input: string, scopes: readonly Scope[]): Parsed => {
	if (!scopes.length || !input.trim()) return { text: input };
	const explicit = EXPLICIT.exec(input);
	if (explicit) {
		const key = compact(explicit[2] ?? explicit[3] ?? "");
		const names = (x: Scope): string[] => [x.name, ...x.aliases].map(compact);
		// The name or an alias; else the start of exactly one scope's name or alias (`@cob` → Cobalt).
		const starts = key ? scopes.filter((x) => names(x).some((n) => n.startsWith(key))) : [];
		const s = key
			? (scopes.find((x) => names(x).includes(key)) ?? (starts.length === 1 ? starts[0] : undefined))
			: undefined;
		if (s) {
			const end = explicit.index + explicit[0].length;
			const text = `${input.slice(0, explicit.index)}${explicit[1] ?? ""}${input.slice(end)}`;
			const complete = explicit[2] !== undefined || /\s/u.test(input[end] ?? "");
			return { text: text.replace(/\s+/g, " ").trim(), applied: s, complete };
		}
	}
	const byName = namesOf(scopes);
	// Words outside quotes, with where each starts and ends: a name is a run of whole words, anywhere.
	const words: Array<{ from: number; to: number }> = [];
	let quoted = false;
	for (const m of input.matchAll(/"|[^\s"]+/gu)) {
		if (m[0] === '"') quoted = !quoted;
		else if (!quoted) words.push({ from: m.index ?? 0, to: (m.index ?? 0) + m[0].length });
		// A quote ends the run: `"Cobalt" text` never joins `Cobalt` to what follows.
		else words.push({ from: -1, to: -1 });
	}
	let best: { from: number; to: number; scopes: Scope[] } | null = null;
	for (let i = 0; i < words.length; i++) {
		for (let k = Math.min(words.length - i, MAX_NAME_WORDS); k >= 1; k--) {
			const a = words[i];
			const b = words[i + k - 1];
			if (!a || !b || a.from < 0 || words.slice(i, i + k).some((w) => w.from < 0)) continue;
			// Only whitespace between the words of a name.
			if (
				/[^\s]/u.test(
					words
						.slice(i, i + k - 1)
						.map((w, j) => input.slice(w.to, (words[i + j + 1] as { from: number }).from))
						.join(""),
				)
			)
				continue;
			const found = byName.get(fold(input.slice(a.from, b.to)));
			if (!found) continue;
			// The longest name wins; between equals, the first.
			if (!best || b.to - a.from > best.to - best.from) best = { from: a.from, to: b.to, scopes: found };
			break;
		}
	}
	if (best) {
		const name = input.slice(best.from, best.to);
		const rest = `${input.slice(0, best.from)} ${input.slice(best.to)}`.replace(/\s+/g, " ").trim();
		return rest
			? { text: input, suggest: { scopes: best.scopes, name, rest, at: best.from } }
			: { text: input, hint: best.scopes[0] };
	}
	return { text: input };
};
