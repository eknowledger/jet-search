/**
 * Filters: typed syntax and the filters bar are one
 * model. A filter is a piece of the text (`status:draft`, `#tag`, `path:5.Journal`, `edited:7d`,
 * `date>2026-01-01`, `links:[[X]]`, `has:link`, `[key:value]`) that keeps some notes; it becomes a chip
 * once finished (a space after it, a closing bracket or quote). `key:value` is a filter only for a key
 * your notes use, so `10:30` and `https://…` stay text. Pure: matching works on facts the Obsidian
 * side gathers from the metadata cache, with links already resolved.
 */
import type { NoteFacts } from "../scopes/members";
import { fold } from "../scopes/names";

export type Filter =
	| { kind: "prop"; key: string; value: string; target?: string }
	| { kind: "tag"; tag: string }
	| { kind: "path"; prefix: string }
	| { kind: "edited"; days: number }
	| { kind: "created"; days: number }
	| { kind: "date"; op: "<" | ">"; date: string }
	| { kind: "links"; name: string; target?: string }
	| { kind: "haslink" }
	| { kind: "title" };

/** What filters need to know about a note, beyond scope facts. */
export type FilterFacts = NoteFacts & {
	mtime: number;
	ctime: number;
	/** Notes this one links to (resolved). */
	outgoing: readonly string[];
};

const DAY = 86_400_000;
const UNITS: Record<string, number> = { d: 1, w: 7, m: 30, y: 365 };
/** Keys the syntax gives a meaning of its own (any property key counts too, when your notes use it). */
const BUILT_IN = new Set(["tag", "path", "edited", "created", "links", "has"]);

export type Found = { filter: Filter; from: number; to: number; complete: boolean };

