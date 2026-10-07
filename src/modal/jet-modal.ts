import { type App, Modal, setIcon } from "obsidian";
import { Preview, type PreviewAction } from "../preview/preview";
import { highlight } from "./format";

export type Ranges = ReadonlyArray<readonly [number, number]>;

/** One line of the result list: a group header, a result, or a recent search. */
export type Entry =
	| { type: "header"; label: string; count?: number }
	| {
			type: "item";
			path: string;
			title: string;
			titleRanges: Ranges;
			crumb: string;
			meta: string;
			icon: string;
			/** Content rows show an excerpt line; title rows do not. */
			excerpt?: { text: string; marks: Ranges; more: number } | null;
			badge?: string;
			/** What to mark in the preview, and where the excerpt's hit is. */
			hit?: { terms: readonly string[]; offset?: number };
			/** In-note search: the line to jump to and the match to select. */
			at?: { line: number; ch: number; len: number };
	  }
	| { type: "search"; query: string; detail?: string }
	/** A message line (no results), not selectable. */
	| { type: "notice"; title: string; detail?: string }
	/** Create a note named after the text (no-results screen). */
	| { type: "create"; text: string; detail?: string };

/** How to open a note. */
export type OpenHow = "default" | "other" | "split";

/** What the modal needs from the plugin. */
export type ModalHost = {
	/** The list for this text (empty text: recents); `paint` may be called again as results arrive. */
	list(text: string, paint: (entries: Entry[], status?: string) => void): void;
	open(path: string, how: OpenHow, at?: { line: number; ch: number; len: number }): void;
	/** Footer hints for the current text. */
	hints(text: string): Array<[key: string, label: string]>;
	closed(text: string, opened: boolean): void;
	placeholder: string;
	/** The preview pane's setting (⌘. toggles it). */
	previewOn(): boolean;
	setPreviewOn(on: boolean): void;
	/** Copy a link to the note (⌘L, the preview's link button). */
	copyLink(path: string): void;
	/** ⌥↵: put a link to the note where the cursor is in the note being edited. */
	insertLink(path: string): void;
	/** ⇧↵: create a note named after the text and open it. */
	create(text: string): void;
	/** The footer's settings popover, if this host has one. */
	renderSettings?(el: HTMLElement): void;
};

/** The selection rests this long before the preview renders. */
const PREVIEW_REST_MS = 80;
/** Below this width the preview hides itself. */
const NARROW_PX = 760;

/**
 * Jet's search modal: our own list, not SuggestModal, so rows are
 * reused across keystrokes, results never arrive stale and the selection stays put.
 * Fixed size so nothing jumps. Esc clears the text, then closes.
 */
export class JetModal extends Modal {
	readonly inputEl: HTMLInputElement;
	private readonly listEl: HTMLElement;
	private readonly footEl: HTMLElement;
	private readonly statusEl: HTMLElement;
	private entries: Entry[] = [];
	/** Index into `entries` of the selected row (-1: none). */
	private selected = -1;
	private selectedKey: string | null = null;
	private readonly pool: HTMLElement[] = [];
	private opened = false;
	private readonly preview: Preview;
	private previewTimer: number | null = null;
	private resize: ResizeObserver | null = null;

