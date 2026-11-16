// Writes a vault of N notes made only from the demo vault's own text, recombined with a fixed seed
// (the same recipe as the public engine benchmark). usage: node gen-vault.mjs <demo-vault> <N> <out-dir>
import { mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const [demo, nArg, out] = process.argv.slice(2);
const n = Number(nArg);
const rng = (seed) => () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const walk = (d) =>
	readdirSync(d, { withFileTypes: true }).flatMap((e) =>
		e.name.startsWith(".")
			? []
			: e.isDirectory()
				? walk(join(d, e.name))
				: e.name.endsWith(".md")
					? [join(d, e.name)]
					: [],
	);
const seed = walk(demo).map((p) => ({ path: relative(demo, p), text: readFileSync(p, "utf8") }));
const pool = [];
const titles = [];
for (const s of seed) {
	titles.push(s.path.replace(/^.*\//, "").replace(/\.md$/, ""));
	for (const line of s.text.split("\n")) if (line.trim().length > 25 && !line.startsWith("---")) pool.push(line);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, ".obsidian"), { recursive: true });
const r = rng(n * 7919 + 1);
const now = Date.now();
let bytes = 0;
for (let i = 0; i < n; i++) {
	const src = seed[Math.floor(r() * seed.length)];
	const lines = Math.max(6, Math.round((src.text.split("\n").length * (0.6 + r() * 0.8)) | 0));
	const body = [];
	for (let k = 0; k < lines; k++) body.push(pool[Math.floor(r() * pool.length)]);
	const folder = src.path.split("/").slice(0, -1).join("/");
	const title = `${titles[Math.floor(r() * titles.length)]} ${i}`;
	const mtime = (now - Math.floor(r() * 3e10)) / 1000;
	const p = join(out, folder, `${title}.md`);
	mkdirSync(dirname(p), { recursive: true });
	const text = `---\ntags: [t${i % 50}]\n---\n# ${title}\n\n${body.join("\n")}\n`;
	writeFileSync(p, text);
	utimesSync(p, mtime, mtime);
	bytes += text.length;
}
console.log(`${n} notes, ${(bytes / 1048576).toFixed(1)} MB of text -> ${out}`);
