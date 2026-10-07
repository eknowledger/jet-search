import { FIELDS, type NoteInput, WEIGHTS } from "./fields";
import { ByteWriter, readVarint } from "./varint";

/**
 * Index v4: one ArrayBuffer of sections, each read through a typed-array view at
 * an 8-byte-aligned offset recorded in the header. Loading creates views; postings are not parsed.
 *
 *   terms     sorted, one string (UTF-8 on disk) + code-unit offsets; df per term
 *   body      per term: (doc-id gap, count) as varints
 *   meta      per term, sparse: (doc id, precomputed field score) for name, aliases, headings, tags,
 *             folder and links (Jade's trick: the per-field BM25 is done at build time)
 *   docs      path, normalized name, modified time, body length, inbound links
 *   averages  field lengths, so a delta segment scores with its base's statistics
 */

export const K1 = 1.2;
/** Length normalization: body (BM25's usual 0.75) and the short fields (0.5). */
export const B_BODY = 0.75;
export const B_META = 0.5;
const MAGIC = 0x3454454a; // "JET4"
const VERSION = 1;
const HEADER_WORDS = 32;

/** BM25 saturation of a count `tf` in a field `len` long, where the average is `avg`. */
export const sat = (tf: number, len: number, avg: number, b: number): number =>
	(tf * (K1 + 1)) / (tf + K1 * (1 - b + (b * len) / Math.max(1, avg)));

/** Average lengths: one per meta field, then the body's. */
export type Averages = Float32Array;

