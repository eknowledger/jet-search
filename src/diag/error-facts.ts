/**
 * What an error says about itself that is safe to keep: its class name and the place in Jet's own code it was
 * thrown from. Pure functions with no state, so the worker can use them too. The message is never kept (it can
 * carry a note's path).
 */

/** The name of what was thrown, for the report; its text is left out. */
export const errorName = (e: unknown): string => (e instanceof Error ? e.name : e === null ? "null" : typeof e);

/**
 * The place in Jet's code an error came from, as `function:line:column`: enough to find the line in the
 * build the report names, and nothing a note or a vault could be in (no file name or URL is kept).
 */
export const errorWhere = (e: unknown): string | null => {
	if (!(e instanceof Error)) return null;
	// An error that came back from the worker already says where it was thrown there.
	const given = (e as Error & { where?: unknown }).where;
	if (typeof given === "string") return given;
	const stack = e.stack;
	if (!stack) return null;
	for (const line of stack.split("\n").slice(1, 6)) {
		const m = /^\s*at (?:(?:async )?([\w$.<>]+) \()?[^()\s]*?:(\d+):(\d+)\)?\s*$/.exec(line);
		if (m) return `${m[1] ?? "anonymous"}:${m[2]}:${m[3]}`;
	}
	return null;
};
