import { type App, type TFile } from "obsidian";
import { type JetData, groupRecents, rememberSearch } from "./data";
import { age, crumb, titleOf } from "./modal/format";
import type { Entry, ModalHost, OpenHow } from "./modal/jet-modal";

/** The icon for a note, by its `type` property: email, project, otherwise a page. */
export const iconOf = (app: App, file: TFile): string => {
	const type: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.type;
	if (type === "email") return "mail";
	if (type === "project" || type === "area") return "folder-kanban";
	if (type === "meeting") return "users";
	if (type === "journal") return "calendar-days";
	return "file-text";
};

/**
 * What the modal shows: recents and recent searches when the text is empty. Typing is served
 * by the name matcher and the worker from later slices; until then, names that contain the text.
 */
export class JetHost implements ModalHost {
	readonly placeholder = "Search notes…";

	constructor(
		private readonly app: App,
		private readonly data: () => JetData,
		private readonly save: () => void,
		private readonly newTab: () => boolean,
	) {}

	list(text: string, paint: (entries: Entry[], status?: string) => void): void {
		if (!text.trim()) {
			paint(this.recents());
			return;
		}
		const t = text.trim().toLowerCase();
		const now = Date.now();
		const entries: Entry[] = this.app.vault
			.getMarkdownFiles()
			.filter((f) => f.basename.toLowerCase().includes(t))
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, 50)
			.map((f) => this.item(f, now));
		paint(entries.length ? [{ type: "header", label: "Titles", count: entries.length }, ...entries] : []);
	}

	recents(): Entry[] {
		const now = Date.now();
		const vault = this.app.vault;
		const out: Entry[] = [];
		const searches = this.data().searches.slice(0, 3);
		if (searches.length) {
			out.push({ type: "header", label: "Recent searches" });
			for (const q of searches) out.push({ type: "search", query: q });
		}
		const groups = groupRecents(
			this.data(),
			this.app.workspace.getLastOpenFiles().filter((p) => p.endsWith(".md")),
			(p) => vault.getFileByPath(p)?.stat.mtime ?? 0,
			(p) => p.endsWith(".md") && !!vault.getFileByPath(p),
			now,
		);
		for (const g of groups) {
			out.push({ type: "header", label: g.label });
			for (const it of g.items) {
				const f = vault.getFileByPath(it.path);
				if (f) out.push({ ...this.item(f, now), meta: age(it.at, now) });
			}
		}
		return out;
	}

	item(
		file: TFile,
		now: number,
		extra: Partial<Extract<Entry, { type: "item" }>> = {},
	): Extract<Entry, { type: "item" }> {
		return {
			type: "item",
			path: file.path,
			title: titleOf(file.path),
			titleRanges: [],
			crumb: crumb(file.path),
			meta: age(file.stat.mtime, now),
			icon: iconOf(this.app, file),
			...extra,
		};
	}

	open(path: string, how: OpenHow): void {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		const ws = this.app.workspace;
		const leaf =
			how === "split" ? ws.getLeaf("split") : ws.getLeaf((how === "other") !== this.newTab() ? "tab" : false);
		void leaf.openFile(file);
	}

	hints(text: string): Array<[string, string]> {
		const t = text.trim();
		return t
			? [
					["↵", "Open"],
					["⌘↵", this.newTab() ? "Same tab" : "New tab"],
					["⌘⌥↵", "Split"],
					["Esc", "Clear"],
				]
			: [
					["↵", "Open"],
					["↑↓", "Choose"],
					["Esc", "Close"],
				];
	}

	closed(text: string, opened: boolean): void {
		if (opened) rememberSearch(this.data(), text);
		this.save();
	}
}