export const averagesOf = (notes: readonly NoteInput[]): Averages => {
	const avg = new Float32Array(FIELDS.length + 1);
	if (!notes.length) return avg.fill(1);
	for (const n of notes) {
		FIELDS.forEach((f, i) => (avg[i] = (avg[i] as number) + n.fields[f].length));
		avg[FIELDS.length] = (avg[FIELDS.length] as number) + n.fields.body.length;
	}
	for (let i = 0; i < avg.length; i++) avg[i] = Math.max(1, (avg[i] as number) / notes.length);
	return avg;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Strings packed as one: code-unit offsets (n + 1) and the UTF-8 bytes of the whole. */
const pack = (strings: readonly string[]): { offsets: Uint32Array; bytes: Uint8Array } => {
	const offsets = new Uint32Array(strings.length + 1);
	let at = 0;
	strings.forEach((s, i) => {
		offsets[i] = at;
		at += s.length;
	});
	offsets[strings.length] = at;
	return { offsets, bytes: encoder.encode(strings.join("")) };
};

type TermBuild = { docs: number[]; tf: number[]; metaDocs: number[]; meta: number[]; df: number };

/**
 * Build a segment from notes. `averages`: the statistics to score field lengths against (a delta
 * segment passes its base's, so scores stay comparable); by default, this segment's own.
 */
export const buildSegment = (
	notes: readonly NoteInput[],
	inbound: (name: string) => number,
	averages: Averages = averagesOf(notes),
): ArrayBuffer => {
	const table = new Map<string, TermBuild>();
	const entry = (t: string): TermBuild => {
		let e = table.get(t);
		if (!e) table.set(t, (e = { docs: [], tf: [], metaDocs: [], meta: [], df: 0 }));
		return e;
	};
	notes.forEach((n, d) => {
		const meta = new Map<string, number>();
		FIELDS.forEach((f, i) => {
			const list = n.fields[f];
			if (!list.length) return;
			const counts = new Map<string, number>();
			for (const t of list) counts.set(t, (counts.get(t) ?? 0) + 1);
			for (const [t, c] of counts)
				meta.set(t, (meta.get(t) ?? 0) + WEIGHTS[f] * sat(c, list.length, averages[i] as number, B_META));
		});
		const body = new Map<string, number>();
		for (const t of n.fields.body) body.set(t, (body.get(t) ?? 0) + 1);
		for (const [t, c] of body) {
			const e = entry(t);
			e.docs.push(d);
			e.tf.push(c);
		}
		for (const [t, s] of meta) {
			const e = entry(t);
			e.metaDocs.push(d);
			e.meta.push(s);
		}
		for (const t of new Set([...body.keys(), ...meta.keys()])) entry(t).df++;
	});
	const terms = [...table.keys()].sort();
	const T = terms.length;
	const D = notes.length;
	const termPack = pack(terms);
	const df = new Uint32Array(T);
	const bodyOff = new Uint32Array(T + 1);
	const metaOff = new Uint32Array(T + 1);
	const w = new ByteWriter();
	let metaCount = 0;
	for (const t of terms) metaCount += (table.get(t) as TermBuild).metaDocs.length;
	const metaDocs = new Uint32Array(metaCount);
	const metaScore = new Float32Array(metaCount);
	let m = 0;
	terms.forEach((t, i) => {
		const e = table.get(t) as TermBuild;
		df[i] = e.df;
		bodyOff[i] = w.length;
		let prev = -1;
		for (let k = 0; k < e.docs.length; k++) {
			const doc = e.docs[k] as number;
			w.varint(doc - prev - 1);
			w.varint(e.tf[k] as number);
			prev = doc;
		}
		metaOff[i] = m;
		for (let k = 0; k < e.metaDocs.length; k++) {
			metaDocs[m] = e.metaDocs[k] as number;
			metaScore[m++] = e.meta[k] as number;
		}
	});
	bodyOff[T] = w.length;
	metaOff[T] = m;
	const body = w.bytes();
	const paths = pack(notes.map((n) => n.path));
	const names = pack(notes.map((n) => n.fields.name.join(" ")));
	const mtime = Float64Array.from(notes.map((n) => n.mtime));
	const bodyLen = Uint32Array.from(notes.map((n) => n.fields.body.length));
	const inLinks = Uint32Array.from(notes.map((n) => inbound(nameOf(n.path))));
	const sections: ArrayBufferView[] = [
		termPack.offsets,
		termPack.bytes,
		df,
		bodyOff,
		body,
		metaOff,
		metaDocs,
		metaScore,
		mtime,
		bodyLen,
		inLinks,
		paths.offsets,
		paths.bytes,
		names.offsets,
		names.bytes,
		averages,
	];
	let size = HEADER_WORDS * 4;
	const offsets: number[] = [];
	for (const s of sections) {
		size = (size + 7) & ~7;
		offsets.push(size);
		size += s.byteLength;
	}
	const buf = new ArrayBuffer((size + 7) & ~7);
	const head = new Uint32Array(buf, 0, HEADER_WORDS);
	head.set([
		MAGIC,
		VERSION,
		D,
		T,
		metaCount,
		body.byteLength,
		termPack.bytes.byteLength,
		paths.bytes.byteLength,
		names.bytes.byteLength,
	]);
	offsets.forEach((o, i) => (head[9 + i] = o));
	const bytes = new Uint8Array(buf);
	sections.forEach((s, i) => bytes.set(new Uint8Array(s.buffer, s.byteOffset, s.byteLength), offsets[i]));
	return buf;
};

const nameOf = (path: string): string => (path.split("/").pop() ?? path).replace(/\.md$/i, "").toLowerCase();

/** A segment read from its buffer: typed-array views, with strings decoded on first use. */
export class Segment {
	readonly docCount: number;
	readonly termCount: number;
	readonly df: Uint32Array;
	readonly bodyOff: Uint32Array;
	readonly body: Uint8Array;
	readonly metaOff: Uint32Array;
	readonly metaDocs: Uint32Array;
	readonly metaScore: Float32Array;
	readonly mtime: Float64Array;
	readonly bodyLen: Uint32Array;
	readonly inLinks: Uint32Array;
	readonly averages: Float32Array;
	private readonly termOffsets: Uint32Array;
	private readonly termBytes: Uint8Array;
	private readonly pathOffsets: Uint32Array;
	private readonly pathBytes: Uint8Array;
	private readonly nameOffsets: Uint32Array;
	private readonly nameBytes: Uint8Array;
	private termList: string[] | null = null;
	private pathList: string[] | null = null;
	private nameList: string[] | null = null;

	constructor(readonly buffer: ArrayBuffer) {
		const head = new Uint32Array(buffer, 0, HEADER_WORDS);
		if (head[0] !== MAGIC || head[1] !== VERSION) throw new Error("not a Jet index (or another version)");
		const [D, T, M, bodyBytes, termBytes, pathBytes, nameBytes] = [
			head[2],
			head[3],
			head[4],
			head[5],
			head[6],
			head[7],
			head[8],
		] as number[];
		const o = (i: number): number => head[9 + i] as number;
		this.docCount = D as number;
		this.termCount = T as number;
		this.termOffsets = new Uint32Array(buffer, o(0), (T as number) + 1);
		this.termBytes = new Uint8Array(buffer, o(1), termBytes);
		this.df = new Uint32Array(buffer, o(2), T);
		this.bodyOff = new Uint32Array(buffer, o(3), (T as number) + 1);
		this.body = new Uint8Array(buffer, o(4), bodyBytes);
		this.metaOff = new Uint32Array(buffer, o(5), (T as number) + 1);
		this.metaDocs = new Uint32Array(buffer, o(6), M);
		this.metaScore = new Float32Array(buffer, o(7), M);
		this.mtime = new Float64Array(buffer, o(8), D);
		this.bodyLen = new Uint32Array(buffer, o(9), D);
		this.inLinks = new Uint32Array(buffer, o(10), D);
		this.pathOffsets = new Uint32Array(buffer, o(11), (D as number) + 1);
		this.pathBytes = new Uint8Array(buffer, o(12), pathBytes);
		this.nameOffsets = new Uint32Array(buffer, o(13), (D as number) + 1);
		this.nameBytes = new Uint8Array(buffer, o(14), nameBytes);
		this.averages = new Float32Array(buffer, o(15), FIELDS.length + 1);
	}

	/** The sorted terms (decoded once). */
	get terms(): string[] {
		return (this.termList ??= unpack(this.termBytes, this.termOffsets));
	}

	get paths(): string[] {
		return (this.pathList ??= unpack(this.pathBytes, this.pathOffsets));
	}

	/** Each note's name as its terms joined by spaces, for title boosts. */
	get names(): string[] {
		return (this.nameList ??= unpack(this.nameBytes, this.nameOffsets));
	}

	/** Call `fn(doc, tf)` for each body posting of term `t`. */
	forBody(t: number, fn: (doc: number, tf: number) => void): void {
		const end = this.bodyOff[t + 1] as number;
		const at = { pos: this.bodyOff[t] as number };
		let doc = -1;
		while (at.pos < end) {
			doc += readVarint(this.body, at) + 1;
			fn(doc, readVarint(this.body, at));
		}
	}
}

const unpack = (bytes: Uint8Array, offsets: Uint32Array): string[] => {
	const all = decoder.decode(bytes);
	const out: string[] = [];
	for (let i = 0; i + 1 < offsets.length; i++) out.push(all.slice(offsets[i], offsets[i + 1]));
	return out;
};
