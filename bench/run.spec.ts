/**
 * Public benchmark draft: Jet's engine on vaults made only from public data (the demo vault's notes, recombined
 * with a fixed seed). Per vault size: build, saved index size, cold load, heap, per-keystroke query time
 * (every prefix of a typed query), and the cost of one edit. Optional baseline: SQLite FTS5 through the same adapter.
 *   npm run bench:engine -- demo-vault [sizes=1000,10000,50000] [--fts5]
 */
import { performance } from "node:perf_hooks";
import type { BenchEngine, BenchNote } from "./engine";
import { jetEngine } from "./jet-engine";
import { fts5Engine, initFts5 } from "./fts5-engine.spec";
import { readNotes } from "./notes.spec";
import { NameIndex } from "../src/tier0/names";

const [dir, sizesArg, ...flags] = process.argv.slice(2);
if (!dir) throw new Error("usage: npm run bench:engine -- <demo-vault-dir> [sizes] [--fts5]");
const sizes = (sizesArg && !sizesArg.startsWith("--") ? sizesArg : "1000,10000,50000").split(",").map(Number);
const withFts5 = flags.includes("--fts5") || sizesArg === "--fts5";

const gc = (): void => (globalThis as { gc?: () => void }).gc?.();
const heapMB = (): number => {
	gc();
	gc();
	const m = process.memoryUsage();
	return (m.heapUsed + m.arrayBuffers) / 1048576;
};
const rng = (seed: number) => () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pct = (xs: number[], p: number): number => {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};

// ---- corpus: lines of the demo notes, recombined
const seed = readNotes(dir);
const pool: string[] = [];
const titles: string[] = [];
for (const n of seed) {
	titles.push(n.path.replace(/^.*\//, "").replace(/\.md$/, ""));
	for (const line of n.text.split("\n")) if (line.trim().length > 25 && !line.startsWith("---")) pool.push(line);
}
const avgSeed = seed.reduce((a, n) => a + n.text.length, 0) / seed.length;

const makeVault = (n: number): BenchNote[] => {
	const r = rng(n * 7919 + 1);
	const out: BenchNote[] = [];
	const now = Date.now();
	for (let i = 0; i < n; i++) {
		const src = seed[Math.floor(r() * seed.length)]!;
		const lines = Math.max(6, Math.round((src.text.split("\n").length * (0.6 + r() * 0.8)) | 0));
		const body: string[] = [];
		for (let k = 0; k < lines; k++) body.push(pool[Math.floor(r() * pool.length)]!);
		const folder = src.path.split("/").slice(0, -1).join("/");
		const title = `${titles[Math.floor(r() * titles.length)]} ${i}`;
		out.push({
			path: `${folder ? folder + "/" : ""}${title}.md`,
			mtime: now - Math.floor(r() * 3e10),
			text: `---\ntags: [t${i % 50}]\n---\n# ${title}\n\n${body.join("\n")}\n`,
		});
	}
	return out;
};

// ---- queries: words typed one letter at a time, one or two words, some with a typo
const vocab = (() => {
	const df = new Map<string, number>();
	for (const l of pool)
		for (const w of new Set(l.toLowerCase().match(/[a-z]{4,12}/g) ?? [])) df.set(w, (df.get(w) ?? 0) + 1);
	return [...df.entries()]
		.filter(([, c]) => c >= 3)
		.sort((a, b) => b[1] - a[1])
		.map(([w]) => w);
})();
const typedQueries = (count: number, seedN: number): string[] => {
	const r = rng(seedN);
	const out: string[] = [];
	for (let i = 0; i < count; i++) {
		let w1 = vocab[Math.floor(r() * Math.min(vocab.length, 3000))]!;
		if (r() < 0.25) w1 = w1.slice(0, 2) + w1.slice(3); // a dropped letter
		const full = r() < 0.4 ? `${w1} ${vocab[Math.floor(r() * Math.min(vocab.length, 3000))]!}` : w1;
		for (let k = 2; k <= full.length; k++) out.push(full.slice(0, k)); // each keystroke
	}
	return out;
};

type Row = Record<string, string | number>;
const rows: Row[] = [];

const run = async (name: string, make: () => BenchEngine, notes: BenchNote[]): Promise<void> => {
	const e = make();
	const textMB = notes.reduce((a, n) => a + n.text.length, 0) / 1048576;
	const h0 = heapMB();
	const t0 = performance.now();
	e.build(notes);
	const buildMs = performance.now() - t0;
	const saved = e.save();
	const e2 = make();
	const h1 = heapMB();
	const t1 = performance.now();
	e2.load(saved);
	const loadMs = performance.now() - t1;
	const heap = heapMB() - h1;
	const qs = typedQueries(150, 99);
	for (const q of qs.slice(0, 300)) e2.query(q); // warm
	const times: number[] = [];
	for (const q of qs) {
		const t = performance.now();
		e2.query(q);
		times.push(performance.now() - t);
	}
	const ed = notes[Math.floor(notes.length / 2)]!;
	const te = performance.now();
	for (let i = 0; i < 20; i++) e2.update({ ...ed, text: ed.text + `\nedit ${i} gardening`, mtime: Date.now() });
	const editMs = (performance.now() - te) / 20;
	void h0;
	rows.push({
		engine: name,
		notes: notes.length,
		textMB: +textMB.toFixed(1),
		buildS: +(buildMs / 1000).toFixed(2),
		notesPerS: Math.round(notes.length / (buildMs / 1000)),
		indexMB: +(saved.byteLength / 1048576).toFixed(1),
		loadMs: +loadMs.toFixed(1),
		heapMB: +heap.toFixed(1),
		keys: times.length,
		p50ms: +pct(times, 50).toFixed(3),
		p95ms: +pct(times, 95).toFixed(3),
		p99ms: +pct(times, 99).toFixed(3),
		maxMs: +Math.max(...times).toFixed(2),
		editMs: +editMs.toFixed(2),
	});
};

const namesBench = (notes: BenchNote[]): Row => {
	const idx = new NameIndex();
	notes.forEach((n, i) =>
		idx.upsert({ id: i, name: n.path.replace(/^.*\//, "").replace(/\.md$/, ""), aliases: [], path: n.path }),
	);
	const qs = typedQueries(150, 5);
	for (const q of qs.slice(0, 200)) idx.match(q, { limit: 50 });
	const times: number[] = [];
	for (const q of qs) {
		const t = performance.now();
		idx.match(q, { limit: 50 });
		times.push(performance.now() - t);
	}
	return {
		engine: "names (tier 0)",
		notes: notes.length,
		keys: times.length,
		p50ms: +pct(times, 50).toFixed(3),
		p95ms: +pct(times, 95).toFixed(3),
		p99ms: +pct(times, 99).toFixed(3),
		maxMs: +Math.max(...times).toFixed(2),
	};
};

console.log(
	`node ${process.version}; demo notes ${seed.length}, avg ${Math.round(avgSeed)} B; pool ${pool.length} lines; vocab ${vocab.length}`,
);
if (withFts5) await initFts5();
for (const n of sizes) {
	const notes = makeVault(n);
	await run("jet", () => jetEngine(), notes);
	rows.push(namesBench(notes));
	if (withFts5 && n <= 10000) await run("sqlite fts5", () => fts5Engine({ detail: "column" }), notes);
	console.log(JSON.stringify(rows.filter((r) => r.notes === n)));
}
console.table(rows);
