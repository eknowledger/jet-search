/**
 * Creating a note in a scope: where it goes and what it carries, from the scope's own
 * rules. The first folder rule is the folder. For a scope of any rule, the first property rule is
 * filled in (a link written as [[Title]]), a tag only when there is no property; for a scope of all
 * rules, every property and every tag. Pure.
 */
import type { Scope } from "./model";

export type CreateTarget = {
	folder: string | null;
	prop: [key: string, value: string] | null;
	tag: string | null;
	/** Everything to write: the first property (or tag) for an "any" scope; every one for an "all" scope. */
	props: Array<[key: string, value: string]>;
	tags: string[];
};

export const createTarget = (s: Scope): CreateTarget => {
	let folder: string | null = null;
	const props: Array<[string, string]> = [];
	const tags: string[] = [];
	for (const r of s.rules) {
		if (r.kind === "folder") folder ??= r.path;
		else if (r.kind === "tag") tags.push(r.tag);
		else
			props.push(
				"target" in r
					? [r.key, `[[${(r.target.split("/").pop() ?? r.target).replace(/\.md$/i, "")}]]`]
					: [r.key, r.value],
			);
	}
	const prop = props[0] ?? null;
	const tag = prop ? null : (tags[0] ?? null);
	// A note made in an "all" scope must hold every rule to be in it; one of any is enough otherwise.
	return s.combine === "all"
		? { folder, prop, tag, props: [...new Map(props).entries()], tags }
		: { folder, prop, tag, props: prop ? [prop] : [], tags: tag ? [tag] : [] };
};

/** "2.Projects/Cobalt · project: [[Cobalt]] filled in" (the create row's detail). */
export const createDetail = (t: CreateTarget): string => {
	const parts = [t.folder ?? "Your default folder for new notes"];
	if (t.props.length) parts.push(`${t.props.map(([k, v]) => `${k}: ${v}`).join(", ")} filled in`);
	if (t.tags.length) parts.push(`${t.tags.join(" ")} added`);
	return parts.join(" · ");
};

/**
 * The scope in Obsidian Search's syntax, for the hand-off: its rules ORed (or ANDed for "all"), or
 * null when a rule has no syntax there (a link property).
 */
export const coreQuery = (s: Scope): string | null => {
	const q = (v: string): string => (/[\s"]/u.test(v) ? `"${v.replace(/"/g, "")}"` : v);
	const terms: string[] = [];
	for (const r of s.rules) {
		if (r.kind === "folder") terms.push(`path:${q(r.path)}`);
		else if (r.kind === "tag") terms.push(`tag:${r.tag}`);
		else if ("target" in r) return null;
		else terms.push(`[${r.key}:${q(r.value)}]`);
	}
	if (!terms.length) return null;
	if (terms.length === 1) return terms[0] ?? null;
	return s.combine === "all" ? terms.join(" ") : `(${terms.join(" OR ")})`;
};
