/**
 * Pickers for a scope's "+ Add rule": a folder, a property value or a tag, each with how many
 * notes it holds, in Obsidian's own fuzzy dialog. Link values are resolved to the note they open, so
 * the rule counts every spelling of the link.
 */
import { type App, FuzzySuggestModal, getAllTags, TFolder } from "obsidian";
import type { Rule } from "../scopes/model";

type Choice = { label: string; count: number; rule: Rule };

class Picker extends FuzzySuggestModal<Choice> {
	constructor(
		app: App,
		placeholder: string,
		private readonly choices: Choice[],
		private readonly done: (r: Rule | null) => void,
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getItems(): Choice[] {
		return this.choices;
	}

	getItemText(c: Choice): string {
		return `${c.label}  ·  ${c.count.toLocaleString()} note${c.count === 1 ? "" : "s"}`;
	}

	onChooseItem(c: Choice): void {
		this.done(c.rule);
	}
}

const byCount = (a: Choice, b: Choice): number => b.count - a.count || a.label.localeCompare(b.label);

export const pickFolder = (app: App, done: (r: Rule | null) => void): void => {
	const counts = new Map<string, number>();
	for (const f of app.vault.getMarkdownFiles())
		for (let p = f.parent; p && !p.isRoot(); p = p.parent) counts.set(p.path, (counts.get(p.path) ?? 0) + 1);
	const choices = app.vault
		.getAllLoadedFiles()
		.filter((f): f is TFolder => f instanceof TFolder && !f.isRoot())
		.map((f): Choice => ({ label: f.path, count: counts.get(f.path) ?? 0, rule: { kind: "folder", path: f.path } }))
		.sort(byCount);
	new Picker(app, "A folder (and its subfolders)…", choices, done).open();
};

export const pickTag = (app: App, done: (r: Rule | null) => void): void => {
	const counts = new Map<string, number>();
	for (const f of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(f);
		const seen = new Set<string>();
		for (const t of (cache && getAllTags(cache)) ?? []) {
			// A note counts for its tag and every parent of it (#a/b counts under #a).
			const parts = t.toLowerCase().split("/");
			for (let i = 1; i <= parts.length; i++) seen.add(parts.slice(0, i).join("/"));
		}
		for (const t of seen) counts.set(t, (counts.get(t) ?? 0) + 1);
	}
	const choices = [...counts]
		.map(([tag, count]): Choice => ({ label: tag, count, rule: { kind: "tag", tag } }))
		.sort(byCount);
	new Picker(app, "A tag (and its nested tags)…", choices, done).open();
};

export const pickProperty = (app: App, done: (r: Rule | null) => void): void => {
	const counts = new Map<string, Choice>();
	const bump = (key: string, label: string, rule: Rule): void => {
		const c = counts.get(key) ?? { label, count: 0, rule };
		c.count++;
		counts.set(key, c);
	};
	for (const f of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(f);
		const linked = new Set<string>();
		for (const l of cache?.frontmatterLinks ?? []) {
			const dest = app.metadataCache.getFirstLinkpathDest(l.link.split("#")[0] ?? l.link, f.path);
			if (!dest) continue;
			const key = l.key.replace(/\.\d+$/, "");
			linked.add(key.toLowerCase());
			bump(`${key.toLowerCase()}→${dest.path}`, `${key} → ${dest.basename}`, {
				kind: "property",
				key,
				target: dest.path,
			});
		}
		for (const [key, v] of Object.entries(cache?.frontmatter ?? {})) {
			if (
				linked.has(key.toLowerCase()) ||
				["aliases", "alias", "tags", "tag", "position"].includes(key.toLowerCase())
			)
				continue;
			for (const x of Array.isArray(v) ? v : [v])
				if (typeof x === "string" && x.trim() && x.length <= 60)
					bump(`${key.toLowerCase()}=${x.trim().toLowerCase()}`, `${key} = ${x.trim()}`, {
						kind: "property",
						key,
						value: x.trim(),
					});
		}
	}
	new Picker(app, "A property value…", [...counts.values()].sort(byCount), done).open();
};
