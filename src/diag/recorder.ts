import { KIND, trace } from "./trace";

/**
 * The flight recorder: the last 100 searches as numbers, for the support info. One search is a row of
 * seven floats and three small integers in two typed arrays that are made on the first search, so nothing
 * is allocated or run at Obsidian's start. It holds durations, counts and flags, never a word of a search.
 */

/** Bits of a search's flags. */
export const FLAG = {
	words: 1,
	meaning: 2,
	/** A scope (or its notes) narrowed it. */
	scoped: 4,
	/** The worker had to start for this search. */
	cold: 8,
	/** The index was still being built. */
	building: 16,
	/** The worker found the saved index damaged. */
	broken: 32,
	/** Every word was rare (exact matches first). */
	rare: 64,
	/** The query held a quoted phrase. */
	phrase: 128,
} as const;

/** The words in a text (runs of non-space characters), counted without making a list. */
export const wordCount = (text: string): number => {
	let n = 0;
	let inside = false;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		const space = c === 32 || (c >= 9 && c <= 13) || c === 160;
		if (!space && !inside) n++;
		inside = !space;
	}
	return n;
};

const KEEP = 100;
/** Floats per row: total, ready, worker, transit, prepare, excerpts, hits. */
const F = 7;
/** Integers per row: flags, characters, words. */
const U = 3;

/** One search as the summary gives it back. */
export type Row = {
	total: number;
	ready: number;
	worker: number;
	transit: number;
	prepare: number;
	excerpts: number;
	hits: number;
	flags: number;
	chars: number;
	words: number;
};

export type Summary = {
	/** Searches in memory (at most 100) and searches since the plugin started. */
	kept: number;
	total: number;
	/** Keystroke to results, ms. */
	median: number;
	p95: number;
	max: Row;
	/** The median of each part of the time, ms. */
	stages: { ready: number; worker: number; transit: number; prepare: number; excerpts: number };
	kinds: { words: number; meaning: number };
	flags: { scoped: number; cold: number; building: number; broken: number; rare: number; phrase: number };
	/** Searches a newer one replaced before they showed results. */
	superseded: number;
	/** The totals of the last ten searches, oldest first. */
	last: number[];
};

const median = (a: number[]): number => {
	if (!a.length) return 0;
	const s = [...a].sort((x, y) => x - y);
	const m = s.length >> 1;
	return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};

export class Recorder {
	private f: Float32Array | null = null;
	private u: Uint16Array | null = null;
	private n = 0;
	private skipped = 0;

	get allocated(): boolean {
		return this.f !== null;
	}

	/**
	 * Record a search that showed results. Durations in ms: `total` is keystroke to results; `ready` the wait for
	 * the index; `worker` the worker's own time; `transit` the rest of the round trip; `prepare` the main thread's
	 * work before drawing; `excerpts` the later pass that adds lines. Positional on purpose: no object is made.
	 */
	add(
		flags: number,
		chars: number,
		words: number,
		hits: number,
		total: number,
		ready: number,
		worker: number,
		transit: number,
		prepare: number,
		excerpts: number,
	): void {
		if (trace.on) trace.add(KIND.search, total, ready, worker, hits, flags);
		const f = (this.f ??= new Float32Array(KEEP * F));
		const u = (this.u ??= new Uint16Array(KEEP * U));
		const i = this.n % KEEP;
		const a = i * F;
		f[a] = total;
		f[a + 1] = ready;
		f[a + 2] = worker;
		// Two clocks (here and the worker's) can disagree by a hair.
		f[a + 3] = transit > 0 ? transit : 0;
		f[a + 4] = prepare;
		f[a + 5] = excerpts;
		f[a + 6] = hits;
		const b = i * U;
		u[b] = flags;
		u[b + 1] = chars > 65535 ? 65535 : chars;
		u[b + 2] = words > 65535 ? 65535 : words;
		this.n++;
	}

	/** A search a newer one replaced before it showed results. */
	superseded(): void {
		this.skipped++;
	}

	reset(): void {
		this.f = null;
		this.u = null;
		this.n = 0;
		this.skipped = 0;
	}

	private row(i: number): Row {
		const f = this.f as Float32Array;
		const u = this.u as Uint16Array;
		const a = i * F;
		const b = i * U;
		return {
			total: f[a] ?? 0,
			ready: f[a + 1] ?? 0,
			worker: f[a + 2] ?? 0,
			transit: f[a + 3] ?? 0,
			prepare: f[a + 4] ?? 0,
			excerpts: f[a + 5] ?? 0,
			hits: f[a + 6] ?? 0,
			flags: u[b] ?? 0,
			chars: u[b + 1] ?? 0,
			words: u[b + 2] ?? 0,
		};
	}

	/** Read the kept searches; made when a report is asked for, never while searching. */
	summary(): Summary | null {
		if (!this.f || !this.n) return null;
		const kept = Math.min(this.n, KEEP);
		const rows: Row[] = [];
		for (let i = 0; i < kept; i++) rows.push(this.row(i));
		const totals = rows.map((r) => r.total).sort((a, b) => a - b);
		const at = (q: number): number => totals[Math.min(totals.length - 1, Math.floor(q * totals.length))] ?? 0;
		const count = (bit: number): number => rows.filter((r) => r.flags & bit).length;
		let max = rows[0] as Row;
		for (const r of rows) if (r.total > max.total) max = r;
		// The last ten in the order they were made.
		const last: number[] = [];
		for (let k = Math.min(10, kept); k >= 1; k--) last.push(this.row((this.n - k) % KEEP).total);
		return {
			kept,
			total: this.n,
			median: median(totals),
			p95: at(0.95),
			max,
			stages: {
				ready: median(rows.map((r) => r.ready)),
				worker: median(rows.map((r) => r.worker)),
				transit: median(rows.map((r) => r.transit)),
				prepare: median(rows.map((r) => r.prepare)),
				excerpts: median(rows.map((r) => r.excerpts)),
			},
			kinds: { words: count(FLAG.words), meaning: count(FLAG.meaning) },
			flags: {
				scoped: count(FLAG.scoped),
				cold: count(FLAG.cold),
				building: count(FLAG.building),
				broken: count(FLAG.broken),
				rare: count(FLAG.rare),
				phrase: count(FLAG.phrase),
			},
			superseded: this.skipped,
			last,
		};
	}
}

/** The one recorder of this session. */
export const recorder = new Recorder();