	constructor(
		app: App,
		private readonly host: ModalHost,
		private readonly initial = "",
	) {
		super(app);
		this.modalEl.addClass("jet-modal");
		this.modalEl.setAttr("aria-label", "Jet Search");
		this.contentEl.addClass("jet-content");
		const top = this.contentEl.createDiv({ cls: "jet-in" });
		setIcon(top.createSpan({ cls: "jet-sic" }), "search");
		this.inputEl = top.createEl("input", {
			cls: "jet-q",
			attr: {
				type: "text",
				placeholder: host.placeholder,
				spellcheck: "false",
				role: "combobox",
				"aria-expanded": "true",
				"aria-controls": "jet-list",
				"aria-autocomplete": "list",
			},
		});
		this.statusEl = top.createSpan({ cls: "jet-status" });
		const body = this.contentEl.createDiv({ cls: "jet-body" });
		this.listEl = body.createDiv({ cls: "jet-list", attr: { id: "jet-list", role: "listbox" } });
		this.preview = new Preview(app, body, (a, p) => this.act(a, p));
		this.modalEl.toggleClass("is-preview-off", !host.previewOn());
		this.footEl = this.contentEl.createDiv({ cls: "jet-ft" });

		this.inputEl.addEventListener("input", () => this.refresh());
		this.listEl.addEventListener("mousedown", (e) => e.preventDefault());
		this.listEl.addEventListener("click", (e) => {
			const row = (e.target as HTMLElement).closest<HTMLElement>(".jet-row");
			const i = row ? Number(row.dataset.index) : -1;
			if (i < 0) return;
			this.select(i);
			this.choose(e.metaKey || e.ctrlKey ? "other" : "default");
		});
		this.listEl.addEventListener("mousemove", (e) => {
			const row = (e.target as HTMLElement).closest<HTMLElement>(".jet-row");
			if (row && Number(row.dataset.index) !== this.selected) this.select(Number(row.dataset.index), false);
		});
		this.keys();
	}

	onOpen(): void {
		this.inputEl.value = this.initial;
		this.inputEl.select();
		this.refresh();
		this.inputEl.focus();
		// The modal's own window (it may be a popout): its ResizeObserver.
		const win = this.modalEl.win as Window & { ResizeObserver: typeof ResizeObserver };
		const ro = new win.ResizeObserver(() =>
			this.modalEl.toggleClass("is-narrow", this.modalEl.clientWidth < NARROW_PX),
		);
		ro.observe(this.modalEl);
		this.resize = ro;
	}

	onClose(): void {
		this.resize?.disconnect();
		if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
		this.preview.destroy();
		this.host.closed(this.inputEl.value, this.opened);
		this.contentEl.empty();
	}

	private previewShown(): boolean {
		return this.host.previewOn() && !this.modalEl.hasClass("is-narrow");
	}

	/** The selection rested: render it in the preview (only when the pane is shown). */
	private schedulePreview(): void {
		if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
		this.previewTimer = window.setTimeout(() => {
			this.previewTimer = null;
			if (!this.previewShown()) return;
			const e = this.entries[this.selected];
			if (e?.type !== "item") {
				this.preview.clear();
				return;
			}
			const file = this.app.vault.getFileByPath(e.path);
			if (!file) return;
			if (this.preview.path === e.path) return;
			void this.preview.show(file, e.hit?.terms ?? [], e.hit?.offset);
		}, PREVIEW_REST_MS);
	}

	private act(a: PreviewAction, path: string): void {
		if (a === "link") {
			this.host.copyLink(path);
			return;
		}
		this.opened = true;
		this.host.open(path, a === "split" ? "split" : "default");
		this.close();
	}

	/** Paint a list (called by the host, maybe several times per keystroke as tiers answer). */
	paint(entries: Entry[], status = ""): void {
		this.entries = entries;
		this.statusEl.setText(status);
		// The selected note stays selected if it is still listed; else the first row.
		let sel = this.selectedKey ? entries.findIndex((e) => keyOf(e) === this.selectedKey) : -1;
		if (sel < 0) sel = entries.findIndex(selectable);
		this.render();
		this.select(sel, false);
	}

	private refresh(): void {
		const text = this.inputEl.value;
		this.selectedKey = null;
		this.host.list(text, (entries, status) => {
			if (this.inputEl.value === text) this.paint(entries, status);
		});
		this.footer(text);
	}

	private footer(text: string): void {
		this.footEl.empty();
		for (const [key, label] of this.host.hints(text)) {
			const h = this.footEl.createSpan({ cls: "jet-ht" });
			h.createEl("kbd", { text: key });
			h.appendText(label);
		}
		const render = this.host.renderSettings?.bind(this.host);
		if (!render) return;
		this.footEl.createSpan({ cls: "jet-sp" });
		const btn = this.footEl.createSpan({
			cls: "jet-fbt",
			attr: { "aria-label": "Search settings", role: "button" },
		});
		setIcon(btn, "sliders-horizontal");
		btn.addEventListener("mousedown", (e) => e.preventDefault());
		btn.addEventListener("click", () => {
			const open = this.contentEl.querySelector(".jet-setp");
			if (open) {
				open.remove();
				btn.removeClass("is-on");
				return;
			}
			btn.addClass("is-on");
			render(this.contentEl.createDiv({ cls: "jet-setp" }));
		});
	}

