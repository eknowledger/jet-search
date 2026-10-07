import { tokenize } from "./analyzer";

/**
 * A note's indexed fields, as terms. In Obsidian these come from the metadata
 * cache; `fieldsFromMarkdown` reads them from the raw text, for the benchmark and tests.
 */
export const FIELDS = ["name", "aliases", "h1", "h2", "h3", "tags", "folder", "links"] as const;
export type MetaField = (typeof FIELDS)[number];
/** Field weights; the body is scored by BM25 on its own. */
export const WEIGHTS: Record<MetaField, number> = {
	name: 10,
	aliases: 9,
	h1: 6,
	h2: 5,
	h3: 4,
	tags: 4,
	folder: 3,
	links: 1.5,
};

export type NoteFields = Record<MetaField, string[]> & { body: string[] };

/**
 * What the engine indexes for one note. `linkTargets` are the names of the notes it links to; `inLinks`,
 * when known (Obsidian's resolved links), is how many notes link here, else it is counted from the batch.
 */
export type NoteInput = { path: string; mtime: number; fields: NoteFields; linkTargets: string[]; inLinks?: number };

const terms = (s: string): string[] => tokenize(s, { parts: true });
const basename = (path: string): string => (path.split("/").pop() ?? path).replace(/\.md$/i, "");

/** The name a link points at: `[[Folder/Note#Heading|Alias]]` → `Note`. */
export const linkName = (target: string): string => basename(target.split(/[#^|]/)[0]?.trim() ?? "");

/** A frontmatter list (`key: [a, b]`, `key: a`, or a `- a` block) as strings. */
const yamlList = (yaml: string, key: string): string[] => {
	const inline = new RegExp(`^${key}:[ \\t]*(.+)$`, "m").exec(yaml)?.[1]?.trim();
	if (inline) {
		const body = inline.replace(/^\[|\]$/g, "");
		return body
			.split(",")
			.map((x) => x.trim().replace(/^["']|["']$/g, ""))
			.filter(Boolean);
	}
	const block = new RegExp(`^${key}:[ \\t]*\\n((?:[ \\t]*-[ \\t]*.*\\n?)+)`, "m").exec(yaml)?.[1] ?? "";
	return block
		.split("\n")
		.map((l) =>
			l
				.replace(/^[ \t]*-[ \t]*/, "")
				.trim()
				.replace(/^["']|["']$/g, ""),
		)
		.filter(Boolean);
};

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** A note's fields from its path and raw Markdown (headings, tags, links, aliases, body). */
export const fieldsFromMarkdown = (path: string, text: string): { fields: NoteFields; linkTargets: string[] } => {
	const fm = FRONTMATTER.exec(text);
	const yaml = fm?.[1] ?? "";
	const body = fm ? text.slice(fm[0].length) : text;
	const folders = path.split("/").slice(0, -1);
	const fields: NoteFields = {
		name: terms(basename(path)),
		aliases: terms(yamlList(yaml, "aliases").join(" ")),
		h1: [],
		h2: [],
		h3: [],
		tags: terms(yamlList(yaml, "tags").join(" ")),
		folder: terms(folders.join(" ")),
		links: [],
		body: [],
	};
	for (const m of body.matchAll(/^(#{1,6})[ \t]+(.+)$/gm)) {
		const level = m[1]?.length ?? 0;
		const t = terms(m[2] ?? "");
		(level === 1 ? fields.h1 : level === 2 ? fields.h2 : fields.h3).push(...t);
	}
	for (const m of body.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)) fields.tags.push(...terms(m[1] ?? ""));
	const linkTargets: string[] = [];
	for (const m of body.matchAll(/\[\[([^\]]+)\]\]/g)) {
		const name = linkName(m[1] ?? "");
		if (name) linkTargets.push(name);
	}
	fields.links = terms(linkTargets.join(" "));
	// The body keeps links' visible words; Markdown link URLs are not words of the note.
	fields.body = terms(body.replace(/\]\([^)\s]*\)/g, "]"));
	return { fields, linkTargets };
};

/**
 * A note as the main thread gathers it from Obsidian: its text and what the
 * metadata cache already knows. The worker turns it into terms (`fieldsFromRaw`), so tokenizing never
 * runs on the main thread.
 */
export type RawNote = {
	path: string;
	mtime: number;
	text: string;
	/** Where the body starts (after the frontmatter). */
	bodyStart: number;
	aliases: string[];
	headings: Array<{ level: number; text: string }>;
	/** Tags without "#", nested ones whole (`project/alpha`). */
	tags: string[];
	/** Names of the notes this one links to (resolved where possible). */
	links: string[];
	/** How many notes link to this one (from Obsidian's resolved links). */
	inLinks: number;
};

/** Body text indexed per note, at most (a huge note never stalls the index). */
export const MAX_BODY_CHARS = 2_000_000;

/** A note's fields from what Obsidian gathered (the worker's side of `RawNote`). */
export const fieldsFromRaw = (r: RawNote): NoteInput => {
	const folders = r.path.split("/").slice(0, -1);
	const fields: NoteFields = {
		name: terms(basename(r.path)),
		aliases: terms(r.aliases.join(" ")),
		h1: [],
		h2: [],
		h3: [],
		tags: terms(r.tags.join(" ")),
		folder: terms(folders.join(" ")),
		links: terms(r.links.join(" ")),
		body: terms(r.text.slice(r.bodyStart, r.bodyStart + MAX_BODY_CHARS).replace(/\]\([^)\s]*\)/g, "]")),
	};
	for (const h of r.headings)
		(h.level === 1 ? fields.h1 : h.level === 2 ? fields.h2 : fields.h3).push(...terms(h.text));
	return { path: r.path, mtime: r.mtime, fields, linkTargets: r.links, inLinks: r.inLinks };
};
