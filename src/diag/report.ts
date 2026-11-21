import type { Problem } from "./diag";

/** How the index stands, in one word. */
export type Phase = "never-built" | "building" | "live" | "asleep";

/** Everything the report says, as plain facts (numbers, flags, codes). Gathering it is in `collect.ts`. */
export type Snapshot = {
	now: number;
	jet: { version: string; build: string };
	obsidian: { version: string; platform: string };
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
	};
	worker: { starts: number; crashes: number; sleeps: number };
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
	meaning: { on: boolean; model: { id: string; bytes: number } | null };
	scopes: { count: number; sizes: number[] | null };
	settings: { stemming: string[]; excerpts: boolean; excludeRules: number; newTab: boolean; preview: boolean };
	screen: { theme: "dark" | "light"; vars: { set: number; of: number; missing: string[] } };
	internals: { found: number; of: number; missing: string[] };
	problems: Problem[];
};

const num = (n: number): string => n.toLocaleString("en-US");

const mb = (bytes: number): string => `${(bytes / 1e6).toFixed(1)} MB`;

const ago = (now: number, t: number): string => {
	const s = Math.max(0, Math.round((now - t) / 1000));
	if (s < 60) return `${s} s ago`;
	if (s < 3600) return `${Math.round(s / 60)} min ago`;
	if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
	return `${Math.round(s / 86_400)} days ago`;
};

const clock = (t: number): string => {
	const d = new Date(t);
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const PHASES: Record<Phase, string> = {
	"never-built": "not built yet",
	building: "building",
	live: "up to date",
	asleep: "saved, loads on the first search",
};

const LABEL = 10;
const INDENT = " ".repeat(LABEL);

/** Lines under a label; the first carries it. */
const section = (label: string, lines: string[]): string[] =>
	lines.map((l, i) => (i === 0 ? label.padEnd(LABEL) : INDENT) + l);

/** The report as plain text: short lines, a label per area, no names of notes, folders or scopes. */
export const formatReport = (s: Snapshot): string => {
	const out: string[] = [];
	out.push(`Jet Search ${s.jet.version}, build ${s.jet.build}`);
	out.push(`Obsidian ${s.obsidian.version}, ${s.obsidian.platform}`);

	const i = s.index;
	const idx = [i.progress ? `building, ${num(i.progress.done)} of ${num(i.progress.total)} notes` : PHASES[i.phase]];
	idx.push(
		i.indexed !== null
			? `${num(i.indexed)} of ${num(i.eligible)} notes indexed`
			: `${num(i.eligible)} notes to index`,
	);
	const size = [
		i.bytes !== null ? mb(i.bytes) : null,
		i.segments !== null ? `${i.segments} segment${i.segments === 1 ? "" : "s"}` : null,
		i.pending ? `${num(i.pending)} waiting` : null,
		i.savedAt !== null ? `saved ${ago(s.now, i.savedAt)}` : "not saved yet",
	].filter((x): x is string => x !== null);
	idx.push(size.join(", "));
	out.push(...section("Index", idx));

	out.push(
		...section("Worker", [`started ${s.worker.starts}x, crashed ${s.worker.crashes}x, slept ${s.worker.sleeps}x`]),
	);

	const o = s.open;
	const open = [`hotkeys: search ${o.hotkeys.search ?? "not set"}, in this note ${o.hotkeys.inNote ?? "not set"}`];
	open.push(o.tapKey === "off" ? "double tap: off" : `double tap: ${o.tapKey}, ${o.tapMs} ms`);
	if (o.tapKey !== "off" && o.tapOwner) open.push(`handled by another plugin (${o.tapOwner})`);
	open.push(`commands standing in for other plugins: ${o.standIns}`);
	open.push(`windows watched: ${o.windowsWatched} of ${o.windowsOpen}`);
	out.push(...section("Open Jet", open));

	const m = s.meaning;
	out.push(
		...section("Meaning", [
			!m.on ? "off" : m.model ? `on, model ${m.model.id} (${mb(m.model.bytes)})` : "on, no model installed",
		]),
	);

	const sc = s.scopes;
	out.push(
		...section("Scopes", [
			!sc.count
				? "none"
				: `${sc.count} scope${sc.count === 1 ? "" : "s"}` +
					(sc.sizes ? `, sizes ${sc.sizes.map(num).join(" / ")}` : ", sizes not counted yet"),
		]),
	);

	const t = s.settings;
	out.push(
		...section("Settings", [
			`stemming ${t.stemming.length ? t.stemming.join(", ") : "none"}, excerpts ${t.excerpts ? "on" : "off"}`,
			`${t.excludeRules} exclude rule${t.excludeRules === 1 ? "" : "s"}, new tab ${t.newTab ? "on" : "off"}, preview ${t.preview ? "on" : "off"}`,
		]),
	);

	const v = s.screen.vars;
	out.push(
		...section("Screen", [
			`${s.screen.theme} theme`,
			v.missing.length
				? `${v.set} of ${v.of} theme variables set, missing ${v.missing.join(", ")}`
				: `${v.set} of ${v.of} theme variables set`,
		]),
	);

	const n = s.internals;
	out.push(
		...section("Obsidian", [
			n.missing.length
				? `${n.found} of ${n.of} internals found, missing ${n.missing.join(", ")}`
				: `${n.found} of ${n.of} internals found`,
		]),
	);

	out.push(
		...section(
			"Problems",
			s.problems.length
				? [
						`noticed (${s.problems.length})`,
						...s.problems.map(
							(p) => `${clock(p.at)}  ${p.code}: ${p.error}${p.count > 1 ? ` (${p.count}x)` : ""}`,
						),
					]
				: ["none noticed"],
		),
	);
	return out.join("\n");
};

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
