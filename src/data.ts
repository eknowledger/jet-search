import { type Filter, validFilter } from "./filters/filter";
import { normalizeScopes, type OwnMode, type Scope } from "./scopes/model";
import { type Combo, KEY_ACTIONS, type TapKey } from "./keys/keymap";

/**
 * Data saved before "every scope" existed (no `scopeMode` yet): Suggest was the default then, so a
 * scope on Suggest was on the default. It follows "every scope" now; Auto and in: only were chosen.
 */
const migrateModes = (scopes: Scope[], before: boolean): Scope[] => {
	if (before) for (const s of scopes) if (s.mode === "suggest") s.mode = "default";
	return scopes;
};

/**
 * What Jet keeps in its data.json (settings and the frecency store): settings,
 * the notes you opened (for recents and the frecency boost) and your recent searches.
 */

export type JetSettings = {
	/**
	 * The key whose double tap opens Jet, or off: Obsidian's Hotkeys are the
	 * usual way; this is extra. Was `doubleShift` (true: Shift, false: off). Not when another plugin owns it.
	 */
	tapKey: TapKey;
	/** Most time between the two taps, in ms. */
	shiftInterval: number;
	/** The keys in the window you changed; the others keep their default. */
	keys: Partial<Record<string, Combo>>;
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
	/** What happens when Jet notices new scopes. */
	scopesWhenNew: "tell" | "add" | "nothing";
	/** How typing a name behaves for every scope that did not choose its own. */
	scopeMode: OwnMode;
	/** Another scope typed or picked while one is on: added beside it, or in its place. */
	scopeAnother: "add" | "switch";
	/** Search by meaning: off by default; questions use it by themselves when on. */
	meaning: boolean;
	meaningQuestions: boolean;
	/** Long searches (6+ words, no quotes or filters) go by meaning too: an opt-in. */
	meaningLong: boolean;
	/** Reopen with the last scope and filters (off by default). */
	persistFilters: boolean;
};

export const DEFAULT_SETTINGS: JetSettings = {
	tapKey: "Shift",
	shiftInterval: 350,
	keys: {},
	newTab: false,
	preview: true,
	excerpts: true,
	exclude: [],
	stemming: ["en"],
	scopesWhenNew: "tell",
	scopeMode: "suggest",
	scopeAnother: "add",
	meaning: false,
	meaningQuestions: true,
	meaningLong: false,
	persistFilters: false,
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
	/** How often each scope was searched in and a note opened (the empty state's order). */
	scopeUses: Record<string, number>;
	/** The last scope and filters, kept when "Persist filters" is on. */
	last: { scope?: string; also?: string[]; filters: Filter[] } | null;
	/** Settings imported from other plugins, once each ("jade-search"). */
	imported: string[];
	/** The installed meaning model: its id and the packed file's size; null: not installed. */
	meaningModel: { id: string; bytes: number } | null;
};

const HALF_LIFE = 30 * 86_400_000;
const MAX_OPENED = 2000;
export const MAX_SEARCHES = 10;

const MODS = new Set(["Mod", "Ctrl", "Meta", "Shift", "Alt"]);
/** Your changed keys, for actions Jet knows, each a key with known modifiers (a hand-edited file stays safe). */
const validKeys = (raw: unknown): Partial<Record<string, Combo>> => {
	const out: Partial<Record<string, Combo>> = {};
	if (!raw || typeof raw !== "object") return out;
	const known = new Set<string>(KEY_ACTIONS.map((a) => a.id));
	for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
		const c = v as { mods?: unknown; key?: unknown } | null;
		if (!known.has(id) || !c || typeof c.key !== "string" || !c.key || !Array.isArray(c.mods)) continue;
		if (!c.mods.every((m) => typeof m === "string" && MODS.has(m))) continue;
		out[id] = { mods: [...(c.mods as Combo["mods"])], key: c.key };
	}
	return out;
};

