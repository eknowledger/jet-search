import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, TFile } from "obsidian";
import JetSearchPlugin from "../src/main";
import { collect } from "../src/diag/collect";
import { diag } from "../src/diag/diag";
import { FLAG, recorder } from "../src/diag/recorder";
import { formatForGithub, formatReport, NO_OPTIONS } from "../src/diag/report";
import { KIND, OPENED, trace } from "../src/diag/trace";

const manifest = { id: "jet-search", name: "Jet Search", version: "0.7.1" };
const make = (): { app: App; plugin: JetSearchPlugin } => {
	const app = new App();
	return { app, plugin: new JetSearchPlugin(app as never, manifest as never) };
};
const ALL = { ...NO_OPTIONS, scopeNames: true, pluginNames: true, explainNames: true, traceTimeline: true };

beforeEach(() => {
	vi.useFakeTimers();
	trace.reset();
	diag.reset();
	recorder.reset();
	vi.stubGlobal("Worker", class {});
});
afterEach(() => {
	trace.reset();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("a trace holds no name and no word of a search", () => {
	it("keeps only codes and numbers, over names, searches and errors that are all invented secrets", async () => {
		const { app, plugin } = make();
		await plugin.onload();
		const secrets = ["Acme Merger", "Salary Review", "Nebula Payroll", "Quarterly Layoffs", "q3-secret-plan"];
		app.vault.files.set("Acme Merger/Salary Review.md", new TFile("Acme Merger/Salary Review.md"));
		plugin.data.settings.exclude = ["Acme Merger"];
		plugin.data.scopes.push({
			id: "s1",
			name: "Nebula Payroll",
			aliases: ["q3-secret-plan"],
			kind: "",
			rules: [],
			combine: "any",
			mode: "both",
			source: "manual",
		} as never);
		Object.assign(app, { plugins: { plugins: {}, enabledPlugins: new Set(["q3-secret-plan-plugin"]) } });
		secrets.push("q3-secret-plan-plugin");

		trace.start(15);
		// An error whose message is a name, and one the worker caught.
		diag.problem("note.open", new Error("ENOENT: Acme Merger/Salary Review.md"));
		diag.workerEvent({
			code: "index.read",
			level: "warn",
			error: "TypeError",
			where: "worker.js:12",
		});
		// A search for a secret: only its length and its numbers reach the recorder.
		const query = "Salary Review";
		recorder.add(FLAG.words, query.length, 2, 7, 12, 1, 6, 1, 2, 2);
		diag.workerStarted();
		diag.slept();
		trace.stop("user");

		const events = trace.list();
		const held = JSON.stringify(events);
		for (const s of secrets) expect(held).not.toContain(s);
		// Every word an event carries is a code of the plugin's own, never a name.
		for (const e of events) expect(e.label === null || /^[a-z][a-z0-9.-]*$/.test(e.label)).toBe(true);
		const text =
			formatReport(collect(plugin, Date.now(), ALL)) + formatForGithub(collect(plugin, Date.now(), ALL), "");
		for (const s of secrets.filter(
			(x) => x !== "Nebula Payroll" && x !== "q3-secret-plan" && x !== "q3-secret-plan-plugin",
		))
			expect(text, s).not.toContain(s);
		// The timeline itself, the part a trace adds, never has them, even with every name box ticked.
		const timeline = collect(plugin, Date.now(), ALL).traceTimeline?.join("\n") ?? "";
		expect(timeline).toContain("search of 13 characters");
		for (const s of secrets) expect(timeline).not.toContain(s);
	});
});

describe("what a complaint needs is in the report", () => {
	const lines = async (setup: () => void): Promise<string> => {
		const { plugin } = make();
		await plugin.onload();
		vi.setSystemTime(1_000_000);
		trace.start(15);
		setup();
		vi.setSystemTime(1_100_000);
		trace.stop("user");
		return formatReport(collect(plugin, Date.now(), { ...NO_OPTIONS, traceTimeline: true }));
	};

	it("a slow start: how long the index took to open, the catch-up, the first search that waited, and the worker's starts", async () => {
		const text = await lines(() => {
			trace.add(KIND.mark, 0, 0, 0, 0, 0, "plugin loaded", 1_000_050);
			trace.add(KIND.mark, 0, 0, 0, 0, 0, "layout ready", 1_000_900);
			trace.add(KIND.workerStart, 0, 0, 0, 0, 0, null, 1_001_000);
			trace.add(KIND.indexOpen, 4_500, 0, 0, 0, OPENED.loaded, null, 1_005_500);
			trace.add(KIND.changes, 1_200, 40, 2, 0, 1, null, 1_006_700);
			trace.add(KIND.search, 900, 800, 12, 30, FLAG.words | FLAG.cold | (5 << 8), null, 1_007_600);
		});
		expect(text).toContain("worker started 1x");
		expect(text).toContain("index opened: loaded, 4500 ms");
		expect(text).toContain("catch-up after the start: 40 notes changed, 2 removed, 1200 ms");
		expect(text).toContain(
			"slowest: 900 ms at 0:07.600 (index wait 800, worker 12, other 88), 30 hits, worker had to start",
		);
		expect(text).toContain("0:00.050  plugin loaded");
		expect(text).toContain("0:00.900  layout ready");
	});

	it("a slow search: how many, how slow, where the time went, what kind of search, and the worker's naps", async () => {
		const text = await lines(() => {
			for (let i = 0; i < 12; i++)
				trace.add(KIND.search, 8 + i, 0.2, 1, 40, FLAG.words | (((i % 6) + 1) << 8), null, 1_010_000 + i * 200);
			trace.add(KIND.search, 640, 0.3, 30, 50, FLAG.meaning | (14 << 8), null, 1_020_000);
			trace.add(KIND.workerSleep, 0, 0, 0, 0, 0, null, 1_030_000);
			trace.add(KIND.workerStart, 0, 0, 0, 0, 0, null, 1_040_000);
			trace.add(KIND.search, 300, 280, 5, 9, FLAG.words | FLAG.cold | (6 << 8), null, 1_040_100);
		});
		expect(text).toContain("searches 14, median ");
		expect(text).toContain(
			"slowest: 640 ms at 0:20.000 (index wait 0.3, worker 30, other 610), 50 hits, by meaning",
		);
		expect(text).toContain("next: 300 ms at 0:40.100");
		expect(text).toContain("queries about 3, searches less than 2 s apart counted as one");
		expect(text).toContain("worker started 1x, slept 1x, crashed 0x");
		expect(text).toContain("search of 14 characters, 640 ms");
	});
});
