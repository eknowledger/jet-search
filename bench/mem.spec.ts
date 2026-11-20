/**
 * Memory of a loaded index, measured the way a user feels it: a fresh process loads a saved index
 * and we read the resident-set growth (what the OS actually gave the process), not just the JS heap.
 *   npm run bench:mem -- save demo-vault <n> <file>
 *   npm run bench:mem -- load <file>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { jetEngine } from "./jet-engine";
import { readNotes } from "./notes.spec";
import type { BenchNote } from "./engine";

const gc = (): void => (globalThis as { gc?: () => void }).gc?.();
const rng = (seed: number) => () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const mb = (b: number): number => +(b / 1048576).toFixed(1);
const [mode, a, b, c] = process.argv.slice(2);

if (mode === "save") {
	const seed = readNotes(a!);
	const n = Number(b);
	const pool: string[] = [];
	const titles = seed.map((s) => s.path.replace(/^.*\//, "").replace(/\.md$/, ""));
	for (const s of seed)
		for (const line of s.text.split("\n")) if (line.trim().length > 25 && !line.startsWith("---")) pool.push(line);
	const r = rng(n * 7919 + 1);
	const notes: BenchNote[] = [];
	for (let i = 0; i < n; i++) {
		const src = seed[Math.floor(r() * seed.length)]!;
		const lines = Math.max(6, Math.round((src.text.split("\n").length * (0.6 + r() * 0.8)) | 0));
		const body: string[] = [];
		for (let k = 0; k < lines; k++) body.push(pool[Math.floor(r() * pool.length)]!);
		const title = `${titles[Math.floor(r() * titles.length)]} ${i}`;
		notes.push({
			path: `${title}.md`,
			mtime: Date.now() - Math.floor(r() * 3e10),
			text: `---\ntags: [t${i % 50}]\n---\n# ${title}\n\n${body.join("\n")}\n`,
		});
	}
	const e = jetEngine();
	e.build(notes);
	const saved = e.save();
	writeFileSync(c!, saved);
	const textMB = notes.reduce((x, y) => x + y.text.length, 0) / 1048576;
	console.log(JSON.stringify({ notes: n, textMB: mb(textMB * 1048576), indexFileMB: mb(saved.byteLength) }));
} else {
	const file = readFileSync(a!);
	const e = jetEngine();
	gc();
	gc();
	const m0 = process.memoryUsage();
	e.load(new Uint8Array(file.buffer, file.byteOffset, file.byteLength));
	for (const q of ["ki", "kit", "kitchen", "garden plan", "tomato soup", "ladybird larva"]) e.query(q);
	gc();
	gc();
	const m1 = process.memoryUsage();
	console.log(
		JSON.stringify({
			file: a,
			fileMB: mb(file.byteLength),
			rssGrowthMB: mb(m1.rss - m0.rss),
			heapGrowthMB: mb(m1.heapUsed - m0.heapUsed),
			arrayBuffersGrowthMB: mb(m1.arrayBuffers - m0.arrayBuffers),
		}),
	);
}
