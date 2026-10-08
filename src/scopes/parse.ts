/**
 * Typing a scope, pure. A scope's name or alias at the
 * start, then a space and more text, is a suggestion: the results stay unscoped until Tab. The name
 * alone is a normal search with a hint. `in:name` and `@name` anywhere apply the scope, whatever its
 * mode. Names match folded (case, accents, `-` `_` `.` as spaces), longest first; a quoted word never.
 */
import type { Scope } from "./model";
import { compact, fold } from "./names";

export type Parsed = {
	/** The text to search for: the input, without an explicit `in:` / `@` form. */
	text: string;
	/** Applied by `in:name` or `@name` (the first scope of that name). */
	applied?: Scope;
	/** The scopes whose name starts the text, the name as typed, and the text after it. */
	suggest?: { scopes: Scope[]; name: string; rest: string };
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
		const s = key ? scopes.find((x) => [x.name, ...x.aliases].some((n) => compact(n) === key)) : undefined;
		if (s) {
			const text = `${input.slice(0, explicit.index)}${explicit[1] ?? ""}${input.slice(explicit.index + explicit[0].length)}`;
			return { text: text.replace(/\s+/g, " ").trim(), applied: s };
		}
	}
	const byName = namesOf(scopes);
	const lead = /^\s*/u.exec(input)?.[0].length ?? 0;
	if (input[lead] === '"') return { text: input };
	const words = [...input.slice(lead).matchAll(/\S+/gu)];
	for (let k = Math.min(words.length, MAX_NAME_WORDS); k >= 1; k--) {
		const last = words[k - 1];
		if (!last) continue;
		const end = lead + (last.index ?? 0) + last[0].length;
		const name = input.slice(lead, end);
		const found = byName.get(fold(name));
		if (!found) continue;
		const rest = input.slice(end).trim();
		return rest ? { text: input, suggest: { scopes: found, name, rest } } : { text: input, hint: found[0] };
	}
	return { text: input };
};
