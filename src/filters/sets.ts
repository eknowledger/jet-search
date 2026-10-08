/**
 * The notes each filter keeps, from Obsidian's metadata cache, kept until the
 * vault changes. Filters are worked out here, on the main thread, like scope members:
 * the index format is unchanged, and the worker gets the result as the query's allowed paths.
 * One pass over the notes per new filter (a few ms at 1,500 notes), then a lookup.
 */
import { type App, getAllTags, type TFile } from "obsidian";
import { type Filter, type FilterFacts, passes } from "./filter";

export type PropertyKey = { name: string; notes: number };

export class FilterSets {
	private readonly sets = new Map<string, Set<string>>();
	private keys: Map<string, PropertyKey> | null = null;

	constructor(private readonly app: App) {}

	/** The vault changed: sets and keys are worked out again when next asked. */
	invalidate(): void {
		this.sets.clear();
		this.keys = null;
	}

	/** Property keys your notes use (lower case → the most used spelling and its note count). */
	propertyKeys(): Map<string, PropertyKey> {
		if (this.keys) return this.keys;
		const keys = new Map<string, PropertyKey>();
		const spellings = new Map<string, Map<string, number>>();
		for (const f of this.app.vault.getMarkdownFiles()) {
			const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
			if (!fm) continue;
			for (const k of Object.keys(fm)) {
				if (k === "position") continue;
				const low = k.toLowerCase();
				const s = spellings.get(low) ?? new Map<string, number>();
				s.set(k, (s.get(k) ?? 0) + 1);
				spellings.set(low, s);
			}
		}
		for (const [low, s] of spellings) {
			const [name] = [...s].sort((a, b) => b[1] - a[1])[0] ?? [low];
			keys.set(low, { name, notes: [...s.values()].reduce((a, b) => a + b, 0) });
		}
		this.keys = keys;
		return keys;
	}

	known(key: string): boolean {
		return this.propertyKeys().has(key.toLowerCase());
	}

	/** Links in a filter resolved to the notes they open (`project:Cobalt`, `links:[[X]]`). */
	resolve(f: Filter): Filter {
		if (f.kind === "links") {
			const t = this.app.metadataCache.getFirstLinkpathDest(f.name, "");
			return t ? { ...f, target: t.path } : f;
		}
		if (f.kind === "prop") {
			const name = f.value.replace(/^\[\[|\]\]$/g, "").split("|")[0] ?? f.value;
			const t = this.app.metadataCache.getFirstLinkpathDest(name, "");
			return t ? { ...f, target: t.path } : f;
		}
		return f;
	}

	/** The notes the filter keeps (every note for `title`). */
	notes(f: Filter, now = Date.now()): ReadonlySet<string> {
		const key = JSON.stringify(f);
		const hit = this.sets.get(key);
		if (hit) return hit;
		const set = new Set<string>();
		for (const file of this.app.vault.getMarkdownFiles())
			if (passes(f, this.facts(file, f), now)) set.add(file.path);
		this.sets.set(key, set);
		return set;
	}

	/** Only what the filter looks at (a tag filter never resolves links). */
	private facts(file: TFile, f: Filter): FilterFacts {
		const cache = this.app.metadataCache.getFileCache(file);
		const needsLinks = f.kind === "prop" && f.target !== undefined;
		const links: Record<string, string[]> = {};
		if (needsLinks)
			for (const l of cache?.frontmatterLinks ?? []) {
				const k = l.key.replace(/\.\d+$/, "").toLowerCase();
				if (k !== f.key.toLowerCase()) continue;
				const dest = this.app.metadataCache.getFirstLinkpathDest(l.link.split("#")[0] ?? l.link, file.path);
				if (dest) (links[k] ??= []).push(dest.path);
			}
		const resolved = this.app.metadataCache.resolvedLinks?.[file.path];
		return {
			path: file.path,
			props: cache?.frontmatter ?? {},
			links,
			tags: f.kind === "tag" && cache ? (getAllTags(cache) ?? []) : [],
			mtime: file.stat.mtime,
			ctime: file.stat.ctime,
			outgoing: f.kind === "links" || f.kind === "haslink" ? Object.keys(resolved ?? {}) : [],
		};
	}
}
