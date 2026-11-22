import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KEEP, KIND, trace } from "../src/diag/trace";

beforeEach(() => {
	vi.useFakeTimers();
	trace.reset();
});
afterEach(() => {
	trace.reset();
	vi.useRealTimers();
});

describe("the trace", () => {
	it("is off, empty and allocates nothing until it is started", () => {
		expect(trace.on).toBe(false);
		expect(trace.state().events).toBe(0);
		expect(trace.list()).toEqual([]);
		// A stray call while off makes no event.
		trace.add(KIND.search, 5);
		expect(trace.list()).toEqual([]);
	});

	it("records events with the time since it began, and numbers, in order", () => {
		trace.start(15, 1_000_000);
		trace.add(KIND.workerStart, 0, 0, 0, 0, 0, null, 1_002_000);
		trace.add(KIND.search, 7.5, 1, 4, 11, 3, null, 1_003_500);
		const ev = trace.list();
		expect(ev.map((e) => e.kind)).toEqual([KIND.start, KIND.workerStart, KIND.search]);
		expect(ev[1]?.t).toBe(2000);
		expect(ev[2]).toMatchObject({ t: 3500, a: 7.5, b: 1, c: 4, d: 11, flags: 3 });
		expect(ev[0]?.a).toBe(15);
	});

	it("stops by itself when its time is up, and keeps what it recorded", () => {
		trace.start(5);
		expect(trace.on).toBe(true);
		vi.advanceTimersByTime(5 * 60_000 - 1);
		expect(trace.on).toBe(true);
		vi.advanceTimersByTime(2);
		expect(trace.on).toBe(false);
		const s = trace.state();
		expect(s).toMatchObject({ recording: false, stopped: "time", minutes: 5, endsAt: null });
		expect(trace.list().at(-1)?.kind).toBe(KIND.stop);
	});

	it("stops when asked, once, and a second stop does nothing", () => {
		trace.start(10);
		trace.stop("user");
		const n = trace.state().events;
		trace.stop("user");
		expect(trace.state().events).toBe(n);
		expect(trace.state().stopped).toBe("user");
		vi.advanceTimersByTime(60 * 60_000);
		expect(trace.state().events).toBe(n);
	});

	it("starting again forgets the last trace, and starting while recording changes nothing", () => {
		trace.start(5);
		trace.add(KIND.search, 1);
		trace.stop("user");
		trace.start(30);
		expect(trace.list().map((e) => e.kind)).toEqual([KIND.start]);
		trace.add(KIND.search, 2);
		trace.start(60);
		expect(trace.state().minutes).toBe(30);
		expect(trace.list()).toHaveLength(2);
	});

	it("keeps the newest events when there are more than it holds", () => {
		trace.start(60);
		for (let i = 0; i < KEEP + 20; i++) trace.add(KIND.search, i);
		const ev = trace.list();
		expect(ev).toHaveLength(KEEP);
		expect(trace.state()).toMatchObject({ events: KEEP + 21, kept: KEEP });
		expect(ev.at(-1)?.a).toBe(KEEP + 19);
		expect(ev[0]?.a).toBe(20);
	});

	it("tells the listeners when it starts and ends, not for each event", () => {
		const seen: boolean[] = [];
		const off = trace.onChange(() => seen.push(trace.on));
		trace.start(5);
		trace.add(KIND.search, 1);
		trace.stop("user");
		off();
		trace.start(5);
		expect(seen).toEqual([true, false]);
	});

	it("keeps a label with an event and clears it when the slot is used again", () => {
		trace.start(60);
		trace.add(KIND.problem, 0, 0, 0, 0, 1, "search.failed");
		expect(trace.list()[1]?.label).toBe("search.failed");
		for (let i = 0; i < KEEP; i++) trace.add(KIND.search, i);
		expect(trace.list().every((e) => e.label === null)).toBe(true);
	});
});
