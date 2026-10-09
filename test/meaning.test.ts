import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { docText } from "../src/meaning/doc";
import { embed, MODEL, packModel, unpackModel } from "../src/meaning/model";
import { contentWords, isQuestion } from "../src/meaning/question";
import { Vectors } from "../src/meaning/vectors";

/** A safetensors file holding one F32 table. */
const safetensors = (rows: number[][]): ArrayBuffer => {
	const cols = rows[0]?.length ?? 0;
	const header = JSON.stringify({
		embeddings: { dtype: "F32", shape: [rows.length, cols], data_offsets: [0, rows.length * cols * 4] },
	});
	// safetensors pads its header with spaces so the data starts aligned.
	const h = new TextEncoder().encode(header.padEnd(header.length + ((4 - ((8 + header.length) % 4)) % 4), " "));
	const buf = new ArrayBuffer(8 + h.byteLength + rows.length * cols * 4);
	new DataView(buf).setBigUint64(0, BigInt(h.byteLength), true);
	new Uint8Array(buf, 8, h.byteLength).set(h);
	new Float32Array(buf, 8 + h.byteLength).set(rows.flat());
	return buf;
};
const TOK = JSON.stringify({
	model: { unk_token: "[UNK]", vocab: { "[PAD]": 0, "[UNK]": 1, ship: 2, release: 3, "##s": 4, cake: 5 } },
});
const ROWS = [
	[0, 0, 0],
	[9, 9, 9],
	[1, 0, 0],
	[0.8, 0.6, 0],
	[0, 0, 0.1],
	[0, 0, 1],
];

describe("the meaning model, packed", () => {
	it("packs Hugging Face's files into one int8 table and reads it back", () => {
		const m = unpackModel(packModel(safetensors(ROWS), TOK, 256));
		expect(m.dim).toBe(3);
		expect(m.vocab.get("release")).toBe(3);
		expect(m.unk).toBe(1);
		expect(m.table.length).toBe(18);
		expect((m.table[3 * 3] ?? 0) * (m.scales[3] ?? 0)).toBeCloseTo(0.8, 2);
	});

	it("a text's vector: the mean of its pieces' rows, unit length; unknown pieces left out", () => {
		const m = unpackModel(packModel(safetensors(ROWS), TOK, 256));
		const v = embed(m, "Ship releases!") as Float32Array;
		const want = [1 + 0.8, 0.6, 0.1];
		const n = Math.hypot(...want);
		expect([...v].map((x) => +x.toFixed(2))).toEqual(want.map((x) => +(x / n).toFixed(2)));
		expect(embed(m, "zzz qqq")).toBeNull();
	});

	it("matches the model's own ONNX export on the fixture sentences (when the model is on this machine)", () => {
		const file =
			process.env.JET_MODEL ?? "models/static/minishlab__potion-base-8M/model.safetensors";
		const tok = process.env.JET_TOKENIZER ?? "models/minishlab/potion-base-8M/tokenizer.json";
		if (!existsSync(file) || !existsSync(tok)) return;
		const raw = readFileSync(file);
		const m = unpackModel(
			packModel(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), readFileSync(tok, "utf8")),
		);
		expect(m.bytes / 1e6).toBeLessThan(8.5);
		const fx = JSON.parse(readFileSync(join(__dirname, "fixtures/potion-base-8M.json"), "utf8")) as {
			sentences: string[];
			onnx: number[][];
		};
		fx.onnx.forEach((ref, i) => {
			const v = embed(m, fx.sentences[i] ?? "") as Float32Array;
			const n = Math.hypot(...ref);
			let cos = 0;
			for (let j = 0; j < ref.length; j++) cos += (v[j] ?? 0) * ((ref[j] ?? 0) / n);
			expect(cos).toBeGreaterThan(0.995);
		});
	});

	it("is pinned: revision and both files' checksums", () => {
		expect(MODEL.revision).toMatch(/^[0-9a-f]{40}$/);
		expect(Object.values(MODEL.files).every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true);
	});
});

describe("note vectors", () => {
	const unit = (...x: number[]): Float32Array => {
		const n = Math.hypot(...x);
		return Float32Array.from(x.map((y) => y / n));
	};

	it("nearest first, only allowed notes, kept through renames and deletes, saved and loaded", () => {
		const v = new Vectors("m", 3);
		v.set("a.md", 1, unit(1, 0, 0));
		v.set("b.md", 2, unit(1, 1, 0));
		v.set("c.md", 3, unit(0, 0, 1));
		expect(v.nearest(unit(1, 0.1, 0), 2).map((n) => n.path)).toEqual(["a.md", "b.md"]);
		expect(v.nearest(unit(1, 0.1, 0), 5, (p) => p !== "a.md").map((n) => n.path)).toEqual(["b.md", "c.md"]);
		v.rename("a.md", "z.md");
		v.delete("c.md");
		const back = Vectors.load(v.save());
		expect(back.size).toBe(2);
		expect(back.mtimeOf("z.md")).toBe(1);
		expect(back.nearest(unit(1, 0, 0), 1)[0]?.path).toBe("z.md");
	});
});

describe("questions", () => {
	it("a question word first or a ? at the end, 3 words or more, no quotes or filters", () => {
		expect(isQuestion("how do we ship a release")).toBe(true);
		expect(isQuestion("Why did the build fail on Monday")).toBe(true);
		expect(isQuestion("billing service owner?")).toBe(true);
		expect(isQuestion("billing service")).toBe(false);
		expect(isQuestion("how to")).toBe(false);
		expect(isQuestion('how do "thin frame" work')).toBe(false);
		expect(isQuestion("what changed status:draft recently")).toBe(false);
		expect(isQuestion("who owns #billing now")).toBe(false);
		expect(isQuestion("deployment checklist steps")).toBe(false);
	});

	it("the words an excerpt looks for", () => {
		expect(contentWords("how do we ship a release to production?")).toEqual(["ship", "release", "production"]);
	});
});

describe("a note's text for its vector", () => {
	it("title, aliases, summary, headings, then the body as plain text", () => {
		const text =
			'---\nsummary: "Deploy steps"\n---\n# Steps\nRun `make` then [[Release|ship]] it.\n```sh\nrm -rf /\n```\n';
		const t = docText({
			path: "Ops/Deployment checklist.md",
			mtime: 1,
			text,
			bodyStart: text.indexOf("# Steps"),
			aliases: ["deploy"],
			headings: [{ level: 1, text: "Steps" }],
			tags: [],
			links: [],
			inLinks: 0,
		});
		expect(t.split("\n").slice(0, 4)).toEqual(["Deployment checklist", "deploy", "Deploy steps", "Steps"]);
		expect(t).toContain("ship it");
		expect(t).not.toContain("rm -rf");
	});
});
