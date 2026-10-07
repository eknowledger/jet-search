import { type App, MarkdownView, normalizePath, Notice, type TFile } from "obsidian";
import { type JetData, groupRecents, rememberSearch } from "./data";
import { age, crumb, titleOf } from "./modal/format";
import type { Entry, ModalHost, OpenHow } from "./modal/jet-modal";
import type { Search } from "./search";

/** The icon for a note, by its `type` property: email, project, otherwise a page. */
export const iconOf = (app: App, file: TFile): string => {
	const type: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.type;
	if (type === "email") return "mail";
	if (type === "project" || type === "area") return "folder-kanban";
	if (type === "meeting") return "users";
	if (type === "journal") return "calendar-days";
	return "file-text";
};

/** What the modal shows: recents and recent searches with no text, else the search's answers. */
export class JetHost implements ModalHost {
	readonly placeholder = "Search notes…";

	constructor(
		private readonly app: App,
		private readonly data: () => JetData,
		private readonly save: () => void,
		private readonly newTab: () => boolean,
		private readonly search: () => Search,
	) {}

	list(text: string, paint: (entries: Entry[], status?: string) => void): void {
		if (!text.trim()) {
			paint(this.recents());
			return;
		}
		this.search().list(text, paint);
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
		const short = t.length > 18 ? `${t.slice(0, 17)}…` : t;
		return t
			? [
					["↵", "Open"],
					["⌘↵", this.newTab() ? "Same tab" : "New tab"],
					["⌥↵", "Insert link"],
					["⇧↵", `Create “${short}”`],
					["⌘.", "Preview"],
				]
			: [
					["↵", "Open"],
					["↑↓", "Choose"],
					["⌘L", "Copy link"],
					["Esc", "Close"],
				];
	}

	previewOn(): boolean {
		return this.data().settings.preview;
	}

	setPreviewOn(on: boolean): void {
		this.data().settings.preview = on;
		this.save();
	}

	copyLink(path: string): void {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		const link = this.app.fileManager.generateMarkdownLink(file, this.app.workspace.getActiveFile()?.path ?? "");
		void navigator.clipboard.writeText(link).then(() => new Notice("Link copied"));
	}

	insertLink(path: string): void {
		const file = this.app.vault.getFileByPath(path);
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!file || !view?.file) {
			new Notice("Open a note to insert a link into");
			return;
		}
		view.editor.replaceSelection(this.app.fileManager.generateMarkdownLink(file, view.file.path));
	}

	create(text: string): void {
		const name = text
			.replace(/[\\/:*?"<>|#^[\]]/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 120);
		if (!name) return;
		const active = this.app.workspace.getActiveFile()?.path ?? "";
		const folder = this.app.fileManager.getNewFileParent(active).path;
		const path = normalizePath(`${folder === "/" ? "" : `${folder}/`}${name}.md`);
		const existing = this.app.vault.getFileByPath(path);
		void (async () => {
			const file = existing ?? (await this.app.vault.create(path, ""));
			await this.app.workspace.getLeaf(this.newTab() ? "tab" : false).openFile(file);
		})().catch((e: unknown) => {
			console.error("Jet Search: could not create the note", e);
			new Notice("Jet Search: could not create the note");
		});
	}

	closed(text: string, opened: boolean): void {
		if (opened) rememberSearch(this.data(), text);
		this.search().idle();
		this.save();
	}
}
