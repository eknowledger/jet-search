/**
 * What Jet remembers about itself for the support info: a few counters and the last problems. It is
 * written only when something rare happens (a worker starts or stops, an error is caught), never per
 * keystroke or per result, so it costs nothing a search could notice. A problem keeps a code and the
 * error's name, never its message: a message can carry a note's path.
 */
import { errorName, errorWhere } from "./error-facts";
import { KIND, trace } from "./trace";

export { errorName, errorWhere };

export type Problem = {
	/** Where it happened, e.g. `search.failed`. */
	code: string;
	/** A caught error, or a warning (something that went on without it). */
	level: "error" | "warn";
	/** The error's class name (`TypeError`), or the type of what was thrown. */
	error: string;
	/** Where in Jet's own code it was thrown: `function:line:column` of the bundle, or null. No file names. */
	where: string | null;
	/** When it last happened (ms since 1970). */
	at: number;
	/** How many times in a row. */
	count: number;
};

const MAX_PROBLEMS = 20;

/** How the saved index opened, as the worker reported it when it started. */
export type Opened = {
	how: "loaded" | "none" | "format-changed" | "error";
	/** The format the saved index had (format-changed), and the one this Jet reads. */
	found: number | null;
	version: number;
	/** Where the index is kept: "indexeddb", or "memory" (not kept between sessions). */
	store: string;
	/** How long the open took in the worker. */
	ms: number;
	at: number;
};

/** What the worker tells the main thread when something it caught went wrong (no message text). */
export type WorkerEvent = { code: string; level: Problem["level"]; error: string; where: string | null };

class Diag {
	workerStarts = 0;
	workerCrashes = 0;
	sleeps = 0;
	/** When the running worker started (null: none is running). */
	workerSince: number | null = null;
	problems: Problem[] = [];
	/** How the saved index opened the last time the worker started (null: not opened yet). */
	opened: Opened | null = null;

	workerStarted(): void {
		this.workerStarts++;
		this.workerSince = Date.now();
		if (trace.on) trace.add(KIND.workerStart);
	}

	workerStopped(): void {
		this.workerSince = null;
		if (trace.on) trace.add(KIND.workerStop);
	}

	workerCrashed(): void {
		this.workerCrashes++;
		if (trace.on) trace.add(KIND.workerCrash);
	}

	slept(): void {
		this.sleeps++;
		if (trace.on) trace.add(KIND.workerSleep);
	}

	/** Record a caught error: the same one again in a row only counts. */
	problem(code: string, e: unknown, level: Problem["level"] = "error", where: string | null = errorWhere(e)): void {
		this.record(code, level, errorName(e), where);
	}

	/** Something the worker caught and told us about. */
	workerEvent(ev: WorkerEvent): void {
		this.record(ev.code, ev.level, ev.error, ev.where);
	}

	private record(code: string, level: Problem["level"], error: string, where: string | null): void {
		if (trace.on) trace.add(KIND.problem, 0, 0, 0, 0, level === "warn" ? 1 : 0, code);
		const last = this.problems[this.problems.length - 1];
		if (last && last.code === code && last.error === error && last.level === level && last.where === where) {
			last.count++;
			last.at = Date.now();
			return;
		}
		this.problems.push({ code, level, error, where, at: Date.now(), count: 1 });
		if (this.problems.length > MAX_PROBLEMS) this.problems.shift();
	}

	reset(): void {
		this.workerStarts = 0;
		this.workerCrashes = 0;
		this.sleeps = 0;
		this.workerSince = null;
		this.opened = null;
		this.problems = [];
	}
}

export const diag = new Diag();

/** An error caught on the main thread: still printed as before, and kept in the support info. */
export const fail = (code: string, text: string, e: unknown): void => {
	console.error(text, e);
	diag.problem(code, e);
};

/** The same for a warning. */
export const warned = (code: string, text: string, e: unknown): void => {
	console.warn(text, e);
	diag.problem(code, e, "warn");
};

/** An error caught and passed over on purpose: not printed, but remembered so a report can show it. */
export const noted = (code: string, e: unknown): void => {
	diag.problem(code, e, "warn");
};
