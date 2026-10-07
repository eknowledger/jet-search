import { type App, type CachedMetadata, getAllTags, parseFrontMatterAliases, type TFile } from "obsidian";
import type { RawNote } from "../engine/fields";

/**
 * What Jet indexes of a note, from what Obsidian already knows: the text
 * (for the body), and from the metadata cache its headings, tags, aliases and resolved links. No
 * Markdown is parsed here; the worker makes the terms.
 */
export const gather = (app: App, file: TFile, text: string, inLinks: number): RawNote => {
	const cache: CachedMetadata | null = app.metadataCache.getFileCache(file);
	const bodyStart = cache?.frontmatterPosition ? Math.min(text.length, cache.frontmatterPosition.end.offset) : 0;
	const links: string[] = [];
	for (const l of [...(cache?.links ?? []), ...(cache?.embeds ?? [])]) {
		const name = (l.link.split(/[#^|]/)[0] ?? l.link).trim();
		const target = app.metadataCache.getFirstLinkpathDest(name, file.path);
		links.push(target ? target.basename : (name.split("/").pop() ?? name));
	}
	return {
		path: file.path,
		mtime: file.stat.mtime,
		text,
		bodyStart,
		aliases: parseFrontMatterAliases(cache?.frontmatter) ?? [],
		headings: (cache?.headings ?? []).map((h) => ({ level: h.level, text: h.heading })),
		tags: (cache ? (getAllTags(cache) ?? []) : []).map((t) => t.replace(/^#/, "")),
		links,
		inLinks,
	};
};

/** How many notes link to each note (Obsidian's resolved links, inverted). */
export const inboundCounts = (app: App): Map<string, number> => {
	const m = new Map<string, number>();
	for (const targets of Object.values(app.metadataCache.resolvedLinks))
		for (const t of Object.keys(targets)) m.set(t, (m.get(t) ?? 0) + 1);
	return m;
};

/** Whether a note is left out of the index: Jet's excluded folders and Obsidian's excluded files. */
export const excluder = (app: App, folders: readonly string[]): ((path: string) => boolean) => {
	const prefixes = folders.map((f) => f.replace(/\/?$/, "/"));
	const raw = (app.vault as unknown as { getConfig?: (k: string) => unknown }).getConfig?.("userIgnoreFilters");
	const filters = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
	const res: RegExp[] = [];
	for (const f of filters) {
		const m = /^\/(.*)\/([a-z]*)$/.exec(f);
		if (m) {
			try {
				res.push(new RegExp(m[1] ?? "", m[2]));
			} catch {
				// An invalid pattern in Obsidian's settings is ignored, as Obsidian does.
			}
		} else prefixes.push(f);
	}
	return (path) => prefixes.some((p) => path.startsWith(p)) || res.some((r) => r.test(path));
};