/** One piece of the text as a filter, or null (it stays text). */
const filterOf = (key: string, value: string, known: (key: string) => boolean): Filter | null => {
	const k = key.toLowerCase();
	const v = value.trim();
	if (!v) return null;
	if (k === "tag") return { kind: "tag", tag: v.startsWith("#") ? v : `#${v}` };
	if (k === "path") return { kind: "path", prefix: v.replace(/\/+$/, "") };
	if (k === "edited" || k === "created") {
		const m = /^(\d+)\s*([dwmy])$/i.exec(v);
		if (!m) return null;
		return { kind: k, days: Number(m[1]) * (UNITS[(m[2] ?? "d").toLowerCase()] ?? 1) };
	}
	if (k === "links") {
		const name = /^\[\[([^\]|#]+)/.exec(v)?.[1]?.trim() ?? v.replace(/^\[\[|\]\]$/g, "").trim();
		return name ? { kind: "links", name } : null;
	}
	if (k === "has") return v.toLowerCase() === "link" || v.toLowerCase() === "links" ? { kind: "haslink" } : null;
	if (k === "in" || !known(key)) return null;
	return { kind: "prop", key, value: v.replace(/^"|"$/g, "") };
};

/** `key:value` (value quoted, or `[[a link]]`), `[key:value]`, `#tag`, `date>…` / `date<…`, at a word start. */
const PIECE =
	/(^|\s)(?:\[([^\]:\s][^\]:]*):([^\]]*)\]|#([^\s#"]+)|date([<>])(\d{4}-\d{2}-\d{2})|([^\s:"[\]#@]+):("[^"]*"?|\[\[[^\]]*(?:\]\])?|[^\s]*))/gu;

/** The filters in the text, where each is, and whether it is finished. */
export const findFilters = (input: string, known: (key: string) => boolean): Found[] => {
	const out: Found[] = [];
	for (const m of input.matchAll(PIECE)) {
		const from = (m.index ?? 0) + (m[1]?.length ?? 0);
		const to = (m.index ?? 0) + m[0].length;
		const after = input[to];
		const spaced = after === undefined ? false : /\s/u.test(after);
		let filter: Filter | null = null;
		let complete = spaced;
		if (m[2] !== undefined) {
			filter = filterOf(m[2], m[3] ?? "", () => true);
			complete = true;
		} else if (m[4] !== undefined) filter = { kind: "tag", tag: `#${m[4]}` };
		else if (m[5] !== undefined && m[6] !== undefined) filter = { kind: "date", op: m[5] as "<" | ">", date: m[6] };
		else if (m[7] !== undefined) {
			const value = m[8] ?? "";
			if (!value) continue;
			if ((value.startsWith('"') && value.length > 1 && value.endsWith('"')) || value.endsWith("]]"))
				complete = true;
			filter = filterOf(m[7], value, (k) => BUILT_IN.has(k.toLowerCase()) || known(k));
		}
		if (filter) out.push({ filter, from, to, complete });
	}
	return out;
};

/** The text without the given filters' pieces (spaces collapsed). */
export const withoutPieces = (input: string, pieces: readonly Found[]): string => {
	let out = "";
	let at = 0;
	for (const p of [...pieces].sort((a, b) => a.from - b.from)) {
		out += input.slice(at, p.from);
		at = p.to;
	}
	return (out + input.slice(at)).replace(/\s+/g, " ").trim();
};

/** A filter as you would type it (a chip's ⌫ puts this back; remembered searches keep it). */
export const filterText = (f: Filter): string => {
	const q = (v: string): string => (/\s/.test(v) ? `"${v}"` : v);
	switch (f.kind) {
		case "prop":
			return `${f.key}:${q(f.value)}`;
		case "tag":
			return f.tag;
		case "path":
			return `path:${q(f.prefix)}`;
		case "edited":
		case "created":
			return `${f.kind}:${f.days}d`;
		case "date":
			return `date${f.op}${f.date}`;
		case "links":
			return `links:[[${f.name}]]`;
		case "haslink":
			return "has:link";
		case "title":
			return "";
	}
};

/** A chip's label: what it keeps. */
export const filterLabel = (f: Filter): [head: string, value: string] => {
	const days = (n: number): string => (n === 1 ? "today" : `past ${n} days`);
	switch (f.kind) {
		case "prop":
			return [f.key, f.value];
		case "tag":
			return ["tag", f.tag];
		case "path":
			return ["in folder", f.prefix];
		case "edited":
			return ["edited", days(f.days)];
		case "created":
			return ["created", days(f.days)];
		case "date":
			return ["date", `${f.op === ">" ? "after" : "before"} ${f.date}`];
		case "links":
			return ["links to", f.name];
		case "haslink":
			return ["has", "links"];
		case "title":
			return ["", "Title only"];
	}
};

const lower = (s: string): string => s.toLowerCase();

const valuesOf = (props: Record<string, unknown>, key: string): unknown[] => {
	const k = lower(key);
	for (const [name, v] of Object.entries(props)) if (lower(name) === k) return Array.isArray(v) ? v : [v];
	return [];
};

/** A note's `date` property as a day (YYYY-MM-DD), else its creation day. */
const dayOf = (n: FilterFacts): string => {
	const d = valuesOf(n.props, "date")[0];
	if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
	return new Date(n.ctime).toISOString().slice(0, 10);
};

/** Whether the note passes the filter (`title` passes everything: it limits what is searched, not which notes). */
export const passes = (f: Filter, n: FilterFacts, now: number): boolean => {
	switch (f.kind) {
		case "prop": {
			if (f.target && (n.links[lower(f.key)] ?? []).includes(f.target)) return true;
			const want = fold(f.value.replace(/^\[\[|\]\]$/g, ""));
			return valuesOf(n.props, f.key).some((v) => {
				if (typeof v === "string") return fold(v.replace(/^\[\[|\]\]$/g, "").split("|")[0] ?? v) === want;
				return (typeof v === "number" || typeof v === "boolean") && fold(String(v)) === want;
			});
		}
		case "tag": {
			const t = lower(f.tag);
			return n.tags.some((x) => {
				const y = lower(x);
				return y === t || y.startsWith(`${t}/`);
			});
		}
		case "path":
			return lower(n.path).startsWith(lower(f.prefix));
		case "edited":
			return n.mtime >= now - f.days * DAY;
		case "created": {
			const d = valuesOf(n.props, "date")[0];
			const t = typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? Date.parse(d.slice(0, 10)) : n.ctime;
			return t >= now - f.days * DAY;
		}
		case "date":
			return f.op === ">" ? dayOf(n) > f.date : dayOf(n) < f.date;
		case "links":
			return f.target ? n.outgoing.includes(f.target) : false;
		case "haslink":
			return n.outgoing.length > 0;
		case "title":
			return true;
	}
};

/** The same filter twice is one chip. */
export const sameFilter = (a: Filter, b: Filter): boolean => JSON.stringify(a) === JSON.stringify(b);
