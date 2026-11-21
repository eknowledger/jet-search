/**
 * What Jet remembers about itself for the support info: a few counters and the last problems. It is
 * written only when something rare happens (a worker starts or stops, an error is caught), never per
 * keystroke or per result, so it costs nothing a search could notice. A problem keeps a code and the
 * error's name, never its message: a message can carry a note's path.
 */
export type Problem = {
	/** Where it happened, e.g. `search.failed`. */
	code: string;
	/** The error's class name (`TypeError`), or the type of what was thrown. */
	error: string;
	/** When it last happened (ms since 1970). */
	at: number;
	/** How many times in a row. */
	count: number;
};

const MAX_PROBLEMS = 20;

/** The name of what was thrown, for the report; its text is left out. */
export const errorName = (e: unknown): string => (e instanceof Error ? e.name : e === null ? "null" : typeof e);

class Diag {
	workerStarts = 0;
	workerCrashes = 0;
	sleeps = 0;
	problems: Problem[] = [];

	workerStarted(): void {
		this.workerStarts++;
	}

	workerCrashed(): void {
		this.workerCrashes++;
	}

	slept(): void {
		this.sleeps++;
	}

	/** Record a caught error: the same one again in a row only counts. */
	problem(code: string, e: unknown): void {
		const error = errorName(e);
		const last = this.problems[this.problems.length - 1];
		if (last && last.code === code && last.error === error) {
			last.count++;
			last.at = Date.now();
			return;
		}
		this.problems.push({ code, error, at: Date.now(), count: 1 });
		if (this.problems.length > MAX_PROBLEMS) this.problems.shift();
	}

	reset(): void {
		this.workerStarts = 0;
		this.workerCrashes = 0;
		this.sleeps = 0;
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
	diag.problem(code, e);
};
