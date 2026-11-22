import { describe, expect, it } from "vitest";
import { buildReport, formatForGithub, formatReport, NO_OPTIONS } from "../src/diag/report";
import { FLAG } from "../src/diag/recorder";
import { KIND, OPENED, type Event, type TraceState } from "../src/diag/trace";
import { summarize, timelineLines, traceLines } from "../src/diag/trace-report";
import { NOW, snapshot } from "./diag-fixture";

const ev = (t: number, kind: Event["kind"], over: Partial<Event> = {}): Event => ({
	t,
	kind,
	a: 0,
	b: 0,
	c: 0,
	d: 0,
	flags: 0,
	label: null,
	...over,
});

const state = (over: Partial<TraceState> = {}): TraceState => ({
	recording: false,
	startedAt: NOW - 20 * 60_000,
	minutes: 15,
	endsAt: null,
	stopped: "time",
	events: 0,
	kept: 0,
	...over,
});

const EVENTS: Event[] = [
	ev(0, KIND.start, { a: 15 }),
	ev(2_000, KIND.workerStart),
	ev(2_100, KIND.indexOpen, { a: 410, flags: OPENED.loaded }),
	ev(3_000, KIND.changes, { a: 850, b: 12, c: 3, flags: 1 }),
	ev(4_000, KIND.search, { a: 7, b: 0, c: 4, d: 11, flags: FLAG.words | (5 << 8) }),
	ev(9_000, KIND.search, { a: 6, b: 0, c: 3, d: 11, flags: FLAG.words }),
	ev(41_000, KIND.workerSleep),
	ev(41_001, KIND.workerStop),
	ev(75_000, KIND.workerStart),
	ev(75_123, KIND.search, { a: 142, b: 118, c: 19, d: 40, flags: FLAG.words | FLAG.cold | (12 << 8) }),
	ev(80_000, KIND.problem, { label: "search.failed", flags: 0 }),
	ev(90_000, KIND.changes, { a: 120, b: 4, c: 0 }),
	ev(95_000, KIND.changes, { a: 60, b: 1, c: 0 }),
	ev(900_000, KIND.stop, { a: 1 }),
];

