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
	query(q: string): string[];
	update(note: BenchNote): void;
};
