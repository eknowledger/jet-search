/**
 * Where a search runs: one scope's id, or several when you added a second
 * scope beside the first; the notes in any of them. Pure.
 */
export type Where = string | readonly string[];

/** The scope ids, first added first (none: everywhere). */
export const whereIds = (w: Where | undefined): string[] =>
	w === undefined ? [] : typeof w === "string" ? [w] : [...w];

/** The notes in any of the scopes (one scope: its own set, not copied). */
export const unionOf = (
	ids: readonly string[],
	membersOf: (id: string) => ReadonlySet<string>,
): ReadonlySet<string> => {
	if (ids.length === 1) return membersOf(ids[0] as string);
	const out = new Set<string>();
	for (const id of ids) for (const p of membersOf(id)) out.add(p);
	return out;
};

/** Several names as a header or notice says them: "A + B". */
export const joinNames = (names: readonly string[]): string => names.join(" + ");

/** As the box's placeholder says them: "A", "A and B", "A, B and C". */
export const listNames = (names: readonly string[]): string =>
	names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;

/** As the worker takes it (a message, so no read-only array). */
export const wireWhere = (w: Where | undefined): string | string[] | undefined =>
	w === undefined ? undefined : typeof w === "string" ? w : [...w];
