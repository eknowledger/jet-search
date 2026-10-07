import { FIELDS, type NoteFields, normalize, type Query, tokens, WEIGHTS, withinOneEdit } from "./text";

/** One note in the index; `lens` are its fields' lengths in words, in FIELDS order. */
type Doc = { path: string; mtime: number; alive: boolean; lens: number[] };

/**
 * A term's postings: note ids; for each, the short fields' score (name, folder,
 * headings, tags: Σ weight × saturated frequency, known at index time) and the
 * body's frequency normalized by its length (saturated at query time).
 */
type Postings = { docs: Nums; meta: Nums; body: Nums };
/**
 * Typed arrays when loaded or compacted (4 bytes a number, views on one
 * buffer); a term that gains a note is thawed into plain arrays.
 */
type Nums = number[] | Int32Array | Float32Array;

const thaw = (p: Postings): Postings & { docs: number[]; meta: number[]; body: number[] } => {
	if (!Array.isArray(p.docs)) p.docs = Array.from(p.docs);
	if (!Array.isArray(p.meta)) p.meta = Array.from(p.meta);
	if (!Array.isArray(p.body)) p.body = Array.from(p.body);
	return p as Postings & { docs: number[]; meta: number[]; body: number[] };
};

export type Hit = { path: string; score: number; terms: string[] };

const K1 = 1.2;
const B = 0.75;
/** How much a prefix or a one-letter-off match counts against an exact one (MiniSearch's, as Omnisearch). */
const PREFIX = 0.375;
const FUZZY = 0.45;
const FORMAT = 3;

/** BM25's saturation of a term frequency, for a field `len` long where the average is `avg`. */
const sat = (tf: number, len = 1, avg = 1): number =>
	(tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * len) / Math.max(1, avg)));

/**
 * The search index, ported unchanged from Jade as the baseline Jet evolves from:
 * term → postings, two floats per term per
 * note. Each field is saturated on its own and then weighted, as Omnisearch's
 * engine does (a name match outweighs many mentions in the body); the body's
 * frequency is normalized by its length. Exact, prefix and
 * one-edit matches; every term must match (any term, if none match all); a
 * recency boost. Removing a note leaves a tombstone, compacted once a quarter
 * of the notes are dead. Pure: it runs in a worker and in tests.
 */
export class SearchIndex {
	private docs: Doc[] = [];
	private byPath = new Map<string, number>();
	private terms = new Map<string, Postings>();
	private dead = 0;
	/** Each field's total length over the live notes, for the averages. */
	private totals: number[] = FIELDS.map(() => 0);
	/** Terms sorted, for prefix lookups; rebuilt on the next query after new terms. */
	private sorted: string[] | null = null;
	/** Terms by length, for one-edit lookups. */
	private byLength: Map<number, string[]> | null = null;

	get size(): number {
		return this.docs.length - this.dead;
	}

	get termCount(): number {
		return this.terms.size;
	}

	mtimeOf(path: string): number | undefined {
		const id = this.byPath.get(path);
		return id === undefined ? undefined : this.docs[id]?.mtime;
	}

	paths(): string[] {
		return [...this.byPath.keys()];
	}

