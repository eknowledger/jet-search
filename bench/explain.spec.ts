/**
 * What explaining costs on a vault of real size, next to the search it explains: the same engine, a query
 * of each shape, and the time of the search against the time of explaining it (the search alone, a note that is
 * listed, a note that is not). Explaining runs only when asked, so this is what one press of the key costs.
 *   npm run bench:explain -- <vault dir>
 */
import { performance } from "node:perf_hooks";
import { fieldsFromMarkdown } from "../src/engine/fields";
import { JetEngine } from "../src/engine/jet-engine";
import { parseQuery } from "../src/engine/query";
import { readNotes } from "./notes.spec";

const [dir] = process.argv.slice(2);
if (!dir) throw new Error("usage: npm run bench:explain -- <vault dir>");
const notes = readNotes(dir);
const engine = new JetEngine();
engine.build(notes.map((n) => ({ path: n.path, mtime: n.mtime, ...fieldsFromMarkdown(n.path, n.text) })));
console.log(`${notes.length} notes`);

const now = Date.now();
const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const time = (fn: () => unknown, rounds = 15): number => {
	for (let i = 0; i < 3; i++) fn();
	const out: number[] = [];
	for (let i = 0; i < rounds; i++) {
		const t0 = performance.now();
		fn();
		out.push(performance.now() - t0);
	}
	return med(out);
};

// Words taken from the notes themselves: common, middling and rare ones.
const count = new Map<string, number>();
for (const n of notes.slice(0, 3000))
	for (const w of new Set(n.text.toLowerCase().match(/\p{L}{4,}/gu) ?? [])) count.set(w, (count.get(w) ?? 0) + 1);
const byFreq = [...count.entries()].sort((a, b) => b[1] - a[1]);
const pick = (q: number): string => byFreq[Math.floor(q * (byFreq.length - 1))]?.[0] ?? "note";
const queries = [
	`${pick(0.01)}`,
	`${pick(0.02)} ${pick(0.1)}`,
	`${pick(0.05)} ${pick(0.2)} ${pick(0.4)}`,
	`${pick(0.5)} ${pick(0.6)}`,
];

console.log("query".padEnd(34), "search ms", "explain: search", "a listed note", "a note not listed");
for (const text of queries) {
	const q = parseQuery(text);
	const hits = engine.query(q, { limit: 50, now }).hits;
	const listed = hits[0]?.path ?? notes[0]?.path ?? "";
	const absent = notes.find((n) => !hits.some((h) => h.path === n.path))?.path ?? "";
	const row = [
		time(() => engine.query(q, { limit: 50, now })),
		time(() => engine.explain(q, null, { limit: 50, now })),
		time(() => engine.explain(q, listed, { limit: 50, now })),
		time(() => engine.explain(q, absent, { limit: 50, now })),
	];
	console.log(text.padEnd(34), ...row.map((x) => x.toFixed(2).padStart(9)));
}
