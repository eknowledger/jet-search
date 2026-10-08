/**
 * Creating a note in a scope: where it goes and what it carries, from the scope's own
 * rules. The first folder rule is the folder; the first property rule is filled in (a link written
 * as [[Title]]); a tag only when there is no property. Pure.
 */
import type { Scope } from "./model";

export type CreateTarget = { folder: string | null; prop: [key: string, value: string] | null; tag: string | null };

export const createTarget = (s: Scope): CreateTarget => {
	let folder: string | null = null;
	let prop: [string, string] | null = null;
	let tag: string | null = null;
	for (const r of s.rules) {
		if (r.kind === "folder") folder ??= r.path;
		else if (r.kind === "tag") tag ??= r.tag;
		else if (!prop)
			prop =
				"target" in r
					? [r.key, `[[${(r.target.split("/").pop() ?? r.target).replace(/\.md$/i, "")}]]`]
					: [r.key, r.value];
	}
	return { folder, prop, tag: prop ? null : tag };
};

/** "2.Projects/Cobalt · project: [[Cobalt]] filled in" (the create row's detail). */
export const createDetail = (t: CreateTarget): string => {
	const parts = [t.folder ?? "Your default folder for new notes"];
	if (t.prop) parts.push(`${t.prop[0]}: ${t.prop[1]} filled in`);
	else if (t.tag) parts.push(`${t.tag} added`);
	return parts.join(" · ");
};