	/** Add a note, or replace it. */
	upsert(path: string, mtime: number, fields: NoteFields): void {
		this.remove(path);
		const id = this.docs.length;
		const lens = FIELDS.map((f) => fields[f].length);
		this.docs.push({ path, mtime, alive: true, lens });
		this.byPath.set(path, id);
		lens.forEach((l, i) => (this.totals[i] = (this.totals[i] ?? 0) + l));
		const n = Math.max(1, this.size);
		const avg = (i: number): number => (this.totals[i] ?? 0) / n;
		const bodyAt = FIELDS.indexOf("body");
		const norm = 1 / (1 - B + (B * (lens[bodyAt] ?? 0)) / Math.max(1, avg(bodyAt)));
		const meta = new Map<string, number>();
		const body = new Map<string, number>();
		FIELDS.forEach((f, i) => {
			if (f === "body") {
				for (const t of fields.body) body.set(t, (body.get(t) ?? 0) + 1);
				return;
			}
			// Each short field saturated against its own length: a title that is just the word wins.
			const counts = new Map<string, number>();
			for (const t of fields[f]) counts.set(t, (counts.get(t) ?? 0) + 1);
			for (const [t, c] of counts) meta.set(t, (meta.get(t) ?? 0) + WEIGHTS[f] * sat(c, lens[i], avg(i)));
		});
		for (const t of new Set([...meta.keys(), ...body.keys()])) {
			let found = this.terms.get(t);
			if (!found) {
				found = { docs: [], meta: [], body: [] };
				this.terms.set(t, found);
				this.sorted = null;
				this.byLength = null;
			}
			const p = thaw(found);
			p.docs.push(id);
			p.meta.push(meta.get(t) ?? 0);
			p.body.push((body.get(t) ?? 0) * norm);
		}
	}

	remove(path: string): void {
		const id = this.byPath.get(path);
		if (id === undefined) return;
		const doc = this.docs[id];
		if (!doc) return;
		doc.alive = false;
		this.byPath.delete(path);
		doc.lens.forEach((l, i) => (this.totals[i] = (this.totals[i] ?? 0) - l));
		this.dead++;
		if (this.dead > 64 && this.dead > this.docs.length / 4) this.compact();
	}

	rename(from: string, to: string): void {
		const id = this.byPath.get(from);
		const doc = id === undefined ? undefined : this.docs[id];
		if (id === undefined || !doc) return;
		this.byPath.delete(from);
		this.byPath.set(to, id);
		doc.path = to;
	}

	/** Drop the tombstones: new ids, postings filtered. */
	compact(): void {
		const remap = new Int32Array(this.docs.length).fill(-1);
		const docs: Doc[] = [];
		this.docs.forEach((d, i) => {
			if (!d.alive) return;
			remap[i] = docs.length;
			docs.push(d);
		});
		for (const [t, p] of this.terms) {
			const nd: number[] = [];
			const nm: number[] = [];
			const nb: number[] = [];
			p.docs.forEach((d, i) => {
				const n = remap[d] ?? -1;
				if (n >= 0) {
					nd.push(n);
					nm.push(p.meta[i] ?? 0);
					nb.push(p.body[i] ?? 0);
				}
			});
			if (nd.length)
				this.terms.set(t, {
					docs: Int32Array.from(nd),
					meta: Float32Array.from(nm),
					body: Float32Array.from(nb),
				});
			else this.terms.delete(t);
		}
		this.docs = docs;
		this.byPath = new Map(docs.map((d, i) => [d.path, i]));
		this.dead = 0;
		this.sorted = null;
		this.byLength = null;
	}

	/** Postings to typed arrays (half the memory of plain arrays), after a batch of changes. */
	freeze(): void {
		for (const [t, p] of this.terms)
			if (Array.isArray(p.docs))
				this.terms.set(t, {
					docs: Int32Array.from(p.docs),
					meta: Float32Array.from(p.meta),
					body: Float32Array.from(p.body),
				});
	}

