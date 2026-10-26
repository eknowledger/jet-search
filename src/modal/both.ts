/**
 * By words and by meaning at once: the two lists of one search, shown the way
 * you chose in settings:
 *   groups  (A) by words, then the notes only meaning found; a note found both ways stays under words,
 *               marked "also by meaning";
 *   first   (B) found both ways, then by words, then by meaning;
 *   ranked  (C) one list, each list's best taking turns, a badge on each row.
 * Groups show their first few, then a "more" row that opens the rest in place. Pure.
 */
import type { Entry, Sort } from "./jet-modal";

export type BothLayout = "groups" | "first" | "ranked";
export type MeaningMode = "words" | "meaning" | "both";

/** Rows a group shows before its "more" row. */
export const BOTH_SHOWN = 5;

type Item = Extract<Entry, { type: "item" }>;

/** The order of results for a sort; null for "best" (as they came). */
export const itemCompare = (sort: Sort): ((a: Item, b: Item) => number) | null => {
	switch (sort) {
		case "best":
			return null;
		case "edited-new":
			return (a, b) => (b.mtime ?? 0) - (a.mtime ?? 0);
		case "edited-old":
			return (a, b) => (a.mtime ?? 0) - (b.mtime ?? 0);
		case "created-new":
			return (a, b) => (b.ctime ?? 0) - (a.ctime ?? 0);
		case "created-old":
			return (a, b) => (a.ctime ?? 0) - (b.ctime ?? 0);
		case "title":
			return (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });
	}
};

/**
 * The search's entries (words' entries, then meaning's items, which carry `meaning: true`) as `layout`
 * shows them; `expanded` names the groups whose "more" row was chosen. Rows above the results (the
 * "in Obsidian's Search" row) stay on top. Nothing found by either: the entries as they came (the
 * no-results screen).
 */
export const layoutBoth = (
	entries: readonly Entry[],
	layout: BothLayout,
	sort: Sort,
	expanded: ReadonlySet<string>,
): Entry[] => {
	const items = entries.filter((e): e is Item => e.type === "item" && !e.dim);
	if (!items.length) return [...entries];
	const words = items.filter((i) => !i.meaning);
	const meaning = items.filter((i) => i.meaning);
	const inWords = new Set(words.map((i) => i.path));
	const inMeaning = new Set(meaning.map((i) => i.path));
	const lead = entries.filter((e) => e.type === "core");
	const cmp = itemCompare(sort);
	const order = (xs: Item[]): Item[] => (cmp ? [...xs].sort(cmp) : xs);
	const mark = (i: Item, badge: string): Item => ({ ...i, badge });
	const group = (key: string, label: string, list: Item[]): Entry[] => {
		if (!list.length) return [];
		const sorted = order(list);
		// One row more than the cap is shown rather than a "1 more" row.
		const open = expanded.has(key) || sorted.length <= BOTH_SHOWN + 1;
		const shown = open ? sorted : sorted.slice(0, BOTH_SHOWN);
		const more: Entry[] = open ? [] : [{ type: "more", group: key, n: sorted.length - shown.length, label }];
		return [{ type: "header", label, count: list.length }, ...shown, ...more];
	};
	const onlyMeaning = meaning.filter((i) => !inWords.has(i.path));
	if (layout === "groups")
		return [
			...lead,
			...group(
				"words",
				"By words",
				words.map((i) => (inMeaning.has(i.path) ? mark(i, "also by meaning") : i)),
			),
			...group("meaning", "By meaning", onlyMeaning),
		];
	if (layout === "first")
		return [
			...lead,
			...group(
				"both",
				"Found both ways",
				words.filter((i) => inMeaning.has(i.path)).map((i) => mark(i, "both")),
			),
			...group(
				"words",
				"By words",
				words.filter((i) => !inMeaning.has(i.path)),
			),
			...group("meaning", "By meaning", onlyMeaning),
		];
	// Ranked together: the words' first, the meaning's first, the words' second… each note once; a note
	// in both keeps its words row (its excerpt has your words), marked "both".
	const byPath = new Map(words.map((i) => [i.path, i] as const));
	const out: Item[] = [];
	const seen = new Set<string>();
	for (let k = 0; k < Math.max(words.length, meaning.length); k++)
		for (const i of [words[k], meaning[k]]) {
			if (!i || seen.has(i.path)) continue;
			seen.add(i.path);
			const w = byPath.get(i.path);
			out.push(w && inMeaning.has(i.path) ? mark(w, "both") : i.meaning ? i : mark(i, "by words"));
		}
	return [...lead, { type: "header", label: "Results", count: out.length }, ...order(out)];
};
