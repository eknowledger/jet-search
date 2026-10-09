/**
 * Completing filters as you type, pure. The piece of
 * text at the caret says what to list: `#ca` → tags, `status:` / `status:dr` → that key's values,
 * `sta:` (no such key) → keys that start so, `edited:` → windows. A key that does not exist but is
 * within two edits of one that does (`stauts:draft`) is offered a fix.
 */

/** The piece of text around the caret: from its start to the next space. */
export const pieceAt = (text: string, caret: number): { from: number; to: number; piece: string } => {
	let from = caret;
	while (from > 0 && !/\s/u.test(text[from - 1] ?? "")) from--;
	let to = caret;
	while (to < text.length && !/\s/u.test(text[to] ?? "")) to++;
	return { from, to, piece: text.slice(from, to) };
};

export type Want =
	| { kind: "tags"; prefix: string }
	| { kind: "values"; key: string; prefix: string }
	| { kind: "keys"; prefix: string }
	| { kind: "windows" }
	| { kind: "folders"; prefix: string };

/** What the piece asks to list, or null (a plain word lists nothing). */
export const wantOf = (piece: string, known: (key: string) => boolean): Want | null => {
	if (piece.startsWith("#") && !piece.includes(" ")) return { kind: "tags", prefix: piece.slice(1) };
	const m = /^([^\s:"[\]#@]+):(.*)$/u.exec(piece);
	if (!m) return null;
	const key = m[1] ?? "";
	const rest = (m[2] ?? "").replace(/^"/, "");
	const k = key.toLowerCase();
	if (k === "tag") return { kind: "tags", prefix: rest.replace(/^#/, "") };
	if (k === "edited" || k === "created") return { kind: "windows" };
	if (k === "path") return { kind: "folders", prefix: rest };
	if (k === "in" || k === "has" || k === "links" || k === "http" || k === "https") return null;
	if (known(key)) return { kind: "values", key, prefix: rest };
	if (!rest) return { kind: "keys", prefix: key };
	return null;
};

/** Optimal string alignment distance (adjacent swaps count one), bounded: more than `max` is max + 1. */
export const editDistance = (a: string, b: string, max = 2): number => {
	if (Math.abs(a.length - b.length) > max) return max + 1;
	const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [
		i,
		...Array.from({ length: b.length }, () => 0),
	]);
	for (let j = 1; j <= b.length; j++) (d[0] as number[])[j] = j;
	for (let i = 1; i <= a.length; i++) {
		let rowMin = Number.POSITIVE_INFINITY;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			const row = d[i] as number[];
			const up = d[i - 1] as number[];
			let v = Math.min((up[j] as number) + 1, (row[j - 1] as number) + 1, (up[j - 1] as number) + cost);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
				v = Math.min(v, ((d[i - 2] as number[])[j - 2] as number) + 1);
			row[j] = v;
			rowMin = Math.min(rowMin, v);
		}
		if (rowMin > max) return max + 1;
	}
	return (d[a.length] as number[])[b.length] as number;
};

export type Fix = { from: number; to: number; wrong: string; key: string; value: string };

/**
 * An unknown `key:value` whose key is two edits or fewer from a key your notes use:
 * the nearest, then the most used. Short keys (under 4 letters) are never fixed: too many neighbours.
 */
/** Keys never "fixed": Jet's own, links, and Obsidian Search's operators (`task:` is not a misspelt `tags:`). */
const OWN = new Set([
	"in",
	"tag",
	"path",
	"edited",
	"created",
	"links",
	"has",
	"http",
	"https",
	"file",
	"content",
	"line",
	"block",
	"section",
	"task",
	"task-todo",
	"task-done",
	"match-case",
	"ignore-case",
]);

export const findFix = (
	text: string,
	keys: ReadonlyArray<readonly [name: string, notes: number]>,
	known: (key: string) => boolean,
): Fix | null => {
	for (const m of text.matchAll(/(^|\s)([^\s:"[\]#@]+):("[^"]*"?|[^\s]+)/gu)) {
		const wrong = m[2] ?? "";
		const k = wrong.toLowerCase();
		if (wrong.length < 4 || known(wrong) || OWN.has(k.replace(/^-/, ""))) continue;
		let best: { key: string; d: number; n: number } | null = null;
		for (const [name, n] of keys) {
			const d = editDistance(k, name.toLowerCase(), 2);
			if (d > 2) continue;
			if (!best || d < best.d || (d === best.d && n > best.n)) best = { key: name, d, n };
		}
		if (!best) continue;
		const from = (m.index ?? 0) + (m[1]?.length ?? 0);
		return {
			from,
			to: from + m[0].length - (m[1]?.length ?? 0),
			wrong,
			key: best.key,
			value: (m[3] ?? "").replace(/^"|"$/g, ""),
		};
	}
	return null;
};
