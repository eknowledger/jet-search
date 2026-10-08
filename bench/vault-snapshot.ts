/**
 * A scope-generator snapshot (`src/scopes/snapshot.ts`) read from a vault on disk, for tests and corpus
 * runs: every file, each note's frontmatter, its frontmatter links resolved the way Obsidian resolves
 * them (by path, else by note name, shortest path first), its tags, and the vault's own settings from
 * `.obsidian/` (excluded files, attachments, new-note folder, templates, daily notes, property types).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NoteFacts } from "../src/scopes/members";
import { emptyConfig, type Snapshot } from "../src/scopes/snapshot";

const walk = (dir: string, rel = ""): string[] =>
	readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => {
		if (e.name.startsWith(".")) return [];
		const r = rel ? `${rel}/${e.name}` : e.name;
		return e.isDirectory() ? walk(dir, r) : [r];
	});

const unquote = (s: string): string => {
	const t = s.trim();
	if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
		try {
			return t.startsWith('"') ? (JSON.parse(t) as string) : t.slice(1, -1).replace(/''/g, "'");
		} catch {
			return t.slice(1, -1);
		}
	}
	return t;
};

const scalar = (s: string): unknown => {
	const t = unquote(s);
	if (t !== s.trim()) return t;
	if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
	if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
	return t;
};

/** A small YAML subset: `key: value`, block lists, inline `[a, b]` lists, quoted strings. */
export const frontmatter = (text: string): { props: Record<string, unknown>; body: string } => {
	const props: Record<string, unknown> = {};
	if (!text.startsWith("---\n")) return { props, body: text };
	const end = text.indexOf("\n---", 4);
	if (end < 0) return { props, body: text };
	let key = "";
	for (const line of text.slice(4, end).split("\n")) {
		const item = /^\s+-\s+(.*)$/.exec(line);
		if (item && key) {
			const list = Array.isArray(props[key]) ? (props[key] as unknown[]) : [];
			list.push(scalar(item[1] ?? ""));
			props[key] = list;
			continue;
		}
		const kv = /^([^\s:#][^:]*):\s*(.*)$/.exec(line);
		if (!kv) continue;
		key = (kv[1] ?? "").trim();
		const v = (kv[2] ?? "").trim();
		if (!v) props[key] = [];
		else if (v.startsWith("[") && v.endsWith("]") && !v.startsWith("[["))
			props[key] = v
				.slice(1, -1)
				.split(",")
				.map((x) => scalar(x))
				.filter((x) => x !== "");
		else props[key] = scalar(v);
	}
	for (const [k, v] of Object.entries(props)) if (Array.isArray(v) && !v.length) props[k] = null;
	return { props, body: text.slice(end + 4) };
};

const readJson = (path: string): Record<string, unknown> => {
	try {
		return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>) : {};
	} catch {
		return {};
	}
};

export const readSnapshot = (dir: string): Snapshot => {
	const files = walk(dir).sort();
	const md = files.filter((f) => f.toLowerCase().endsWith(".md"));
	// Link resolution: exact path (with or without .md), else note name (shortest path first).
	const byName = new Map<string, string[]>();
	for (const p of md) {
		const name = (p.split("/").pop() ?? p).replace(/\.md$/i, "").toLowerCase();
		byName.set(name, [...(byName.get(name) ?? []), p]);
	}
	for (const list of byName.values()) list.sort((a, b) => a.length - b.length || a.localeCompare(b));
	const mdSet = new Set(md.map((p) => p.toLowerCase()));
	const resolve = (link: string): string | null => {
		const l = link.split("#")[0]?.split("|")[0]?.trim() ?? "";
		if (!l) return null;
		const withMd = /\.md$/i.test(l) ? l : `${l}.md`;
		if (mdSet.has(withMd.toLowerCase())) return md.find((p) => p.toLowerCase() === withMd.toLowerCase()) ?? null;
		return byName.get((l.split("/").pop() ?? l).toLowerCase())?.[0] ?? null;
	};
	const notes: NoteFacts[] = md.map((path) => {
		const { props, body } = frontmatter(readFileSync(join(dir, path), "utf8"));
		const links: Record<string, string[]> = {};
		for (const [k, v] of Object.entries(props))
			for (const x of Array.isArray(v) ? v : [v]) {
				if (typeof x !== "string") continue;
				for (const m of x.matchAll(/\[\[([^\]]+)\]\]/g)) {
					const t = resolve(m[1] ?? "");
					if (t) (links[k.toLowerCase()] ??= []).push(t);
				}
			}
		const fmTags = props.tags ?? props.tag;
		const tags = [
			...(Array.isArray(fmTags) ? fmTags : fmTags ? [fmTags] : []).map((t) => `#${String(t).replace(/^#/, "")}`),
			...[
				...body.replace(/```[\s\S]*?```/g, "").matchAll(/(?<=^|\s)#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/gmu),
			].map((m) => `#${m[1]}`),
		];
		return { path, props, links, tags: [...new Set(tags)] };
	});
	const obs = join(dir, ".obsidian");
	const app = readJson(join(obs, "app.json"));
	const config = emptyConfig();
	config.excluded = (Array.isArray(app.userIgnoreFilters) ? app.userIgnoreFilters : []).filter(
		(x): x is string => typeof x === "string",
	);
	if (typeof app.attachmentFolderPath === "string") config.attachments = app.attachmentFolderPath;
	if (app.newFileLocation === "folder" && typeof app.newFileFolderPath === "string")
		config.inbox = app.newFileFolderPath;
	const templates = readJson(join(obs, "templates.json")).folder;
	if (typeof templates === "string" && templates) config.templates = templates;
	const daily = readJson(join(obs, "daily-notes.json")).folder;
	if (typeof daily === "string" && daily) config.daily = daily;
	const types = readJson(join(obs, "types.json")).types;
	if (types && typeof types === "object") config.types = types as Record<string, string>;
	return { notes, files, config };
};