	private render(): void {
		const list = this.listEl;
		this.entries.forEach((e, i) => {
			let el = this.pool[i];
			if (!el) {
				el = list.createDiv();
				this.pool[i] = el;
			} else if (el.parentElement !== list) list.append(el);
			fillRow(el, e, i);
		});
		// Rows beyond this list are kept for reuse, detached.
		for (let i = this.entries.length; i < this.pool.length; i++) this.pool[i]?.remove();
		if (!this.entries.length) list.scrollTop = 0;
	}

	private select(i: number, scroll = true): void {
		const prev = this.pool[this.selected];
		prev?.removeClass("is-selected");
		prev?.setAttr("aria-selected", "false");
		this.selected = i;
		const e = this.entries[i];
		const el = this.pool[i];
		if (!e || !el || !selectable(e)) {
			this.selectedKey = null;
			this.inputEl.removeAttribute("aria-activedescendant");
			return;
		}
		this.selectedKey = keyOf(e);
		this.schedulePreview();
		el.addClass("is-selected");
		el.setAttr("aria-selected", "true");
		this.inputEl.setAttr("aria-activedescendant", el.id);
		if (scroll) el.scrollIntoView({ block: "nearest" });
	}

	private move(step: number): void {
		const n = this.entries.length;
		if (!n) return;
		let i = this.selected;
		for (let k = 0; k < n; k++) {
			i = (i + step + n) % n;
			const e = this.entries[i];
			if (e && selectable(e)) {
				this.select(i);
				return;
			}
		}
	}

	private choose(how: OpenHow): void {
		const e = this.entries[this.selected];
		if (!e) return;
		if (e.type === "search") {
			this.inputEl.value = e.query;
			this.refresh();
			return;
		}
		if (e.type === "create") {
			this.opened = true;
			this.host.create(e.text);
			this.close();
			return;
		}
		if (e.type !== "item") return;
		this.opened = true;
		this.host.open(e.path, how, e.at);
		this.close();
	}

	private keys(): void {
		// Our Escape replaces the Modal's: it clears the text first, then closes.
		const scope = this.scope as unknown as { keys?: Array<{ key: string | null }>; unregister(h: unknown): void };
		const escapes = (scope.keys ?? []).filter((k) => k.key === "Escape");
		for (const k of escapes) scope.unregister(k);
		this.scope.register([], "Escape", () => {
			if (this.inputEl.value) {
				this.inputEl.value = "";
				this.refresh();
			} else this.close();
			return false;
		});
		this.scope.register([], "ArrowDown", () => {
			this.move(1);
			return false;
		});
		this.scope.register([], "ArrowUp", () => {
			this.move(-1);
			return false;
		});
		this.scope.register(["Ctrl"], "n", () => {
			this.move(1);
			return false;
		});
		this.scope.register(["Ctrl"], "p", () => {
			this.move(-1);
			return false;
		});
		this.scope.register([], "Enter", (e) => {
			if (!e.isComposing) this.choose("default");
			return false;
		});
		this.scope.register(["Mod"], "Enter", () => {
			this.choose("other");
			return false;
		});
		this.scope.register(["Mod", "Alt"], "Enter", () => {
			this.choose("split");
			return false;
		});
		this.scope.register(["Mod"], "g", () => {
			this.preview.step(1);
			return false;
		});
		this.scope.register(["Mod", "Shift"], "g", () => {
			this.preview.step(-1);
			return false;
		});
		this.scope.register(["Alt"], "ArrowDown", () => {
			this.preview.scroll(1);
			return false;
		});
		this.scope.register(["Alt"], "ArrowUp", () => {
			this.preview.scroll(-1);
			return false;
		});
		this.scope.register(["Mod"], ".", () => {
			const on = !this.host.previewOn();
			this.host.setPreviewOn(on);
			this.modalEl.toggleClass("is-preview-off", !on);
			this.preview.path = null;
			if (on) this.schedulePreview();
			return false;
		});
		this.scope.register(["Mod"], "l", () => {
			const e = this.entries[this.selected];
			if (e?.type === "item") this.host.copyLink(e.path);
			return false;
		});
		this.scope.register(["Alt"], "Enter", () => {
			const e = this.entries[this.selected];
			if (e?.type !== "item") return false;
			this.opened = true;
			this.host.insertLink(e.path);
			this.close();
			return false;
		});
		this.scope.register(["Shift"], "Enter", () => {
			const text = this.inputEl.value.trim();
			if (!text) return false;
			this.opened = true;
			this.host.create(text);
			this.close();
			return false;
		});
	}
}

