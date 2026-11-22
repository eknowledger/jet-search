/**
 * The trace: what Jet did over a stretch of time the user chose, as numbers and codes, for the support
 * info. It is off until asked, keeps its events in memory only, and stops by itself. An event holds a
 * kind, the time since the trace began and a few numbers: never a word of a search or a name. The newest
 * 500 events are kept in typed arrays that are made when a trace starts, so nothing is allocated or run
 * at Obsidian's start, and a trace that is off costs the one `on` test its callers make.
 */

/** The two timer calls the trace makes. Named here because the node benchmarks compile this file without the page's types. */
declare const window: { setTimeout(fn: () => void, ms: number): number; clearTimeout(id: number): void };

/** What an event is. The numbers each one carries (a, b, c, d and the flags) are said beside it. */
export const KIND = {
	/** The trace began. a: minutes it was asked to run. */
	start: 1,
	/** The trace ended. a: 0 by the user, 1 when its time was up, 2 when Jet was turned off. */
	stop: 2,
	workerStart: 3,
	workerStop: 4,
	workerCrash: 5,
	workerSleep: 6,
	/** The saved index was opened. a: ms. flags: how it opened (see `OPENED`). */
	indexOpen: 7,
	/** A build of the whole index began. a: notes to read. */
	buildStart: 8,
	/** It ended. a: ms, b: notes. */
	buildEnd: 9,
	/** Changes in the vault were sent to the index. a: ms, b: notes added or changed, c: notes removed. */
	changes: 10,
	/** A search showed results. a: total ms, b: wait for the index, c: worker, d: hits. flags: the recorder's. */
	search: 11,
	/** An error was caught (its code is the event's label). flags: 1 for a warning. */
	problem: 12,
	/** A step of Obsidian's start (its name is the label). */
	mark: 13,
} as const;

export type Kind = (typeof KIND)[keyof typeof KIND];

/** How the saved index opened, as the flags of an `indexOpen` event. */
export const OPENED = { loaded: 0, none: 1, "format-changed": 2, error: 3 } as const;

/** Why a trace ended. */
export type Stopped = "user" | "time" | "unload";
const STOPPED: Stopped[] = ["user", "time", "unload"];

/** How long a trace may be asked to run, in minutes. */
export const TRACE_MINUTES = [5, 10, 15, 30, 60] as const;
export const DEFAULT_TRACE_MINUTES = 15;

/** Events kept; the oldest go first. */
export const KEEP = 500;

/** One event as it is read back. */
export type Event = {
	/** ms since the trace began. */
	t: number;
	kind: Kind;
	a: number;
	b: number;
	c: number;
	d: number;
	flags: number;
	label: string | null;
};

export type TraceState = {
	recording: boolean;
	/** When it began (ms since 1970); null when none has run this session. */
	startedAt: number | null;
	/** The minutes it was asked to run. */
	minutes: number;
	/** When it will stop by itself (while recording). */
	endsAt: number | null;
	/** How it ended, once it has. */
	stopped: Stopped | null;
	/** Events made in all (more than are kept when the ring wrapped). */
	events: number;
	/** The events still in memory. */
	kept: number;
};

class Trace {
	/** True while recording. Callers test this before they make the numbers an event holds. */
	on = false;
	private startedAt: number | null = null;
	private minutes = 0;
	private endsAt: number | null = null;
	private stoppedBy: Stopped | null = null;
	private n = 0;
	private t: Float64Array | null = null;
	private kind: Uint8Array | null = null;
	private flags: Uint16Array | null = null;
	private v: Float32Array | null = null;
	private labels: Array<string | null> | null = null;
	private timer: number | null = null;
	private readonly listeners = new Set<() => void>();

	/** Called when a trace starts or ends (not for each event). Returns the way to stop listening. */
	onChange(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private changed(): void {
		for (const fn of this.listeners) fn();
	}

	/** Begin a trace of `minutes`, forgetting the last one. Does nothing if one is running. */
	start(minutes: number, now = Date.now()): void {
		if (this.on) return;
		this.t = new Float64Array(KEEP);
		this.kind = new Uint8Array(KEEP);
		this.flags = new Uint16Array(KEEP);
		this.v = new Float32Array(KEEP * 4);
		this.labels = Array.from({ length: KEEP }, () => null);
		this.n = 0;
		this.startedAt = now;
		this.minutes = minutes;
		this.endsAt = now + minutes * 60_000;
		this.stoppedBy = null;
		this.on = true;
		this.add(KIND.start, minutes);
		this.timer = window.setTimeout(() => this.stop("time"), minutes * 60_000);
		this.changed();
	}

	/** End the trace: what it holds stays until the next one starts. */
	stop(by: Stopped = "user"): void {
		if (!this.on) return;
		this.add(KIND.stop, STOPPED.indexOf(by));
		this.on = false;
		this.stoppedBy = by;
		this.endsAt = null;
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = null;
		this.changed();
	}

	/** Make an event. The caller has tested `on`; this tests it again so a stray call is harmless. */
	add(kind: Kind, a = 0, b = 0, c = 0, d = 0, flags = 0, label: string | null = null, now = Date.now()): void {
		if (!this.on || !this.t || !this.kind || !this.flags || !this.v || !this.labels) return;
		const i = this.n % KEEP;
		this.t[i] = now - (this.startedAt ?? now);
		this.kind[i] = kind;
		this.flags[i] = flags;
		const o = i * 4;
		this.v[o] = a;
		this.v[o + 1] = b;
		this.v[o + 2] = c;
		this.v[o + 3] = d;
		this.labels[i] = label;
		this.n++;
	}

	state(): TraceState {
		return {
			recording: this.on,
			startedAt: this.startedAt,
			minutes: this.minutes,
			endsAt: this.on ? this.endsAt : null,
			stopped: this.stoppedBy,
			events: this.n,
			kept: Math.min(this.n, KEEP),
		};
	}

	/** The events still in memory, oldest first. Made when a report is asked for, never while recording. */
	list(): Event[] {
		if (!this.t || !this.kind || !this.flags || !this.v || !this.labels) return [];
		const kept = Math.min(this.n, KEEP);
		const out: Event[] = [];
		for (let k = this.n - kept; k < this.n; k++) {
			const i = k % KEEP;
			const o = i * 4;
			out.push({
				t: this.t[i] ?? 0,
				kind: (this.kind[i] ?? 0) as Kind,
				a: this.v[o] ?? 0,
				b: this.v[o + 1] ?? 0,
				c: this.v[o + 2] ?? 0,
				d: this.v[o + 3] ?? 0,
				flags: this.flags[i] ?? 0,
				label: this.labels[i] ?? null,
			});
		}
		return out;
	}

	/** Forget everything, and end a running trace without an event (for tests and for a fresh session). */
	reset(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = null;
		this.on = false;
		this.startedAt = null;
		this.minutes = 0;
		this.endsAt = null;
		this.stoppedBy = null;
		this.n = 0;
		this.t = null;
		this.kind = null;
		this.flags = null;
		this.v = null;
		this.labels = null;
	}
}

/** The one trace of this session. */
export const trace = new Trace();
