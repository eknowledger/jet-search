/**
 * What the support info's pieces cost, per call, on this machine: the counters written at rare events, the
 * recorded problem, and what a recorder would add if it sat in a loop (a clock read, a typed-array write, a
 * boolean test). A baseline loop is measured first and subtracted, so the figures are the added work.
 *   npm run bench:diag
 */
import { performance } from "node:perf_hooks";
import { diag } from "../src/diag/diag";
import { FLAG, Recorder } from "../src/diag/recorder";
import { KIND, trace } from "../src/diag/trace";

// A trace names the page's two timer calls; this run has no page, so give it the same ones.
(globalThis as unknown as { window: unknown }).window = { setTimeout, clearTimeout };

const N = 20_000_000;
const ROUNDS = 7;
let sink = 0;

const time = (fn: (n: number) => number): number => {
	const runs: number[] = [];
	for (let r = 0; r < ROUNDS; r++) {
		const t0 = performance.now();
		sink += fn(N);
		runs.push(performance.now() - t0);
	}
	runs.sort((a, b) => a - b);
	// Median ns per call.
	return ((runs[Math.floor(runs.length / 2)] ?? 0) * 1e6) / N;
};

const base = time((n) => {
	let x = 0;
	for (let i = 0; i < n; i++) x += i & 1;
	return x;
});

const ring = new Float64Array(256);
const err = new Error("x");
const off = false as boolean;

const rec = new Recorder();

const cases: Array<[string, (n: number) => number]> = [
	[
		"an integer counter (diag.workerStarted)",
		(n) => {
			let x = 0;
			for (let i = 0; i < n; i++) {
				diag.workerStarted();
				x += i & 1;
			}
			return x;
		},
	],
	[
		"a boolean test that is false (a switched-off recorder)",
		(n) => {
			let x = 0;
			for (let i = 0; i < n; i++) {
				if (off) x++;
				x += i & 1;
			}
			return x;
		},
	],
	[
		"a clock read (performance.now)",
		(n) => {
			let x = 0;
			for (let i = 0; i < n; i++) x += performance.now() > 0 ? i & 1 : 0;
			return x;
		},
	],
	[
		"a typed-array write into a ring of 256",
		(n) => {
			let x = 0;
			for (let i = 0; i < n; i++) {
				ring[i & 255] = i;
				x += i & 1;
			}
			return x;
		},
	],
	[
		"the flight recorder: one search added (ten values)",
		(n) => {
			let x = 0;
			for (let i = 0; i < n; i++) {
				rec.add(FLAG.words, 12, 2, 5, 14, 1, 6, 1, 2, 4);
				x += i & 1;
			}
			return x;
		},
	],
	[
		"one search as the code would do it: four clock reads and the add",
		(n) => {
			let x = 0;
			for (let i = 0; i < n; i++) {
				const t0 = performance.now();
				const t1 = performance.now();
				const t2 = performance.now();
				const t3 = performance.now();
				rec.add(FLAG.words, 12, 2, 5, t3 - t0, t1 - t0, 6, t2 - t1, 2, 4);
				x += i & 1;
			}
			return x;
		},
	],
	[
		"a trace that is off: the `trace.on` test callers make",
		(n) => {
			let x = 0;
			trace.reset();
			for (let i = 0; i < n; i++) {
				if (trace.on) trace.add(KIND.search, 1);
				x += i & 1;
			}
			return x;
		},
	],
	[
		"a trace recording: one event added (kind, four values, flags, a clock read)",
		(n) => {
			let x = 0;
			trace.reset();
			trace.start(60);
			for (let i = 0; i < n; i++) {
				if (trace.on) trace.add(KIND.search, 12, 1, 6, 40, 1);
				x += i & 1;
			}
			trace.reset();
			return x;
		},
	],
	[
		"the flight recorder's add, with a trace recording as well",
		(n) => {
			let x = 0;
			trace.reset();
			trace.start(60);
			for (let i = 0; i < n; i++) {
				rec.add(FLAG.words, 12, 2, 5, 14, 1, 6, 1, 2, 4);
				x += i & 1;
			}
			trace.reset();
			return x;
		},
	],
	[
		"a problem recorded, same one again (counts up)",
		(n) => {
			let x = 0;
			diag.reset();
			for (let i = 0; i < n / 20; i++) {
				diag.problem("save.failed", err);
				x += i & 1;
			}
			return x * 20;
		},
	],
];

console.log(`baseline loop: ${base.toFixed(2)} ns per iteration (subtracted)\n`);
console.log("what".padEnd(58), "added ns per call");
for (const [name, fn] of cases)
	console.log(
		name.padEnd(58),
		Math.max(0, time(fn) - base)
			.toFixed(2)
			.padStart(10),
	);

// What a trace gives back when a report is asked for, never while it records.
trace.reset();
trace.start(60);
for (let i = 0; i < 500; i++) trace.add(KIND.search, 12, 1, 6, 40, 1);
const t1 = performance.now();
for (let i = 0; i < 2_000; i++) sink += trace.list().length;
console.log(
	`\ntrace.list() of 500 events (only when a report is asked for): ${(((performance.now() - t1) * 1000) / 2_000).toFixed(1)} us`,
);
trace.reset();

// Reading the recorder happens when a report is asked for, never while searching.
for (let i = 0; i < 100; i++) rec.add(FLAG.words, 12, 2, 5, 14 + (i % 17), 1, 6, 1, 2, 4);
const reads = 20_000;
const t0 = performance.now();
for (let i = 0; i < reads; i++) sink += rec.summary()?.kept ?? 0;
console.log(
	`\nsummary() of 100 searches (only when a report is asked for): ${(((performance.now() - t0) * 1000) / reads).toFixed(1)} us`,
);
if (sink === 1) console.log(sink);
