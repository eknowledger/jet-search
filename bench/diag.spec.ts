/**
 * What the support info's pieces cost, per call, on this machine: the counters written at rare events, the
 * recorded problem, and what a recorder would add if it sat in a loop (a clock read, a typed-array write, a
 * boolean test). A baseline loop is measured first and subtracted, so the figures are the added work.
 *   npm run bench:diag
 */
import { performance } from "node:perf_hooks";
import { diag } from "../src/diag/diag";

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
if (sink === 1) console.log(sink);
