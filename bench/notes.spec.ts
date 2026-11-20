import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { BenchNote } from "./engine";

/** Markdown files under a corpus, as Obsidian lists them (no dot-folders), sorted by path. */
export const listNotes = (root: string): string[] => {
	const out: string[] = [];
	const walk = (dir: string): void => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			if (e.name.startsWith(".")) continue;
			const p = join(dir, e.name);
			if (e.isDirectory()) walk(p);
			else if (e.name.endsWith(".md")) out.push(p);
		}
	};
	walk(root);
	return out.sort();
};

export const readNotes = (root: string): BenchNote[] =>
	listNotes(root).map((p) => ({
		path: relative(root, p),
		mtime: statSync(p).mtimeMs,
		text: readFileSync(p, "utf8"),
	}));
