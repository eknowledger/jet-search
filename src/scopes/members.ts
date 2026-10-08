/**
 * Which notes are in a scope. Pure: it works on per-note facts that the Obsidian
 * side gathers from the metadata cache (`facts.ts`), with every link already resolved to the note it
 * opens, so `[[Garden]]`, `[[Projects/Garden/Garden]]` and `[[Garden|the beds]]` are the same member.
 */
import type { Rule, Scope } from "./model";

/** What membership needs to know about a note. */
export type NoteFacts = {
	path: string;
	/** Frontmatter values as Obsidian parsed them (strings, numbers, lists…). */
	props: Record<string, unknown>;
	/** Per frontmatter key (lower case), the note paths its links resolve to. */
	links: Record<string, string[]>;
	/** Every tag, frontmatter and inline, with its #. */
	tags: string[];
};

const lower = (s: string): string => s.toLowerCase();

/** A frontmatter key's values, whatever the key's case. */
const values = (props: Record<string, unknown>, key: string): unknown[] => {
	const k = lower(key);
	for (const [name, v] of Object.entries(props)) if (lower(name) === k) return Array.isArray(v) ? v : [v];
	return [];
};

/** Whether one rule takes the note. */
export const matches = (r: Rule, n: NoteFacts): boolean => {
	switch (r.kind) {
		case "folder":
			return n.path.startsWith(`${r.path}/`);
		case "tag": {
			const t = lower(r.tag);
			return n.tags.some((x) => {
				const y = lower(x);
				return y === t || y.startsWith(`${t}/`);
			});
		}
		case "property":
			if ("target" in r) return (n.links[lower(r.key)] ?? []).includes(r.target);
			return values(n.props, r.key).some((v) => typeof v === "string" && lower(v.trim()) === lower(r.value));
	}
};

/** Whether the note is in the scope: any rule (or every rule, with combine "all"). No rules, no members. */
export const inScope = (s: Scope, n: NoteFacts): boolean => {
	if (!s.rules.length) return false;
	return s.combine === "all" ? s.rules.every((r) => matches(r, n)) : s.rules.some((r) => matches(r, n));
};

/** Every scope's members, in one pass over the notes. */
export const members = (scopes: readonly Scope[], notes: Iterable<NoteFacts>): Map<string, Set<string>> => {
	const out = new Map<string, Set<string>>(scopes.map((s) => [s.id, new Set<string>()]));
	for (const n of notes) for (const s of scopes) if (inScope(s, n)) out.get(s.id)?.add(n.path);
	return out;
};
