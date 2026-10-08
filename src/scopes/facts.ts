/**
 * A note's facts for scope membership (`members.ts`), from Obsidian's metadata cache: its frontmatter,
 * its frontmatter links resolved to the notes they open, and all its tags. No file is read.
 */
import { type App, getAllTags, type TFile } from "obsidian";
import type { NoteFacts } from "./members";

/** A frontmatter link's key without its list index ("project.1" → "project"), lower case. */
const baseKey = (key: string): string => key.replace(/\.\d+$/, "").toLowerCase();

export const noteFacts = (app: App, file: TFile): NoteFacts => {
	const cache = app.metadataCache.getFileCache(file);
	const links: Record<string, string[]> = {};
	for (const l of cache?.frontmatterLinks ?? []) {
		const dest = app.metadataCache.getFirstLinkpathDest(l.link.split("#")[0] ?? l.link, file.path);
		if (!dest) continue;
		(links[baseKey(l.key)] ??= []).push(dest.path);
	}
	return {
		path: file.path,
		props: cache?.frontmatter ?? {},
		links,
		tags: cache ? (getAllTags(cache) ?? []) : [],
	};
};
