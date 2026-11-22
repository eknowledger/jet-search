import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { diag } from "../src/diag/diag";
import { recorder, FLAG } from "../src/diag/recorder";
import { KIND, trace } from "../src/diag/trace";

const files = (dir: string): string[] =>
	readdirSync(dir).flatMap((n) => {
		const p = join(dir, n);
		return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
	});
const read = (p: string): string => readFileSync(p, "utf8");

beforeEach(() => {
	vi.useFakeTimers();
	trace.reset();
	diag.reset();
	recorder.reset();
});
afterEach(() => {
	trace.reset();
	vi.useRealTimers();
});

describe("what a trace is fed with", () => {
	it("hears of the worker starting, stopping, crashing and sleeping, with the time", () => {
		trace.start(5);
		diag.workerStarted();
		diag.slept();
		diag.workerStopped();
		diag.workerCrashed();
		expect(trace.list().map((e) => e.kind)).toEqual([
			KIND.start,
			KIND.workerStart,
			KIND.workerSleep,
			KIND.workerStop,
			KIND.workerCrash,
		]);
	});

	it("hears of a caught error by its code only, never its message", () => {
		trace.start(5);
		diag.problem("search.failed", new TypeError("cannot read /Private/Plans.md"), "error", null);
		diag.problem("meaning.check", new Error("x"), "warn", null);
		const [, a, b] = trace.list();
		expect(a).toMatchObject({ kind: KIND.problem, label: "search.failed", flags: 0 });
		expect(b).toMatchObject({ kind: KIND.problem, label: "meaning.check", flags: 1 });
		expect(JSON.stringify(trace.list())).not.toContain("Private");
	});

	it("hears of each search from the flight recorder, with its parts", () => {
		trace.start(5);
		recorder.add(FLAG.words | FLAG.cold, 12, 2, 40, 31, 20, 5, 2, 3, 1);
		const e = trace.list()[1];
		expect(e).toMatchObject({
			kind: KIND.search,
			a: 31,
			b: 20,
			c: 5,
			d: 40,
			flags: FLAG.words | FLAG.cold | (12 << 8),
		});
	});

	it("keeps only how long a search was (255 at most), never its text", () => {
		trace.start(5);
		recorder.add(FLAG.words, 4000, 1, 1, 1, 1, 1, 1, 1, 1);
		expect(trace.list()[1]?.flags).toBe(FLAG.words | (255 << 8));
	});

	it("makes nothing while it is off", () => {
		diag.workerStarted();
		diag.problem("x", new Error("y"), "error", null);
		recorder.add(1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
		expect(trace.state().events).toBe(0);
		expect(trace.list()).toEqual([]);
	});
});

describe("the trace stays out of the hot paths", () => {
	it("the engine, the worker, the search, the ranking, the names and the window never name it", () => {
		const off = [
			...files("src/engine"),
			...files("src/worker").filter((f) => !f.endsWith("jet-client.ts")),
			...files("src/modal"),
			...files("src/tier0"),
			"src/search.ts",
			"src/rank.ts",
		];
		expect(off.length).toBeGreaterThan(20);
		for (const f of off) expect(read(f), f).not.toMatch(/diag\/trace|\btrace\./);
	});

	it("every event is made behind a test of `trace.on`, in the line or the two before it", () => {
		let seen = 0;
		for (const f of files("src")) {
			if (f.endsWith("diag/trace.ts")) continue;
			const lines = read(f).split("\n");
			lines.forEach((line, i) => {
				if (!/\btrace\.add\(/.test(line)) return;
				seen++;
				const near = lines.slice(Math.max(0, i - 2), i + 1).join("\n");
				expect(near, `${f}:${i + 1}`).toMatch(/trace\.on/);
			});
		}
		expect(seen).toBeGreaterThan(8);
	});

	it("a trace that has not been asked for does nothing when the file loads: its one timer is made in start()", () => {
		const src = read("src/diag/trace.ts");
		expect(src.match(/setTimeout\(/g)).toHaveLength(1);
		expect(src).not.toMatch(/setInterval|requestAnimationFrame|addEventListener|registerEvent|new Worker/);
		const start = src.slice(src.indexOf("\tstart("), src.indexOf("\tstop("));
		expect(start).toMatch(/setTimeout\(/);
	});
});