	search(q: Query, opts: { limit?: number; now?: number } = {}): Hit[] {
		const n = this.size;
		if (!n || !q.terms.length) return [];
		const scores = new Map<number, number>();
		const matched = new Map<number, Set<string>>();
		const termHits = new Map<number, number>();
		q.terms.forEach((qt, qi) => {
			const seen = new Set<number>();
			for (const [term, weight] of this.expand(qt)) {
				const p = this.terms.get(term);
				if (!p) continue;
				const idf = Math.log(1 + (n - p.docs.length + 0.5) / (p.docs.length + 0.5));
				p.docs.forEach((d, i) => {
					if (!this.docs[d]?.alive) return;
					const bodyTf = p.body[i] ?? 0;
					const s = weight * idf * ((p.meta[i] ?? 0) + (bodyTf ? sat(bodyTf) : 0));
					scores.set(d, (scores.get(d) ?? 0) + s);
					let m = matched.get(d);
					if (!m) matched.set(d, (m = new Set()));
					m.add(term);
					if (!seen.has(d)) {
						seen.add(d);
						termHits.set(d, (termHits.get(d) ?? 0) | (1 << Math.min(qi, 30)));
					}
				});
			}
		});
		const all = (1 << Math.min(q.terms.length, 31)) - 1;
		let ids = [...scores.keys()];
		const every = ids.filter((d) => termHits.get(d) === all);
		if (every.length) ids = every;
		if (q.excluded.length) {
			const out = new Set<number>();
			for (const e of q.excluded) for (const d of this.terms.get(e)?.docs ?? []) out.add(d);
			ids = ids.filter((d) => !out.has(d));
		}
		const now = opts.now ?? Date.now();
		const asked = q.terms.join(" ");
		const hits = ids.map((d) => {
			const doc = this.docs[d] as Doc;
			// Recency: up to +25% for a note changed today, fading over about a month.
			const days = Math.max(0, (now - doc.mtime) / 86_400_000);
			let score = (scores.get(d) ?? 0) * (1 + 0.25 * Math.exp(-days / 30));
			// A note titled exactly what you typed comes first; one whose title starts with it, early.
			const title = tokens(
				doc.path
					.split("/")
					.pop()
					?.replace(/\.[^.]+$/, "") ?? "",
			).join(" ");
			if (title === asked) score *= 2;
			else if (title.startsWith(`${asked} `)) score *= 1.4;
			return { path: doc.path, score, terms: [...(matched.get(d) ?? [])] };
		});
		hits.sort((a, b) => b.score - a.score);
		return hits.slice(0, opts.limit ?? 50);
	}