describe("what a trace says in the report", () => {
	it("counts searches and names the slowest with where its time went", () => {
		const t = summarize(EVENTS, state({ events: EVENTS.length, kept: EVENTS.length }), NOW);
		expect(t.searches).toMatchObject({ n: 3, slowest: [{ total: 142 }, { total: 7 }, { total: 6 }] });
		const text = traceLines(t).map((l) => l.text);
		expect(text[0]).toBe("recorded 15 min, stopped by itself, 14 events");
		expect(text).toContain("searches 3, median 7.0 ms, 95% under 142 ms");
		expect(text).toContain(
			"slowest: 142 ms at 1:15.123 (index wait 118, worker 19, other 5.0), 40 hits, worker had to start",
		);
	});

	it("counts the worker's starts, sleeps and crashes during the trace", () => {
		const t = summarize(EVENTS, state(), NOW);
		expect(t.worker).toEqual({ starts: 2, stops: 1, sleeps: 1, crashes: 0 });
		expect(traceLines(t).map((l) => l.text)).toContain("worker started 2x, slept 1x, crashed 0x");
	});

	it("says how the index opened, and what the catch-up and the later changes cost", () => {
		const text = traceLines(summarize(EVENTS, state(), NOW)).map((l) => l.text);
		expect(text).toContain("index opened: loaded, 410 ms");
		expect(text).toContain("catch-up after the start: 12 notes changed, 3 removed, 850 ms");
		expect(text).toContain("changes sent to the index: 2 times, 5 notes, slowest 120 ms");
	});

	it("names a problem by its code and when, and a build by its size and time", () => {
		const withBuild: Event[] = [
			...EVENTS.slice(0, 3),
			ev(2_200, KIND.buildStart, { a: 15_000 }),
			ev(43_200, KIND.buildEnd, { a: 41_000, b: 15_000 }),
			...EVENTS.slice(10),
		];
		const lines = traceLines(summarize(withBuild, state(), NOW));
		expect(lines.map((l) => l.text)).toContain("index built: 15,000 notes in 41 s");
		const p = lines.find((l) => l.text.includes("search.failed"));
		expect(p).toEqual({ text: "problem search.failed at 1:20.000", warn: true });
	});

	it("shows a trace still recording with the time left, and one that was stopped by the user", () => {
		const rec = traceLines(
			summarize(
				EVENTS.slice(0, 5),
				state({ recording: true, stopped: null, endsAt: NOW + 12 * 60_000, events: 5, kept: 5 }),
				NOW,
			),
		);
		expect(rec[0]?.text).toBe("recording, 12 min left, 5 events so far");
		const user = traceLines(summarize(EVENTS, state({ stopped: "user" }), NOW));
		expect(user[0]?.text).toContain("stopped by you");
	});

	it("says so when events were dropped, and when nothing happened", () => {
		const t = summarize(EVENTS, state({ events: 900, kept: 500 }), NOW);
		expect(traceLines(t)[0]?.text).toContain("900 events, the last 500 kept");
		const empty = traceLines(
			summarize([ev(0, KIND.start, { a: 5 })], state({ minutes: 5, events: 1, kept: 1 }), NOW),
		).map((l) => l.text);
		expect(empty).toContain("no searches");
	});

	it("writes the timeline as time and words, newest 300 at most, with no word of a search", () => {
		const lines = timelineLines(EVENTS);
		expect(lines[0]).toBe("0:00.000  trace started, for 15 min");
		expect(lines).toContain("0:02.100  index opened: loaded, 410 ms");
		expect(lines).toContain(
			"1:15.123  search of 12 characters, 142 ms (index wait 118, worker 19), 40 hits, worker had to start",
		);
		expect(lines).toContain("1:20.000  error search.failed");
		expect(lines.at(-1)).toBe("15:00.000  trace stopped by itself");
		const many = Array.from({ length: 700 }, (_, i) => ev(i * 1000, KIND.search, { a: i }));
		const cut = timelineLines(many);
		expect(cut).toHaveLength(300);
		expect(cut.at(-1)).toContain("699 ms");
		expect(lines).toContain("0:04.000  search of 5 characters, 7.0 ms (index wait 0, worker 4.0), 11 hits");
	});
});

describe("the trace in the whole report", () => {
	const withTrace = (opts = false) =>
		snapshot({
			trace: summarize(EVENTS, state({ events: EVENTS.length, kept: EVENTS.length }), NOW),
			traceTimeline: opts ? timelineLines(EVENTS) : null,
		});

	it("has no Trace section when none was ever recorded", () => {
		expect(formatReport(snapshot())).not.toContain("Trace:");
		expect(buildReport(snapshot()).some((s) => s.label === "Trace")).toBe(false);
	});

	it("has a Trace section after the searches, and the timeline only when asked", () => {
		const labels = buildReport(withTrace()).map((s) => s.label);
		expect(labels.indexOf("Trace")).toBe(labels.indexOf("Searches") + 1);
		expect(labels).not.toContain("Timeline");
		expect(buildReport(withTrace(true)).map((s) => s.label)).toContain("Timeline");
		expect(formatReport(withTrace(true))).toContain("0:02.100  index opened: loaded, 410 ms");
	});

	it("folds the timeline in a block of its own in the GitHub copy", () => {
		const md = formatForGithub(withTrace(true), "");
		const [main, rest] = md.split("<details>");
		expect(main).toContain("Trace:");
		expect(main).not.toContain("0:02.100  index opened");
		expect(rest).toContain("<summary>Trace timeline (14 lines)</summary>");
		expect(rest).toContain("0:02.100  index opened: loaded, 410 ms");
		expect(rest).toContain("</details>");
		expect(formatForGithub(withTrace(), "")).not.toContain("<details>");
	});

	it("carries no search text or name (only numbers, codes and times)", () => {
		const text = formatReport(withTrace(true));
		expect(text).not.toMatch(/Private|Plans|\.md/);
		expect(NO_OPTIONS.traceTimeline).toBe(false);
	});
});
