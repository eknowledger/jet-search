import { describe, expect, it } from "vitest";
import { buildReport, formatForGithub, formatReport, layout } from "../src/diag/report";
import { snapshot } from "./diag-fixture";

const problem = (over: Partial<ReturnType<typeof snapshot>["problems"][number]> = {}) => ({
	code: "save.failed",
	level: "error" as const,
	error: "QuotaExceededError",
	where: null,
	at: new Date(2026, 10, 21, 18, 2).getTime(),
	count: 1,
	...over,
});

describe("the support report", () => {
	it("puts a colon after every heading, and the text lines up under it", () => {
		const lines = formatReport(snapshot({ problems: [problem()] })).split("\n");
		expect(lines[0]).toBe("Jet Search: 0.7.1, build jetbuild-release");
		const starts = new Set<number>();
		for (const l of lines) {
			const head = /^([A-Za-z][A-Za-z ]*:) +/.exec(l);
			if (head) starts.add(head[0].length);
			else expect(l).toMatch(/^ +\S/);
			if (!head) starts.add(l.search(/\S/));
		}
		expect([...starts]).toHaveLength(1);
		expect(lines.filter((l) => /^\S/.test(l)).every((l) => /^[A-Za-z ]+: /.test(l))).toBe(true);
	});

	it("says the versions and the machine first", () => {
		const text = formatReport(snapshot());
		expect(text).toMatch(/Obsidian: +1\.15\.1, macOS desktop, Electron 39, Chrome 142/);
		expect(text).toContain("8 cores, 8 GB memory, window 1280x800 at 2x, language en-US");
		expect(text).toContain("script memory 180 MB used of 4096 MB");
	});

	it("leaves out what the engine does not tell", () => {
		const text = formatReport(
			snapshot({
				device: {
					cores: null,
					memoryGb: null,
					language: "fr",
					window: { width: 390, height: 844, scale: 3 },
					heap: null,
				},
			}),
		);
		expect(text).toContain("window 390x844 at 3x, language fr");
		expect(text).not.toMatch(/cores|GB memory|script memory/);
	});

	it("counts the vault and the plugins, and names the plugins only when asked", () => {
		expect(formatReport(snapshot())).toContain("15,000 notes, 15,200 files");
		expect(formatReport(snapshot())).toContain("12 community plugins enabled");
		expect(formatReport(snapshot())).not.toContain("obsidian-doubleshift,");
		const text = formatReport(snapshot({ vault: { ...snapshot().vault, pluginNames: ["alpha", "beta"] } }));
		expect(text).toContain("12 community plugins enabled:");
		expect(text).toContain("alpha, beta");
	});

	it("describes the theme in words, and warns when it leaves colours out", () => {
		expect(formatReport(snapshot())).toContain("dark mode, default theme, no CSS snippets");
		const text = formatReport(
			snapshot({ appearance: { theme: "light", name: "Minimal", snippets: 2, missingVars: ["--text-muted"] } }),
		);
		expect(text).toContain("light mode, theme Minimal, 2 CSS snippets");
		expect(text).toContain("the theme leaves out: --text-muted");
	});

	it("tells how the index stands and how fresh it is", () => {
		const text = formatReport(snapshot());
		expect(text).toContain("up to date");
		expect(text).toContain("14,982 of 15,000 notes indexed");
		expect(text).toContain("31.4 MB, 1 segment, saved 4 min ago");
	});

	it("shows a build under way, and an index that was never saved", () => {
		const text = formatReport(
			snapshot({
				index: {
					phase: "building",
					progress: { done: 300, total: 15_000 },
					eligible: 15_000,
					indexed: null,
					bytes: null,
					segments: null,
					pending: null,
					savedAt: null,
					opened: null,
				},
			}),
		);
		expect(text).toContain("building, 300 of 15,000 notes");
		expect(text).toContain("15,000 notes to index");
		expect(text).toContain("not saved yet");
	});

	it("does not call a saved index unsaved before the worker has read it", () => {
		const text = formatReport(
			snapshot({
				index: {
					...snapshot().index,
					phase: "asleep",
					indexed: null,
					bytes: null,
					segments: null,
					pending: null,
					savedAt: null,
					opened: null,
				},
			}),
		);
		expect(text).toContain("15,000 notes eligible");
		expect(text).toContain("size and age not known yet");
		expect(text).not.toContain("not saved yet");
	});

	it("says how the saved index opened and where it is kept", () => {
		const open = (over: Partial<NonNullable<ReturnType<typeof snapshot>["index"]["opened"]>>) =>
			formatReport(
				snapshot({
					index: { ...snapshot().index, opened: { ...snapshot().index.opened!, ...over } },
				}),
			);
		expect(formatReport(snapshot())).toContain("opened: loaded from disk (IndexedDB), 410 ms");
		expect(open({ how: "none" })).toContain("opened: nothing saved yet, built from scratch (IndexedDB)");
		expect(open({ how: "format-changed", found: 1 })).toContain(
			"opened: saved index is format 1, this Jet reads 2, built again",
		);
		expect(open({ how: "error" })).toContain("opened: saved index could not be read, built again");
		const memory = open({ store: "memory" });
		expect(memory).toContain("(memory only)");
		expect(memory).toContain("index kept in memory only: it is not saved between sessions");
		const warns = buildReport(
			snapshot({
				index: { ...snapshot().index, opened: { ...snapshot().index.opened!, how: "error" } },
			}),
		)
			.flatMap((x) => x.lines)
			.filter((l) => l.warn);
		expect(warns.map((l) => l.text)).toContain("opened: saved index could not be read, built again");
	});

	it("says nothing about opening before the worker has opened the index", () => {
		const text = formatReport(snapshot({ index: { ...snapshot().index, opened: null } }));
		expect(text).not.toContain("opened:");
	});

	it("counts notes waiting only when there are some", () => {
		expect(formatReport(snapshot())).not.toContain("waiting");
		const text = formatReport(snapshot({ index: { ...snapshot().index, pending: 7 } }));
		expect(text).toContain("7 waiting");
	});

	it("tells about the worker: running or not, for how long, starts, crashes, sleeps", () => {
		const text = formatReport(snapshot());
		expect(text).toContain("running for 12 min");
		expect(text).toContain("started 2x, crashed 0x, slept 1x");
		const idle = formatReport(
			snapshot({ worker: { running: false, since: null, starts: 1, crashes: 2, sleeps: 1 } }),
		);
		expect(idle).toContain("not running (starts on the first search)");
		const warn = buildReport(
			snapshot({ worker: { running: false, since: null, starts: 1, crashes: 2, sleeps: 1 } }),
		)
			.flatMap((x) => x.lines)
			.find((l) => l.text.includes("crashed 2x"));
		expect(warn?.warn).toBe(true);
	});

	it("keeps opening Jet to two short lines, and warns when another plugin handles the double tap", () => {
		const text = formatReport(snapshot());
		expect(text).toContain("hotkeys: search not set, in this note not set; double tap Shift 350 ms");
		expect(text).toContain("windows watched 1 of 1, stand-in commands 2");
		expect(text).toContain("double tap handled by another plugin: obsidian-doubleshift");
		const off = formatReport(snapshot({ open: { ...snapshot().open, tapKey: "off" } }));
		expect(off).toContain("double tap off");
		expect(off).not.toContain("handled by another plugin");
		const own = formatReport(
			snapshot({ open: { ...snapshot().open, tapOwner: null, hotkeys: { search: "Cmd+O", inNote: null } } }),
		);
		expect(own).toContain("hotkeys: search Cmd+O, in this note not set");
		expect(own).not.toContain("handled by another plugin");
	});

	it("tells the meaning model, scopes and every setting that shapes a search", () => {
		const text = formatReport(snapshot());
		expect(text).toContain("on, model minilm (31.0 MB)");
		expect(text).toContain("4 scopes, sizes 120 / 2,300 / 48 / 410");
		expect(text).toContain("results: new tab off, preview on, excerpts on, fix property keys on");
		expect(text).toContain(
			"search: stemming en, ar, 2 exclude rules, questions by both, both shown as groups, long searches by meaning off, answers on",
		);
		expect(text).toContain(
			"scopes: when new tell, typing a name suggest, another scope add, keep last scope and filters off",
		);
		expect(text).toContain("kept: 1 changed key, 10 recent searches, 340 opened notes");
	});

	it("lists scope names only when they are in the snapshot", () => {
		expect(formatReport(snapshot())).not.toContain("Atlas");
		const text = formatReport(snapshot({ scopes: { count: 2, sizes: [5, 1200], names: ["Atlas", "Nebula"] } }));
		expect(text).toContain("2 scopes");
		expect(text).toMatch(/Atlas \(5\)/);
		expect(text).toMatch(/Nebula \(1,200\)/);
	});

	it("says plainly when a feature is off or empty", () => {
		const text = formatReport(
			snapshot({
				meaning: { on: false, model: null },
				scopes: { count: 0, sizes: null, names: null },
				settings: { ...snapshot().settings, stemming: [], excludeRules: 1 },
			}),
		);
		expect(text).toMatch(/Meaning: +off/);
		expect(text).toMatch(/Scopes: +none/);
		expect(text).toContain("stemming none, 1 exclude rule,");
	});

	it("says nothing about Obsidian features when all are found, and names the missing ones otherwise", () => {
		expect(formatReport(snapshot())).not.toContain("Compatibility");
		const text = formatReport(
			snapshot({ internals: { found: 9, of: 11, missing: ["setting.openPage", "appId"] } }),
		);
		expect(text).toContain("2 of 11 Obsidian features Jet uses are missing: setting.openPage, appId");
	});

	it("has no Problems section when nothing went wrong", () => {
		expect(formatReport(snapshot())).not.toContain("Problems");
		expect(formatReport(snapshot())).not.toContain("none");
	});

	it("lists errors and warnings with their code, error name, place in Jet's code and repeats", () => {
		const text = formatReport(
			snapshot({
				problems: [
					problem({
						code: "index.open",
						error: "RangeError",
						where: "ia:1204:17",
						at: new Date(2026, 10, 21, 17, 40).getTime(),
					}),
					problem({ code: "scopes.watch", level: "warn", error: "TypeError", count: 3 }),
				],
			}),
		);
		expect(text).toContain("2 problems noticed, oldest first");
		expect(text).toContain("17:40  error index.open: RangeError at ia:1204:17");
		expect(text).toContain("18:02  warning scopes.watch: TypeError (3x)");
		const warns = buildReport(snapshot({ problems: [problem()] })).find((x) => x.label === "Problems");
		expect(warns?.lines.slice(1).every((l) => l.warn)).toBe(true);
	});

	it("draws the same text it copies", () => {
		const s = snapshot({ problems: [problem()] });
		const drawn = layout(buildReport(s))
			.map((r) => r.label + r.text)
			.join("\n");
		expect(drawn).toBe(formatReport(s));
	});

	it("never prints undefined or NaN", () => {
		const text = formatReport(snapshot({ problems: [problem()] }));
		expect(text).not.toMatch(/undefined|NaN|\[object|null/);
	});

	it("puts the report in a code block for GitHub, with the user's sentence above it", () => {
		const md = formatForGithub(snapshot(), "  Double Shift does nothing.  ");
		expect(md.startsWith("**What happened**\nDouble Shift does nothing.\n")).toBe(true);
		expect(md).toContain("```text\nJet Search:");
		expect(md.trimEnd().endsWith("```")).toBe(true);
	});

	it("leaves out the sentence when there is none", () => {
		expect(formatForGithub(snapshot(), "  ")).not.toContain("What happened");
	});

	// Each kind of problem a user reports has the facts that settle it in the report.
	const CONTRACT: Record<string, string[]> = {
		"Jet does not open": [
			"hotkeys: search",
			"double tap Shift 350 ms",
			"handled by another plugin:",
			"windows watched 1 of 1",
			"stand-in commands 2",
		],
		"finds nothing, slow, unavailable": [
			"notes indexed",
			"saved 4 min ago",
			"running for",
			"started 2x, crashed 0x, slept 1x",
		],
		"wrong results needs the setup": [
			"14,982 of 15,000 notes indexed",
			"2 exclude rules",
			"stemming en, ar",
			"questions by both",
			"15,000 notes",
		],
		"looks broken": ["dark mode", "default theme", "window 1280x800 at 2x", "preview on"],
		"phone or older device": ["macOS desktop", "Electron 39", "Obsidian: ", "8 cores", "language en-US"],
		"meaning, answers, scopes": ["Meaning", "model minilm", "4 scopes, sizes", "answers on"],
		"memory or cpu": ["31.4 MB", "1 segment", "script memory", "12 community plugins"],
	};
	for (const [problem, facts] of Object.entries(CONTRACT))
		it(`holds the facts for: ${problem}`, () => {
			const text = formatReport(snapshot());
			for (const f of facts) expect(text).toContain(f);
		});
});