	/** Terms starting with `word` (not `word` itself), each counting `base` scaled by how much of it `word` is. */
	private prefixes(word: string, base: number, out: Map<string, number>): void {
		const sorted = (this.sorted ??= [...this.terms.keys()].sort());
		let lo = 0;
		let hi = sorted.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if ((sorted[mid] ?? "") < word) lo = mid + 1;
			else hi = mid;
		}
		for (let i = lo, k = 0; i < sorted.length && k < 200; i++, k++) {
			const t = sorted[i] ?? "";
			if (!t.startsWith(word)) break;
			if (t !== word) out.set(t, Math.max(out.get(t) ?? 0, base * (word.length / t.length) ** 0.5));
		}
	}

	/** The index's terms a query word matches, with how much each counts. */
	private expand(word: string): Array<[string, number]> {
		const out = new Map<string, number>();
		if (this.terms.has(word)) out.set(word, 1);
		// Prefix: "nebu" finds "nebulasdk"; the longer the rest, the less it counts.
		if (word.length >= 2) this.prefixes(word, PREFIX, out);
		// One letter off, for words of four letters or more: "nebual" finds "nebula".
		if (word.length >= 4) {
			if (!this.byLength) {
				this.byLength = new Map();
				for (const t of this.terms.keys()) {
					const l = this.byLength.get(t.length);
					if (l) l.push(t);
					else this.byLength.set(t.length, [t]);
				}
			}
			for (let len = word.length - 1; len <= word.length + 1; len++)
				for (const t of this.byLength.get(len) ?? [])
					if (t !== word && t[0] === word[0] && withinOneEdit(t, word))
						out.set(t, Math.max(out.get(t) ?? 0, FUZZY));
			// A swap of two letters ("nebual") is two edits: try it too.
			for (let i = 0; i + 1 < word.length; i++) {
				const swapped = word.slice(0, i) + (word[i + 1] ?? "") + (word[i] ?? "") + word.slice(i + 2);
				if (swapped !== word && this.terms.has(swapped))
					out.set(swapped, Math.max(out.get(swapped) ?? 0, FUZZY));
			}
			// A corrected word is also a prefix: "nebual" → "nebula" → "nebulasdk".
			const corrected = [...out].filter(([t, w]) => w === FUZZY && t !== word).slice(0, 5);
			for (const [t] of corrected) this.prefixes(t, FUZZY * PREFIX, out);
		}
		return [...out];
	}

	/** The index as one buffer, to save to disk. Compacts first. */
	serialize(): ArrayBuffer {
		if (this.dead) this.compact();
		const termList = [...this.terms.keys()];
		let total = 0;
		for (const t of termList) total += this.terms.get(t)?.docs.length ?? 0;
		const head = new TextEncoder().encode(
			JSON.stringify({
				format: FORMAT,
				docs: this.docs.map((d) => [d.path, d.mtime, d.lens]),
				terms: termList,
			}),
		);
		const offsets = new Int32Array(termList.length + 1);
		const ids = new Int32Array(total);
		const metas = new Float32Array(total);
		const bodies = new Float32Array(total);
		let at = 0;
		termList.forEach((t, i) => {
			const p = this.terms.get(t) as Postings;
			offsets[i] = at;
			ids.set(p.docs, at);
			metas.set(p.meta, at);
			bodies.set(p.body, at);
			at += p.docs.length;
		});
		offsets[termList.length] = at;
		const pad = (4 - (head.byteLength % 4)) % 4;
		const buf = new ArrayBuffer(
			4 + head.byteLength + pad + offsets.byteLength + ids.byteLength + metas.byteLength + bodies.byteLength,
		);
		new DataView(buf).setUint32(0, head.byteLength, true);
		new Uint8Array(buf, 4, head.byteLength).set(head);
		let o = 4 + head.byteLength + pad;
		for (const part of [offsets, ids, metas, bodies]) {
			new Uint8Array(buf, o, part.byteLength).set(new Uint8Array(part.buffer, part.byteOffset, part.byteLength));
			o += part.byteLength;
		}
		return buf;
	}

	/** An index from serialize()'s buffer, or null if it is from another format. */
	static deserialize(buf: ArrayBuffer): SearchIndex | null {
		try {
			const len = new DataView(buf).getUint32(0, true);
			const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len))) as {
				format: number;
				docs: Array<[string, number, number[]]>;
				terms: string[];
			};
			if (head.format !== FORMAT) return null;
			const pad = (4 - (len % 4)) % 4;
			let o = 4 + len + pad;
			const offsets = new Int32Array(buf, o, head.terms.length + 1);
			o += offsets.byteLength;
			const total = offsets[head.terms.length] ?? 0;
			const ids = new Int32Array(buf, o, total);
			o += ids.byteLength;
			const metas = new Float32Array(buf, o, total);
			o += metas.byteLength;
			const bodies = new Float32Array(buf, o, total);
			const index = new SearchIndex();
			index.docs = head.docs.map(([path, mtime, lens]) => ({ path, mtime, alive: true, lens }));
			index.byPath = new Map(index.docs.map((d, i) => [d.path, i]));
			index.totals = FIELDS.map((_, i) => index.docs.reduce((a, d) => a + (d.lens[i] ?? 0), 0));
			head.terms.forEach((t, i) => {
				const a = offsets[i] ?? 0;
				const b = offsets[i + 1] ?? a;
				// Views on the loaded buffer: no copy.
				index.terms.set(t, {
					docs: ids.subarray(a, b),
					meta: metas.subarray(a, b),
					body: bodies.subarray(a, b),
				});
			});
			return index;
		} catch {
			return null;
		}
	}
}

/** The query's words as the index will look for them (normalized), for excerpts. */
export const queryWords = (q: Query): string[] => q.terms.map(normalize);
