/**
 * The meaning model as Jet keeps it: potion-base-8M (Model2Vec, MIT), a table of one 256-number
 * vector per word piece. Downloaded as Hugging Face's files (safetensors, tokenizer.json), checked, then
 * packed into one file of Jet's: the vocabulary, one scale per row and the table in int8 (7.9 MB instead
 * of 30 MB). A text's vector is the mean of its pieces' rows, normalized; no network, no WASM.
 */
import { tokenize } from "./tokenizer";

/** The model, pinned: a revision and the checksums of its two files. */
export const MODEL = {
	id: "potion-base-8M",
	repo: "minishlab/potion-base-8M",
	revision: "bf8b056651a2c21b8d2565580b8569da283cab23",
	licence: "MIT",
	files: {
		"model.safetensors": "f65d0f325faadc1e121c319e2faa41170d3fa07d8c89abd48ca5358d9a223de2",
		"tokenizer.json": "e67e803f624fb4d67dea1c730d06e1067e1b14d830e2c2202569e3ef0f70bb50",
	},
	/** About what the two files weigh (the confirm says so before downloading). */
	downloadMB: 31,
	dims: 256,
	/** Tokens a note's vector reads at most (Model2Vec's default). */
	maxTokens: 512,
} as const;

export type MeaningModel = {
	id: string;
	dim: number;
	vocab: Map<string, number>;
	unk: number;
	/** One scale per row: row value = int8 × scale. */
	scales: Float32Array;
	table: Int8Array;
	/** The packed file's size. */
	bytes: number;
};

const MAGIC = 0x4d54454a; // "JETM"
const VERSION = 1;

/** The [rows × dims] float table in a safetensors file (F32 or F16), its first `dims` columns. */
const readTable = (
	buf: ArrayBuffer,
	dims: number,
): { rows: number; dim: number; get: (r: number, j: number) => number } => {
	const view = new DataView(buf);
	const n = Number(view.getBigUint64(0, true));
	const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, n))) as Record<
		string,
		{ dtype: string; shape: [number, number]; data_offsets: [number, number] }
	>;
	const entry = Object.entries(header).find(([k]) => k !== "__metadata__");
	if (!entry) throw new Error("no table in the model file");
	const meta = entry[1];
	const [rows, cols] = meta.shape;
	const at = 8 + n + meta.data_offsets[0];
	const dim = Math.min(cols, dims);
	if (meta.dtype === "F32") {
		const f = new Float32Array(buf.slice(at, 8 + n + meta.data_offsets[1]));
		return { rows, dim, get: (r, j) => f[r * cols + j] ?? 0 };
	}
	if (meta.dtype === "F16") {
		const h = new Uint16Array(buf.slice(at, 8 + n + meta.data_offsets[1]));
		const half = (x: number): number => {
			const s = x >> 15 ? -1 : 1;
			const e = (x >> 10) & 31;
			const m = x & 1023;
			return e === 0 ? s * (m / 1024) * 2 ** -14 : e === 31 ? s * Infinity : s * (1 + m / 1024) * 2 ** (e - 15);
		};
		return { rows, dim, get: (r, j) => half(h[r * cols + j] ?? 0) };
	}
	throw new Error(`model table in ${meta.dtype}: not supported`);
};

/** Hugging Face's two files → Jet's packed model (vocabulary, row scales, int8 table). */
export const packModel = (safetensors: ArrayBuffer, tokenizerJson: string, dims: number = MODEL.dims): ArrayBuffer => {
	const tok = JSON.parse(tokenizerJson) as { model: { vocab: Record<string, number>; unk_token?: string } };
	const t = readTable(safetensors, dims);
	const tokens: string[] = Array.from({ length: t.rows }, () => "");
	for (const [piece, id] of Object.entries(tok.model.vocab)) if (id < t.rows) tokens[id] = piece;
	const unk = tok.model.vocab[tok.model.unk_token ?? "[UNK]"] ?? 1;
	const text = new TextEncoder().encode(tokens.join("\n"));
	const pad = (4 - ((24 + text.byteLength) % 4)) % 4;
	const head = 24 + text.byteLength + pad;
	const out = new ArrayBuffer(head + t.rows * 4 + t.rows * t.dim);
	const v = new DataView(out);
	v.setUint32(0, MAGIC, true);
	v.setUint32(4, VERSION, true);
	v.setUint32(8, t.dim, true);
	v.setUint32(12, t.rows, true);
	v.setUint32(16, unk, true);
	v.setUint32(20, text.byteLength, true);
	new Uint8Array(out, 24, text.byteLength).set(text);
	const scales = new Float32Array(out, head, t.rows);
	const table = new Int8Array(out, head + t.rows * 4, t.rows * t.dim);
	for (let r = 0; r < t.rows; r++) {
		let mx = 0;
		for (let j = 0; j < t.dim; j++) mx = Math.max(mx, Math.abs(t.get(r, j)));
		const s = mx / 127 || 1;
		scales[r] = s;
		for (let j = 0; j < t.dim; j++) table[r * t.dim + j] = Math.round(t.get(r, j) / s);
	}
	return out;
};

export const unpackModel = (buf: ArrayBuffer, id: string = MODEL.id): MeaningModel => {
	if (buf.byteLength < 24) throw new Error("not a Jet meaning model (the file is too short)");
	const v = new DataView(buf);
	if (v.getUint32(0, true) !== MAGIC || v.getUint32(4, true) !== VERSION) throw new Error("not a Jet meaning model");
	const dim = v.getUint32(8, true);
	const rows = v.getUint32(12, true);
	const unk = v.getUint32(16, true);
	const len = v.getUint32(20, true);
	// A truncated file (a partial write, a sync placeholder) is said so, not a raw RangeError.
	const need = 24 + len + ((4 - ((24 + len) % 4)) % 4) + rows * 4 + rows * dim;
	if (buf.byteLength < need || dim === 0 || unk >= rows) throw new Error("the Jet meaning model file is incomplete");
	const pieces = new TextDecoder().decode(new Uint8Array(buf, 24, len)).split("\n");
	const vocab = new Map<string, number>();
	pieces.forEach((p, i) => {
		if (p) vocab.set(p, i);
	});
	const head = 24 + len + ((4 - ((24 + len) % 4)) % 4);
	return {
		id,
		dim,
		vocab,
		unk,
		scales: new Float32Array(buf, head, rows),
		table: new Int8Array(buf, head + rows * 4, rows * dim),
		bytes: buf.byteLength,
	};
};

/** A text's vector (unit length), or null when no known piece is in it. Unknown pieces are left out. */
export const embed = (m: MeaningModel, text: string, maxTokens: number = MODEL.maxTokens): Float32Array | null => {
	const ids = tokenize(text, m.vocab, m.unk, maxTokens);
	const v = new Float32Array(m.dim);
	let k = 0;
	for (const id of ids) {
		if (id === m.unk) continue;
		const s = m.scales[id] ?? 0;
		const o = id * m.dim;
		for (let j = 0; j < m.dim; j++) v[j] = (v[j] ?? 0) + (m.table[o + j] ?? 0) * s;
		k++;
	}
	if (!k) return null;
	let n = 0;
	for (let j = 0; j < m.dim; j++) n += (v[j] ?? 0) ** 2;
	n = Math.sqrt(n) || 1;
	for (let j = 0; j < m.dim; j++) v[j] = (v[j] ?? 0) / n;
	return v;
};
