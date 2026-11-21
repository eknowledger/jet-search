import { describe, expect, it } from "vitest";
import { formatForGithub, formatReport } from "../src/diag/report";
import { snapshot } from "./diag-fixture";

describe("the support report", () => {
	it("says the versions first", () => {
		const lines = formatReport(snapshot()).split("\n");
		expect(lines[0]).toBe("Jet Search 0.7.1, build jetbuild-release");
		expect(lines[1]).toBe("Obsidian 1.15.1, macOS desktop");
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
				},
			}),
		);
		expect(text).toContain("building, 300 of 15,000 notes");
		expect(text).toContain("15,000 notes to index");
		expect(text).toContain("not saved yet");
	});

	it("counts notes waiting only when there are some", () => {
		expect(formatReport(snapshot())).not.toContain("waiting");
		const text = formatReport(snapshot({ index: { ...snapshot().index, pending: 7 } }));
		expect(text).toContain("7 waiting");
	});

	it("counts the worker's starts, crashes and sleeps", () => {
		expect(formatReport(snapshot())).toContain("started 2x, crashed 0x, slept 1x");
	});

	it("names who handles the double tap when it is not Jet", () => {
		const text = formatReport(snapshot());
		expect(text).toContain("double tap: Shift, 350 ms");
		expect(text).toContain("handled by another plugin (obsidian-doubleshift)");
		expect(text).toContain("hotkeys: search not set, in this note not set");
		expect(text).toContain("commands standing in for other plugins: 2");
		expect(text).toContain("windows watched: 1 of 1");
	});

	it("does not blame another plugin when the double tap is off", () => {
		const text = formatReport(snapshot({ open: { ...snapshot().open, tapKey: "off" } }));
		expect(text).toContain("double tap: off");
		expect(text).not.toContain("handled by another plugin");
	});

	it("shows Jet's own double tap and a bound hotkey", () => {
		const text = formatReport(
			snapshot({ open: { ...snapshot().open, tapOwner: null, hotkeys: { search: "Cmd+O", inNote: null } } }),
		);
		expect(text).toContain("hotkeys: search Cmd+O, in this note not set");
		expect(text).not.toContain("handled by another plugin");
	});

	it("tells the meaning model, scopes and settings in a line each", () => {
		const text = formatReport(snapshot());
		expect(text).toContain("on, model minilm (31.0 MB)");
		expect(text).toContain("4 scopes, sizes 120 / 2,300 / 48 / 410");
		expect(text).toContain("stemming en, ar, excerpts on");
		expect(text).toContain("2 exclude rules, new tab off, preview on");
	});

	it("says when there is nothing to tell", () => {
		const text = formatReport(
			snapshot({
				meaning: { on: false, model: null },
				scopes: { count: 0, sizes: null },
				problems: [],
				settings: { stemming: [], excerpts: false, excludeRules: 1, newTab: true, preview: false },
			}),
		);
		expect(text).toContain("Meaning   off");
		expect(text).toContain("Scopes    none");
		expect(text).toContain("none noticed");
		expect(text).toContain("stemming none, excerpts off");
		expect(text).toContain("1 exclude rule,");
	});

	it("says what is missing: theme variables and Obsidian internals", () => {
		const text = formatReport(
			snapshot({
				screen: {
					theme: "light",
					vars: { set: 4, of: 6, missing: ["--text-muted", "--background-secondary"] },
				},
				internals: { found: 10, of: 12, missing: ["setting.openPage", "appId"] },
			}),
		);
		expect(text).toContain("light theme");
		expect(text).toContain("4 of 6 theme variables set, missing --text-muted, --background-secondary");
		expect(text).toContain("10 of 12 internals found, missing setting.openPage, appId");
	});

	it("lists the problems Jet noticed, with a count for a repeat", () => {
		const text = formatReport(
			snapshot({
				problems: [
					{ code: "index.open", error: "RangeError", at: new Date(2026, 10, 21, 17, 40).getTime(), count: 1 },
					{
						code: "save.failed",
						error: "QuotaExceededError",
						at: new Date(2026, 10, 21, 18, 2).getTime(),
						count: 3,
					},
				],
			}),
		);
		expect(text).toContain("noticed (2)");
		expect(text).toContain("17:40  index.open: RangeError");
		expect(text).toContain("18:02  save.failed: QuotaExceededError (3x)");
	});

	it("never prints undefined or NaN", () => {
		const text = formatReport(snapshot());
		expect(text).not.toMatch(/undefined|NaN|\[object/);
	});

	it("puts the report in a code block for GitHub, with the user's sentence above it", () => {
		const md = formatForGithub(snapshot(), "  Double Shift does nothing.  ");
		expect(md.startsWith("**What happened**\nDouble Shift does nothing.\n")).toBe(true);
		expect(md).toContain("```text\nJet Search 0.7.1");
		expect(md.trimEnd().endsWith("```")).toBe(true);
	});

	it("leaves out the sentence when there is none", () => {
		expect(formatForGithub(snapshot(), "  ")).not.toContain("What happened");
	});

	// Each kind of problem a user reports has the facts that settle it in the report.
	const CONTRACT: Record<string, string[]> = {
		"Jet does not open": [
			"hotkeys: search",
			"double tap: Shift, 350 ms",
			"handled by another plugin (",
			"windows watched: 1 of 1",
			"standing in for other plugins: 2",
		],
		"finds nothing, slow, unavailable": [
			"notes indexed",
			"saved 4 min ago",
			"started 2x, crashed 0x, slept 1x",
			"Problems",
		],
		"wrong results needs the index to be current": [
			"14,982 of 15,000 notes indexed",
			"2 exclude rules",
			"stemming en, ar",
		],
		"looks broken": ["dark theme", "theme variables set", "preview on"],
		"phone or older device": ["macOS desktop", "internals found", "Obsidian 1.15.1"],
		"meaning, answers, scopes": ["Meaning", "model minilm", "4 scopes, sizes"],
		memory: ["31.4 MB", "1 segment"],
	};
	for (const [problem, facts] of Object.entries(CONTRACT))
		it(`holds the facts for: ${problem}`, () => {
			const text = formatReport(snapshot());
			for (const f of facts) expect(text).toContain(f);
		});
});
