/**
 * What the benchmark needs from an engine. Each engine under test gets an adapter; the bake-off
 * runs ours and SQLite FTS5 through the same calls. Notes arrive as raw text: an engine that parses
 * Markdown itself (Jade's) counts that in its build time.
 */
export type BenchNote = { path: string; mtime: number; text: string };

export type BenchEngine = {
	readonly name: string;
	build(notes: BenchNote[]): void;
	save(): Uint8Array;
	load(buf: Uint8Array): void;
	/** Paths of the top results; `keep` limits them to some notes (a scope) before the top is taken. */
	query(q: string, keep?: (path: string) => boolean): string[];
	update(note: BenchNote): void;
	/** Saving after an update when the engine keeps changes apart from its base (a sidecar); else save() is used. */
	saveChanges?(): Uint8Array;
};
