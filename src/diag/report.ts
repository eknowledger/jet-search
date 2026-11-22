import type { Opened, Problem } from "./diag";
import type { Row as SearchRow, Summary } from "./recorder";
import { FLAG } from "./recorder";

/** How the index stands, in one word. */
export type Phase = "never-built" | "building" | "live" | "asleep";

/** What the user chose to add to the report (all off by default; names are never read otherwise). */
export type ReportOptions = { scopeNames: boolean; pluginNames: boolean; explainNames: boolean };

export const NO_OPTIONS: ReportOptions = { scopeNames: false, pluginNames: false, explainNames: false };

/** Everything the report says, as plain facts (numbers, flags, codes). Gathering it is in `collect.ts`. */
export type Snapshot = {
	now: number;
	jet: { version: string; build: string };
	obsidian: { version: string; platform: string; shell: string | null };
	/** The machine and the window, from what the browser engine tells any page. */
	device: {
		cores: number | null;
		memoryGb: number | null;
		language: string;
		window: { width: number; height: number; scale: number };
		heap: { used: number; limit: number } | null;
	};
	vault: { notes: number; files: number; plugins: number; pluginNames: string[] | null };
	appearance: { theme: "dark" | "light"; name: string | null; snippets: number; missingVars: string[] };
	index: {
		phase: Phase;
		/** Building: how far. */
		progress: { done: number; total: number } | null;
		/** Notes Jet would index (excluded folders left out). */
		eligible: number;
		/** Notes in the index, when known (the worker is awake or told us last time). */
		indexed: number | null;
		bytes: number | null;
		segments: number | null;
		pending: number | null;
		savedAt: number | null;
		/** How the saved index opened when the worker last started (null: not yet this session). */
		opened: Opened | null;
	};
	worker: { running: boolean; since: number | null; starts: number; crashes: number; sleeps: number };
	open: {
		/** Hotkeys Obsidian's Hotkeys give the two search commands (null: none). */
		hotkeys: { search: string | null; inNote: string | null };
		/** "Shift", "Control", ... or "off". */
		tapKey: string;
		tapMs: number;
		/** The id of the plugin that handles that double tap instead, if any. */
		tapOwner: string | null;
		standIns: number;
		windowsWatched: number;
		windowsOpen: number;
	};
	/** The last searches as the flight recorder keeps them (null: none yet this session). */
	searches: Summary | null;
	/** The explanation the user added (lines, with tags for names unless they allowed them), if any. */
	explain: string[] | null;
	meaning: { on: boolean; model: { id: string; bytes: number } | null };
	scopes: { count: number; sizes: number[] | null; names: string[] | null };
	settings: {
		newTab: boolean;
		preview: boolean;
		excerpts: boolean;
		fixKeys: boolean;
		stemming: string[];
		excludeRules: number;
		questionShows: string;
		bothLayout: string;
		meaningLong: boolean;
		answers: boolean;
		scopesWhenNew: string;
		scopeMode: string;
		scopeAnother: string;
		persistFilters: boolean;
		keysChanged: number;
		recentSearches: number;
		openedNotes: number;
	};
	/** Obsidian features Jet leans on: how many were found, which are missing. */
	internals: { found: number; of: number; missing: string[] };
	problems: Problem[];
};

/** A line of the report; `warn` marks one the reader should look at first. */
export type Line = { text: string; warn?: boolean };
export type Section = { label: string; lines: Line[] };
/** A line as drawn: the label column (padded; blank after the first line of a section) and the text. */
export type Row = { label: string; text: string; warn: boolean; first: boolean };

const num = (n: number): string => n.toLocaleString("en-US");

const mb = (bytes: number): string => `${(bytes / 1e6).toFixed(1)} MB`;

const plural = (n: number, one: string, many = `${one}s`): string => `${num(n)} ${n === 1 ? one : many}`;

