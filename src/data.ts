import { normalizeScopes, type Scope } from "./scopes/model";

/**
 * What Jet keeps in its data.json (settings and the frecency store): settings,
 * the notes you opened (for recents and the frecency boost) and your recent searches.
 */

export type JetSettings = {
	/** Shift-Shift opens Jet (when no other plugin owns double Shift). */
	doubleShift: boolean;
	/** Most time between the two taps, in ms. */
	shiftInterval: number;
	/** Open results in a new tab by default (⌘↵ does the other). */
	newTab: boolean;
	/** Show the preview pane (⌘. toggles). */
	preview: boolean;
	/** Show an excerpt line under results found in the text. */
	excerpts: boolean;
	/** Folders left out of the index, as path prefixes. */
	exclude: string[];
	/** Stemming languages (English on by default). */
	stemming: string[];
};

export const DEFAULT_SETTINGS: JetSettings = {
	doubleShift: true,
	shiftInterval: 350,
	newTab: false,
	preview: true,
	excerpts: true,
	exclude: [],
	stemming: ["en"],
};

/** Per note: a frecency score (decays with a 30-day half-life) and when it was last opened. */
export type Opened = [score: number, at: number];

export type JetData = {
	settings: JetSettings;
	opened: Record<string, Opened>;
	searches: string[];
	/** When this vault's index was first built (null: never; the first build then starts on its own). */
	indexedAt: number | null;
	/** Scopes. */
	scopes: Scope[];
};

const HALF_LIFE = 30 * 86_400_000;
const MAX_OPENED = 2000;
const MAX_SEARCHES = 10;

export const normalizeData = (raw: unknown): JetData => {
	const r = (raw && typeof raw === "object" ? raw : {}) as Partial<JetData>;
	const s = (r.settings && typeof r.settings === "object" ? r.settings : {}) as Partial<JetSettings>;
	const settings: JetSettings = {
		doubleShift: typeof s.doubleShift === "boolean" ? s.doubleShift : DEFAULT_SETTINGS.doubleShift,
		shiftInterval:
			typeof s.shiftInterval === "number" && s.shiftInterval >= 150 && s.shiftInterval <= 1000
				? s.shiftInterval
				: DEFAULT_SETTINGS.shiftInterval,
		newTab: typeof s.newTab === "boolean" ? s.newTab : DEFAULT_SETTINGS.newTab,
		preview: typeof s.preview === "boolean" ? s.preview : DEFAULT_SETTINGS.preview,
		excerpts: typeof s.excerpts === "boolean" ? s.excerpts : DEFAULT_SETTINGS.excerpts,
		exclude: Array.isArray(s.exclude) ? s.exclude.filter((x): x is string => typeof x === "string") : [],
		stemming: Array.isArray(s.stemming) ? s.stemming.filter((x): x is string => typeof x === "string") : ["en"],
	};
	const opened: Record<string, Opened> = {};
	if (r.opened && typeof r.opened === "object")
		for (const [p, v] of Object.entries(r.opened))
			if (Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number") opened[p] = [v[0], v[1]];
	const searches = Array.isArray(r.searches) ? r.searches.filter((x): x is string => typeof x === "string") : [];
	const indexedAt = typeof r.indexedAt === "number" ? r.indexedAt : null;
	return {
		settings,
		opened,
		searches: searches.slice(0, MAX_SEARCHES),
		indexedAt,
		scopes: normalizeScopes(r.scopes),
	};
};

/** A note was opened: its frecency decays to now and gains one (30-day half-life). */
export const recordOpen = (data: JetData, path: string, now: number): void => {
	const [score, at] = data.opened[path] ?? [0, now];
	data.opened[path] = [score * 0.5 ** ((now - at) / HALF_LIFE) + 1, now];
	const entries = Object.entries(data.opened);
	if (entries.length > MAX_OPENED) {
		entries.sort((a, b) => b[1][1] - a[1][1]);
		data.opened = Object.fromEntries(entries.slice(0, MAX_OPENED));
	}
};

/** The frecency boost: 1 + 0.15 · log2(1 + decayed opens). */
export const frecency = (data: JetData, path: string, now: number): number => {
	const o = data.opened[path];
	if (!o) return 1;
	return 1 + 0.15 * Math.log2(1 + o[0] * 0.5 ** ((now - o[1]) / HALF_LIFE));
};

export const rememberSearch = (data: JetData, q: string): void => {
	const t = q.trim();
	if (t.length < 2) return;
	data.searches = [t, ...data.searches.filter((x) => x !== t)].slice(0, MAX_SEARCHES);
};

/** Renames and deletions keep the history right. */
export const movePath = (data: JetData, from: string, to: string | null): void => {
	const o = data.opened[from];
	if (!o) return;
	delete data.opened[from];
	if (to) data.opened[to] = o;
};

export type RecentGroup = { label: string; items: Array<{ path: string; at: number }> };

/**
 * Recents by time: Today, Past week, Past 30 days, newest first. `fallback` are
 * Obsidian's recently opened files without a time (before Jet saw them opened): they use `timeOf`.
 */
export const groupRecents = (
	data: JetData,
	fallback: readonly string[],
	timeOf: (path: string) => number,
	exists: (path: string) => boolean,
	now: number,
	limit = 30,
): RecentGroup[] => {
	const seen = new Map<string, number>();
	for (const [p, [, at]] of Object.entries(data.opened)) if (exists(p)) seen.set(p, at);
	for (const p of fallback) if (!seen.has(p) && exists(p)) seen.set(p, Math.min(now, timeOf(p)));
	const all = [...seen].sort((a, b) => b[1] - a[1]).slice(0, limit);
	const day = new Date(now);
	day.setHours(0, 0, 0, 0);
	const today = day.getTime();
	const groups: RecentGroup[] = [
		{ label: "Today", items: [] },
		{ label: "Past week", items: [] },
		{ label: "Past 30 days", items: [] },
	];
	for (const [path, at] of all) {
		const g = at >= today ? 0 : now - at <= 7 * 86_400_000 ? 1 : now - at <= 30 * 86_400_000 ? 2 : -1;
		if (g >= 0) groups[g]?.items.push({ path, at });
	}
	return groups.filter((g) => g.items.length);
};