export const normalizeData = (raw: unknown): JetData => {
	const r = (raw && typeof raw === "object" ? raw : {}) as Partial<JetData>;
	const s = (r.settings && typeof r.settings === "object" ? r.settings : {}) as Partial<JetSettings> & {
		doubleShift?: unknown;
	};
	const TAPS: readonly TapKey[] = ["Shift", "Control", "Alt", "Meta", "off"];
	const settings: JetSettings = {
		// Before the choice of key: the double Shift on or off.
		tapKey: TAPS.includes(s.tapKey as TapKey)
			? (s.tapKey as TapKey)
			: s.doubleShift === false
				? "off"
				: DEFAULT_SETTINGS.tapKey,
		keys: validKeys(s.keys),
		shiftInterval:
			typeof s.shiftInterval === "number" && s.shiftInterval >= 150 && s.shiftInterval <= 1000
				? s.shiftInterval
				: DEFAULT_SETTINGS.shiftInterval,
		newTab: typeof s.newTab === "boolean" ? s.newTab : DEFAULT_SETTINGS.newTab,
		preview: typeof s.preview === "boolean" ? s.preview : DEFAULT_SETTINGS.preview,
		excerpts: typeof s.excerpts === "boolean" ? s.excerpts : DEFAULT_SETTINGS.excerpts,
		exclude: Array.isArray(s.exclude) ? s.exclude.filter((x): x is string => typeof x === "string") : [],
		stemming: Array.isArray(s.stemming) ? s.stemming.filter((x): x is string => typeof x === "string") : ["en"],
		scopesWhenNew: s.scopesWhenNew === "add" || s.scopesWhenNew === "nothing" ? s.scopesWhenNew : "tell",
		scopeMode: s.scopeMode === "auto" || s.scopeMode === "in-only" ? s.scopeMode : "suggest",
		scopeAnother: s.scopeAnother === "switch" ? "switch" : "add",
		meaning: s.meaning === true,
		meaningQuestions: s.meaningQuestions !== false,
		meaningLong: s.meaningLong === true,
		persistFilters: typeof s.persistFilters === "boolean" ? s.persistFilters : DEFAULT_SETTINGS.persistFilters,
	};
	const scopeUses: Record<string, number> = {};
	if (r.scopeUses && typeof r.scopeUses === "object")
		for (const [k, v] of Object.entries(r.scopeUses)) if (typeof v === "number" && v > 0) scopeUses[k] = v;
	const lastRaw = r.last as { scope?: unknown; also?: unknown; filters?: unknown } | null | undefined;
	// The scopes added beside the first one; none without a first.
	const also =
		lastRaw && typeof lastRaw === "object" && typeof lastRaw.scope === "string" && Array.isArray(lastRaw.also)
			? lastRaw.also.filter((x): x is string => typeof x === "string")
			: [];
	const last =
		lastRaw && typeof lastRaw === "object"
			? {
					scope: typeof lastRaw.scope === "string" ? lastRaw.scope : undefined,
					...(also.length ? { also } : {}),
					filters: Array.isArray(lastRaw.filters) ? lastRaw.filters.filter(validFilter) : [],
				}
			: null;
	const opened: Record<string, Opened> = {};
	if (r.opened && typeof r.opened === "object")
		for (const [p, v] of Object.entries(r.opened))
			// A score below 0 or a time that is not a number would make the boost NaN.
			if (Array.isArray(v) && Number.isFinite(v[0]) && v[0] >= 0 && Number.isFinite(v[1]))
				opened[p] = [v[0], v[1]];
	const searches = Array.isArray(r.searches) ? r.searches.filter((x): x is string => typeof x === "string") : [];
	const indexedAt = typeof r.indexedAt === "number" ? r.indexedAt : null;
	return {
		settings,
		opened,
		searches: searches.slice(0, MAX_SEARCHES),
		indexedAt,
		scopes: migrateModes(normalizeScopes(r.scopes), s.scopeMode === undefined),
		scopeUses,
		last,
		imported: Array.isArray(r.imported) ? r.imported.filter((x): x is string => typeof x === "string") : [],
		meaningModel:
			r.meaningModel && typeof r.meaningModel === "object" && typeof r.meaningModel.id === "string"
				? { id: r.meaningModel.id, bytes: Number(r.meaningModel.bytes) || 0 }
				: null,
	};
};

/** A note was opened: its frecency decays to now and gains one (30-day half-life). */
export const recordOpen = (data: JetData, path: string, now: number): void => {
	const [score, at] = data.opened[path] ?? [0, now];
	// A time ahead of now (another device's clock) counts as now: no decay, never growth.
	data.opened[path] = [Math.max(0, score) * 0.5 ** (Math.max(0, now - at) / HALF_LIFE) + 1, now];
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
	return 1 + 0.15 * Math.log2(1 + Math.max(0, o[0]) * 0.5 ** (Math.max(0, now - o[1]) / HALF_LIFE));
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
	for (const [p, [, at]] of Object.entries(data.opened)) if (exists(p)) seen.set(p, Math.min(now, at));
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
