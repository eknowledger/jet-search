/**
 * Search by meaning's cost: the memory the packed model and the note vectors hold,
 * the time to embed a note, and the nearest scan at 1,500 and 15,000 notes. Needs the model's two files
 * (JET_MODEL, JET_TOKENIZER). Synthetic notes: no vault is read.
 *   esbuild bench/meaning-memory.ts --bundle --platform=node --format=esm --outfile=meaning-memory.mjs && node --expose-gc meaning-memory.mjs
 */
import { readFileSync } from "node:fs";
import { embed, packModel, unpackModel } from "../src/meaning/model";
import { Vectors } from "../src/meaning/vectors";

const gc = (): void => (globalThis as { gc?: () => void }).gc?.();
const heap = (): number => {
	gc();
	gc();
	return process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers;
};
const mb = (b: number): string => `${(b / 1e6).toFixed(1)} MB`;

const st = readFileSync(
	process.env.JET_MODEL ?? "models/static/minishlab__potion-base-8M/model.safetensors",
);
const tok = readFileSync(
	process.env.JET_TOKENIZER ?? "models/minishlab/potion-base-8M/tokenizer.json",
	"utf8",
);
const packed = packModel(st.buffer.slice(st.byteOffset, st.byteOffset + st.byteLength), tok);
const words =
	"release deploy meeting pricing design review sprint budget roadmap customer latency database cache worker index note project area team plan risk".split(
		" ",
	);
const text = (i: number): string =>
	Array.from({ length: 300 }, (_, j) => words[(i * 7 + j * 13) % words.length]).join(" ");

const h0 = heap();
const model = unpackModel(packed.slice(0));
const h1 = heap();
console.log(
	`model in memory: ${mb(h1 - h0)} (file ${mb(packed.byteLength)}, ${model.vocab.size} pieces × ${model.dim})`,
);
for (const n of [1500, 15000]) {
	const v = new Vectors(model.id, model.dim);
	const t0 = performance.now();
	for (let i = 0; i < n; i++) v.set(`n${i}.md`, i, embed(model, text(i)));
	const per = (performance.now() - t0) / n;
	const h2 = heap();
	const q = embed(model, "how did we decide about pricing") as Float32Array;
	const times: number[] = [];
	for (let k = 0; k < 30; k++) {
		const s = performance.now();
		v.nearest(q, 50);
		times.push(performance.now() - s);
	}
	times.sort((a, b) => a - b);
	console.log(
		`${n.toLocaleString()} notes: vectors ${mb(h2 - h1)}, embed ${per.toFixed(2)} ms/note (one thread), nearest p50 ${times[15]?.toFixed(2)} ms, p95 ${times[28]?.toFixed(2)} ms`,
	);
}
