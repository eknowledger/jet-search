/**
 * Note vectors in the worker: one int8 vector per note (unit length × 127), its mtime, and a flat
 * scan for the nearest (1,500 notes × 256 numbers: well under a millisecond). Kept with the index in
 * IndexedDB, so a restart does not embed again.
 */
export type Near = { path: string; score: number };
export type SavedVectors = { model: string; dim: number; paths: string[]; mtimes: number[]; data: Int8Array };

export class Vectors {
	/** `v` null: the note was embedded and has no known word, so it is never near (and not missing). */
	private readonly byPath = new Map<string, { v: Int8Array | null; mtime: number }>();
	dirty = false;

	constructor(
		readonly model: string,
		readonly dim: number,
	) {}

	/** Notes with a vector. */
	get size(): number {
		let n = 0;
		for (const x of this.byPath.values()) if (x.v) n++;
		return n;
	}

	paths(): string[] {
		return [...this.byPath.keys()];
	}

	/** A vector, none (embedded, and no word the model knows), or missing (not made yet). */
	state(path: string): "yes" | "none" | "missing" {
		const x = this.byPath.get(path);
		return !x ? "missing" : x.v ? "yes" : "none";
	}

	mtimeOf(path: string): number | undefined {
		return this.byPath.get(path)?.mtime;
	}

	set(path: string, mtime: number, unit: Float32Array | null): void {
		// No known word: remembered as embedded, so it is not read again at every start.
		if (!unit) {
			this.byPath.set(path, { v: null, mtime });
			this.dirty = true;
			return;
		}
		const v = new Int8Array(this.dim);
		for (let j = 0; j < this.dim; j++) v[j] = Math.max(-127, Math.min(127, Math.round((unit[j] ?? 0) * 127)));
		this.byPath.set(path, { v, mtime });
		this.dirty = true;
	}

	delete(path: string): void {
		if (this.byPath.delete(path)) this.dirty = true;
	}

	rename(from: string, to: string): void {
		const x = this.byPath.get(from);
		if (!x) return;
		this.byPath.delete(from);
		this.byPath.set(to, x);
		this.dirty = true;
	}

	/** The `k` nearest notes to a unit vector, best first; only `allow`ed notes when given. */
	nearest(q: Float32Array, k: number, allow?: (path: string) => boolean): Near[] {
		const all: Near[] = [];
		for (const [path, { v }] of this.byPath) {
			if (!v || (allow && !allow(path))) continue;
			let s = 0;
			for (let j = 0; j < this.dim; j++) s += (q[j] ?? 0) * (v[j] ?? 0);
			all.push({ path, score: s / 127 });
		}
		return all.sort((a, b) => b.score - a.score).slice(0, k);
	}

	save(): SavedVectors {
		const paths = [...this.byPath.keys()];
		const data = new Int8Array(paths.length * this.dim);
		const mtimes: number[] = [];
		paths.forEach((p, i) => {
			const x = this.byPath.get(p);
			if (!x) return;
			// A note with no vector is saved as zeros (a real one never is: it has unit length).
			if (x.v) data.set(x.v, i * this.dim);
			mtimes.push(x.mtime);
		});
		return { model: this.model, dim: this.dim, paths, mtimes, data };
	}

	static load(s: SavedVectors): Vectors {
		const out = new Vectors(s.model, s.dim);
		s.paths.forEach((p, i) => {
			const v = s.data.slice(i * s.dim, (i + 1) * s.dim);
			out.byPath.set(p, { v: v.some((x) => x !== 0) ? v : null, mtime: s.mtimes[i] ?? 0 });
		});
		return out;
	}
}
