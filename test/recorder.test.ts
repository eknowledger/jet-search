import { describe, expect, it } from "vitest";
import { Recorder, FLAG } from "../src/diag/recorder";

const add = (r: Recorder, total: number, over: Partial<{ flags: number; hits: number; worker: number }> = {}) =>
	r.add(over.flags ?? FLAG.words, 12, 2, over.hits ?? 5, total, 1, over.worker ?? total / 2, 1, 2, 0);

describe("the flight recorder", () => {
	it("allocates nothing until the first search is recorded", () => {
		const r = new Recorder();
		expect(r.allocated).toBe(false);
		expect(r.summary()).toBeNull();
		add(r, 10);
		expect(r.allocated).toBe(true);
	});

	it("keeps the last 100 searches and forgets the older ones", () => {
		const r = new Recorder();
		for (let i = 1; i <= 130; i++) add(r, i);
		const s = r.summary()!;
		expect(s.kept).toBe(100);
		expect(s.total).toBe(130);
		// The kept ones are 31..130: the slowest is 130, the median about 80.
		expect(s.max.total).toBe(130);
		expect(s.median).toBeGreaterThan(79);
		expect(s.median).toBeLessThan(82);
	});

	it("reports median, 95th percentile and the slowest", () => {
		const r = new Recorder();
		for (let i = 1; i <= 100; i++) add(r, i);
		const s = r.summary()!;
		expect(s.median).toBeCloseTo(50.5, 0);
		expect(s.p95).toBeGreaterThanOrEqual(95);
		expect(s.p95).toBeLessThanOrEqual(96);
		expect(s.max.total).toBe(100);
	});

	it("tells where the time goes, as medians of each stage", () => {
		const r = new Recorder();
		for (let i = 0; i < 9; i++) r.add(FLAG.words, 10, 1, 3, 20, 4, 6, 2, 7, 1);
		const s = r.summary()!;
		expect(s.stages).toEqual({ ready: 4, worker: 6, transit: 2, prepare: 7, excerpts: 1 });
	});

	it("counts searches by kind and flags, and the slowest search's own details", () => {
		const r = new Recorder();
		add(r, 5);
		add(r, 6, { flags: FLAG.meaning });
		add(r, 7, { flags: FLAG.words | FLAG.scoped });
		add(r, 90, { flags: FLAG.words | FLAG.cold | FLAG.building, hits: 50, worker: 71 });
		const s = r.summary()!;
		expect(s.kinds).toEqual({ words: 3, meaning: 1 });
		expect(s.flags).toMatchObject({ scoped: 1, cold: 1, building: 1 });
		expect(s.max).toMatchObject({ total: 90, hits: 50, worker: 71, words: 2, chars: 12 });
		expect(s.max.flags & FLAG.cold).toBeTruthy();
	});

	it("counts searches that a newer one replaced", () => {
		const r = new Recorder();
		r.superseded();
		r.superseded();
		add(r, 5);
		expect(r.summary()!.superseded).toBe(2);
	});

	it("holds numbers only: no text of any search can be in it", () => {
		const r = new Recorder();
		add(r, 5);
		const walk = (v: unknown): void => {
			if (v !== null && typeof v === "object") for (const x of Object.values(v)) walk(x);
			else expect(typeof v).toBe("number");
		};
		walk(r.summary());
	});

	it("forgets everything on reset", () => {
		const r = new Recorder();
		add(r, 5);
		r.reset();
		expect(r.summary()).toBeNull();
	});
});