const selectable = (e: Entry): boolean => e.type !== "header" && e.type !== "notice";
const keyOf = (e: Entry): string | null =>
	e.type === "item"
		? `n:${e.path}${e.at ? `:${e.at.line}` : ""}`
		: e.type === "search"
			? `s:${e.query}`
			: e.type === "create"
				? `c:${e.text}`
				: null;

/** Fill a pooled row element for an entry (rebuilt each time: rows are few and small). */
const fillRow = (el: HTMLElement, e: Entry, i: number): void => {
	el.replaceChildren();
	el.className = "";
	el.dataset.index = String(i);
	el.id = `jet-row-${i}`;
	if (e.type === "header") {
		el.className = "jet-h";
		el.removeAttribute("role");
		el.createSpan({ text: e.label });
		if (e.count !== undefined) el.createSpan({ cls: "jet-hs", text: String(e.count) });
		return;
	}
	if (e.type === "notice") {
		el.className = "jet-notice";
		el.removeAttribute("role");
		setIcon(el.createSpan({ cls: "jet-ic" }), "search-x");
		const b = el.createDiv({ cls: "jet-rb" });
		b.createDiv({ cls: "jet-nt", text: e.title });
		if (e.detail) b.createDiv({ cls: "jet-nd", text: e.detail });
		return;
	}
	el.setAttr("role", "option");
	el.setAttr("aria-selected", "false");
	if (e.type === "search" || e.type === "create") {
		el.className = `jet-row ${e.detail ? "jet-rowt" : "jet-row-search"}`;
		setIcon(el.createSpan({ cls: "jet-ic" }), e.type === "create" ? "file-plus" : e.detail ? "search" : "history");
		const b = el.createDiv({ cls: "jet-rb" });
		const label = e.type === "create" ? `Create “${e.text}”` : e.detail ? `Search for “${e.query}”` : e.query;
		b.createDiv({ cls: "jet-l1" }).createSpan({ cls: "jet-rt", text: label });
		if (e.detail) b.createDiv({ cls: "jet-l2" }).createSpan({ cls: "jet-cr", text: e.detail });
		return;
	}
	const content = !!e.excerpt;
	el.className = content ? "jet-row jet-rowc" : "jet-row jet-rowt";
	setIcon(el.createSpan({ cls: "jet-ic" }), e.icon);
	const body = el.createDiv({ cls: "jet-rb" });
	const l1 = body.createDiv({ cls: "jet-l1" });
	highlight(l1.createSpan({ cls: "jet-rt" }), e.title, e.titleRanges, "jet-th");
	if (e.badge) l1.createSpan({ cls: "jet-bdg", text: e.badge });
	l1.createSpan({ cls: "jet-rm", text: e.meta });
	const l2 = body.createDiv({ cls: "jet-l2" });
	if (e.crumb) l2.createSpan({ cls: "jet-cr", text: e.crumb });
	if (e.excerpt) {
		if (e.excerpt.more) l2.createSpan({ cls: "jet-more", text: `+${e.excerpt.more} more` });
		highlight(body.createDiv({ cls: "jet-l3" }), e.excerpt.text, e.excerpt.marks, "jet-mark", "mark");
	}
};