const ago = (now: number, t: number): string => {
	const s = Math.max(0, Math.round((now - t) / 1000));
	if (s < 60) return `${s} s ago`;
	if (s < 3600) return `${Math.round(s / 60)} min ago`;
	if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
	return `${Math.round(s / 86_400)} days ago`;
};

const span = (ms: number): string => {
	const s = Math.max(0, Math.round(ms / 1000));
	if (s < 60) return `${s} s`;
	if (s < 3600) return `${Math.round(s / 60)} min`;
	if (s < 86_400) return `${Math.round(s / 3600)} h`;
	return `${Math.round(s / 86_400)} days`;
};

const clock = (t: number): string => {
	const d = new Date(t);
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const onOff = (b: boolean): string => (b ? "on" : "off");

const PHASES: Record<Phase, string> = {
	"never-built": "not built yet",
	building: "building",
	live: "up to date",
	asleep: "saved, loads on the first search",
};

const ln = (text: string, warn = false): Line => (warn ? { text, warn } : { text });

const STORES: Record<string, string> = { indexeddb: "IndexedDB", memory: "memory only" };

/** How the saved index opened, and where it is kept; warns when it is not kept between sessions. */
const openedLines = (o: Opened): Line[] => {
	const where = STORES[o.store] ?? o.store;
	const how =
		o.how === "loaded"
			? `loaded from disk (${where}), ${Math.round(o.ms)} ms`
			: o.how === "none"
				? `nothing saved yet, built from scratch (${where})`
				: o.how === "format-changed"
					? `saved index is format ${o.found ?? "?"}, this Jet reads ${o.version}, built again`
					: "saved index could not be read, built again";
	return [
		ln(`opened: ${how}`, o.how === "error"),
		...(o.store === "memory" ? [ln("index kept in memory only: it is not saved between sessions", true)] : []),
	];
};

/** Milliseconds as a reader wants them: a decimal under 10, whole above. */
const msText = (n: number): string => (n < 0.05 ? "0" : n < 10 ? n.toFixed(1) : String(Math.round(n)));

const splitText = (r: Pick<SearchRow, "ready" | "worker" | "transit" | "prepare" | "excerpts">): string =>
	`index wait ${msText(r.ready)}, worker ${msText(r.worker)}, transfer ${msText(r.transit)}, prepare ${msText(r.prepare)}, excerpts ${msText(r.excerpts)}`;

/** The slowest search: its parts, size and what was unusual about it. No word of the search. */
const slowestText = (r: SearchRow): string =>
	[
		`slowest: ${msText(r.total)} ms (${splitText(r)})`,
		`${plural(r.words, "word")}, ${plural(r.hits, "hit")}`,
		r.flags & FLAG.meaning ? "by meaning" : null,
		r.flags & FLAG.cold ? "worker had to start" : null,
		r.flags & FLAG.building ? "index was being built" : null,
		r.flags & FLAG.broken ? "saved index was damaged" : null,
	]
		.filter((x): x is string => x !== null)
		.join(", ");

const searchLines = (m: Summary): Line[] => {
	const f = m.flags;
	const extras = [
		f.scoped ? `in a scope ${f.scoped}` : null,
		f.cold ? `worker had to start ${f.cold}` : null,
		f.building ? `index being built ${f.building}` : null,
		f.phrase ? `quoted phrase ${f.phrase}` : null,
	].filter((x): x is string => x !== null);
	return [
		ln(
			`${m.kept < m.total ? `last ${m.kept} of ${num(m.total)} searches` : plural(m.kept, "search", "searches")}: median ${msText(m.median)} ms, 95% under ${msText(m.p95)} ms`,
		),
		ln(`median split: ${splitText(m.stages)} ms`),
		ln(
			`by words ${m.kinds.words}, by meaning ${m.kinds.meaning}${extras.length ? `; ${extras.join(", ")}` : ""}; replaced by a newer one ${m.superseded}`,
		),
		...(f.broken ? [ln(`saved index found damaged ${plural(f.broken, "time")}`, true)] : []),
		ln(slowestText(m.max)),
	];
};

/** The report as sections of short lines. No names of notes, folders or scopes unless the user added them. */
export const buildReport = (s: Snapshot): Section[] => {
	const out: Section[] = [];
	const add = (label: string, ...lines: Line[]): void => {
		out.push({ label, lines });
	};

	add("Jet Search", ln(`${s.jet.version}, build ${s.jet.build}`));
	add("Obsidian", ln([s.obsidian.version, s.obsidian.platform, s.obsidian.shell].filter(Boolean).join(", ")));

	const d = s.device;
	add(
		"Device",
		ln(
			[
				d.cores !== null ? `${d.cores} cores` : null,
				d.memoryGb !== null ? `${d.memoryGb} GB memory` : null,
				`window ${d.window.width}x${d.window.height} at ${d.window.scale}x`,
				`language ${d.language}`,
			]
				.filter(Boolean)
				.join(", "),
		),
		...(d.heap
			? [ln(`script memory ${Math.round(d.heap.used / 1e6)} MB used of ${Math.round(d.heap.limit / 1e6)} MB`)]
			: []),
	);

	const v = s.vault;
	add("Vault", ln(`${plural(v.notes, "note")}, ${plural(v.files, "file")}`));
	add(
		"Plugins",
		ln(`${plural(v.plugins, "community plugin")} enabled${v.pluginNames ? (v.plugins ? ":" : "") : ""}`),
		...(v.pluginNames && v.pluginNames.length ? [ln(v.pluginNames.join(", "))] : []),
	);

	const a = s.appearance;
	add(
		"Appearance",
		ln(
			`${a.theme} mode, ${a.name ? `theme ${a.name}` : "default theme"}, ${a.snippets ? plural(a.snippets, "CSS snippet") : "no CSS snippets"}`,
		),
		...(a.missingVars.length ? [ln(`the theme leaves out: ${a.missingVars.join(", ")}`, true)] : []),
	);

	const i = s.index;
	const size = [
		i.bytes !== null ? mb(i.bytes) : null,
		i.segments !== null ? plural(i.segments, "segment") : null,
		i.pending ? `${num(i.pending)} waiting` : null,
		i.savedAt !== null
			? `saved ${ago(s.now, i.savedAt)}`
			: i.phase === "asleep" || i.phase === "live"
				? "size and age not known yet"
				: "not saved yet",
	].filter((x): x is string => x !== null);
	add(
		"Index",
		ln(i.progress ? `building, ${num(i.progress.done)} of ${num(i.progress.total)} notes` : PHASES[i.phase]),
		...(i.opened ? openedLines(i.opened) : []),
		ln(
			i.indexed !== null
				? `${num(i.indexed)} of ${num(i.eligible)} notes indexed`
				: `${num(i.eligible)} notes ${i.phase === "asleep" || i.phase === "live" ? "eligible" : "to index"}`,
		),
		ln(size.join(", ")),
	);

	const w = s.worker;
	add(
		"Worker",
		ln(
			w.running && w.since !== null
				? `running for ${span(s.now - w.since)}`
				: w.running
					? "running"
					: "not running (starts on the first search)",
		),
		ln(`started ${w.starts}x, crashed ${w.crashes}x, slept ${w.sleeps}x`, w.crashes > 0),
	);

	add("Searches", ...(s.searches ? searchLines(s.searches) : [ln("none yet this session")]));
	if (s.explain?.length) add("Explain", ...s.explain.map((t) => ln(t)));

	const m = s.meaning;
	add(
		"Meaning",
		ln(!m.on ? "off" : m.model ? `on, model ${m.model.id} (${mb(m.model.bytes)})` : "on, no model installed"),
	);

	const sc = s.scopes;
	if (!sc.count) add("Scopes", ln("none"));
	else if (sc.names) {
		add(
			"Scopes",
			ln(plural(sc.count, "scope")),
			...sc.names.map((n, k) => {
				const size = sc.sizes?.[k];
				return ln(size === undefined ? n : `${n} (${num(size)})`);
			}),
		);
	} else {
		add(
			"Scopes",
			ln(
				`${plural(sc.count, "scope")}${sc.sizes ? `, sizes ${sc.sizes.map(num).join(" / ")}` : ", sizes not counted yet"}`,
			),
		);
	}

	const t = s.settings;
	add(
		"Settings",
		ln(
			`results: new tab ${onOff(t.newTab)}, preview ${onOff(t.preview)}, excerpts ${onOff(t.excerpts)}, fix property keys ${onOff(t.fixKeys)}`,
		),
		ln(
			`search: stemming ${t.stemming.length ? t.stemming.join(", ") : "none"}, ${plural(t.excludeRules, "exclude rule")}, questions by ${t.questionShows}, both shown as ${t.bothLayout}, long searches by meaning ${onOff(t.meaningLong)}, answers ${onOff(t.answers)}`,
		),
		ln(
			`scopes: when new ${t.scopesWhenNew}, typing a name ${t.scopeMode}, another scope ${t.scopeAnother}, keep last scope and filters ${onOff(t.persistFilters)}`,
		),
		ln(
			`kept: ${plural(t.keysChanged, "changed key")}, ${plural(t.recentSearches, "recent search", "recent searches")}, ${plural(t.openedNotes, "opened note")}`,
		),
	);

	const o = s.open;
	add(
		"Open Jet",
		ln(
			`hotkeys: search ${o.hotkeys.search ?? "not set"}, in this note ${o.hotkeys.inNote ?? "not set"}; double tap ${o.tapKey === "off" ? "off" : `${o.tapKey} ${o.tapMs} ms`}`,
		),
		ln(`windows watched ${o.windowsWatched} of ${o.windowsOpen}, stand-in commands ${o.standIns}`),
		...(o.tapKey !== "off" && o.tapOwner ? [ln(`double tap handled by another plugin: ${o.tapOwner}`, true)] : []),
	);

	if (s.internals.missing.length)
		add(
			"Compatibility",
			ln(
				`${s.internals.of - s.internals.found} of ${s.internals.of} Obsidian features Jet uses are missing: ${s.internals.missing.join(", ")}`,
				true,
			),
		);

	if (s.problems.length)
		add(
			"Problems",
			ln(`${plural(s.problems.length, "problem")} noticed, oldest first`),
			...s.problems.map((p) =>
				ln(
					`${clock(p.at)}  ${p.level === "warn" ? "warning" : "error"} ${p.code}: ${p.error}${p.where ? ` at ${p.where}` : ""}${p.count > 1 ? ` (${p.count}x)` : ""}`,
					true,
				),
			),
		);
	return out;
};

/** The sections as drawn: a label column ("Worker:") that every line of the section lines up under. */
export const labelWidth = (sections: Section[]): number => Math.max(0, ...sections.map((x) => x.label.length)) + 2;

export const layout = (sections: Section[]): Row[] => {
	const width = labelWidth(sections);
	return sections.flatMap((x) =>
		x.lines.map((l, k) => ({
			label: (k === 0 ? `${x.label}:` : "").padEnd(width),
			text: l.text,
			warn: !!l.warn,
			first: k === 0,
		})),
	);
};

/** The report as plain text, exactly what the window shows and a copy puts on the clipboard. */
export const formatReport = (s: Snapshot): string =>
	layout(buildReport(s))
		.map((r) => r.label + r.text)
		.join("\n");

/** The report for a GitHub issue: what happened, then the text in a code block. */
export const formatForGithub = (s: Snapshot, what: string): string => {
	const said = what.trim();
	return [
		...(said ? ["**What happened**", said, ""] : []),
		"**Support info**",
		"```text",
		formatReport(s),
		"```",
	].join("\n");
};
