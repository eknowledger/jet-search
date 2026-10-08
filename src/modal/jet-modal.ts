import { type App, Menu, Modal, setIcon } from "obsidian";
import { type Filter, filterLabel, filterText, type Found, sameFilter, withoutPieces } from "../filters/filter";
import { Preview, type PreviewAction } from "../preview/preview";
import { highlight } from "./format";

export type Ranges = ReadonlyArray<readonly [number, number]>;

/** One line of the result list: a group header, a result, or a recent search. */
export type Entry =
	/** `note`: where the search runs ("in Cobalt", "everywhere"), set by the modal. */
	| { type: "header"; label: string; count?: number; note?: string }
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
	| { type: "create"; text: string; detail?: string }
	/** Search the same text everywhere (nothing in the scope). */
	| { type: "widen"; label: string; detail?: string };

/** A scope as the modal shows it: its chip, banner and hints. */
export type ScopeView = { id: string; name: string; kind: string; members: number };

/** What a typed text says about scopes (the parser). */
export type Typed = {
	/** A name at the start, then more text: `at` is where the name starts in the text. */
	suggest?: { scope: ScopeView; others: ScopeView[]; name: string; rest: string; at: number };
	/** The name alone. */
	hint?: ScopeView;
	/** `in:name` or `@name`; `complete` once a space follows it (or it is quoted). */
	applied?: { scope: ScopeView; text: string; complete: boolean };
	/** The suggested (or hinted) scope is on Auto and may apply at once. */
	auto?: boolean;
};

/** The chip's card: its rules with counts. */
export type ScopeCard = {
	name: string;
	kind: string;
	mode: string;
	all?: boolean;
	rules: Array<{ icon: string; text: string; count: number }>;
	total: number;
	aliases: string[];
};

/** What the footer hints depend on, besides the text. */
export type HintState = {
	suggest?: string;
	hint?: string;
	chip?: string;
	selected?: true;
	/** The chip was applied by Auto just now: ⌫ undoes it. */
	auto?: true;
	/** Other scopes share the chip's name: ⇥ moves to the next. */
	more?: true;
	/** The search was widened from this scope: ⇧⇧ goes back. */
	widened?: string;
};

/** How to open a note. */
export type OpenHow = "default" | "other" | "split";

/** What the modal needs from the plugin. */
export type ModalHost = {
	/**
	 * The list for this text (empty text: recents), inside the scope `scope` when a chip is applied;
	 * `paint` may be called again as results arrive.
	 */
	list(
		text: string,
		paint: (entries: Entry[], status?: string) => void,
		scope?: string,
		filters?: readonly Filter[],
	): void;
	open(path: string, how: OpenHow, at?: { line: number; ch: number; len: number }): void;
	/** Footer hints for the current text and scope state. */
	hints(text: string, state?: HintState): Array<[key: string, label: string]>;
	/** The modal closed: its text, whether a note was opened, and the chip's scope if one was applied. */
	closed(text: string, opened: boolean, scope?: ScopeView, filters?: readonly Filter[]): void;
	placeholder: string;
	/** The preview pane's setting (⌘. toggles it). */
	previewOn(): boolean;
	setPreviewOn(on: boolean): void;
	/** Copy a link to the note (⌘L, the preview's link button). */
	copyLink(path: string): void;
	/** ⌥↵: put a link to the note where the cursor is in the note being edited. */
	insertLink(path: string): void;
	/** ⇧↵: create a note named after the text and open it, in the chip's scope if any. */
	create(text: string, scope?: string): void;
	/** The footer's settings popover, if this host has one. */
	renderSettings?(el: HTMLElement): void;
	/** Scopes typed in the box; absent when there are none. */
	scopes?: {
		typed(text: string): Typed;
		card(id: string): ScopeCard;
		/** Open the scope's settings. */
		edit(id: string): void;
	};
	/** Filters typed in the box or picked in the bar; absent: no filters. */
	filters?: {
		/** The filters in the text (links resolved), where each is and whether it is finished. */
		find(text: string): Found[];
		/** A property's values with their note counts, inside the scope and filters (most first). */
		values(key: string, scope?: string, filters?: readonly Filter[]): Array<[value: string, notes: number]>;
		tags(scope?: string, filters?: readonly Filter[]): Array<[tag: string, notes: number]>;
		/** Property keys your notes use, with their note counts. */
		keys(): Array<[key: string, notes: number]>;
		/** Every scope, for the bar's In menu. */
		scopes(): ScopeView[];
	};
};

/** The selection rests this long before the preview renders. */
const PREVIEW_REST_MS = 80;
/** Below this width the preview hides itself. */
const NARROW_PX = 760;
/** Hovering the chip this long opens its card; leaving it this long closes it. */
const CARD_OPEN_MS = 250;
const CARD_CLOSE_MS = 200;

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
	// Scopes: the applied chip, what the text says, and their elements.
	private chip: ScopeView | null = null;
	private chipSelected = false;
	/** The scopes sharing the chip's name (⇥ cycles them); just the chip otherwise. */
	private choices: ScopeView[] = [];
	/** Auto applied the chip just now: ⌫ at the start undoes it. */
	private autoUndo = false;
	/** Scopes whose Auto was undone in this search: suggested from then on. */
	private readonly suppressAuto = new Set<string>();
	/** Widened from a chip (⇧⇧): ⇧⇧ again puts it back. */
	private widened: { chip: ScopeView; choices: ScopeView[] } | null = null;
	/** Between onOpen and onClose. */
	shown = false;
	// Filters: chips after the scope's, the last one selected by ⌫, and the bar.
	private filters: Filter[] = [];
	private filterSel = false;
	private readonly fchipsEl: HTMLElement;
	private readonly barEl: HTMLElement;
	/** Each list request; a paint for an older one is dropped. */
	private listSeq = 0;
	private typing: Typed = {};
	private readonly chipEl: HTMLElement;
	private readonly chipLabel: HTMLElement;
	private readonly ghostEl: HTMLElement;
	private readonly ihintEl: HTMLElement;
	private readonly bannerEl: HTMLElement;
	private cardEl: HTMLElement | null = null;
	private cardTimer: number | null = null;
	private measureCtx: CanvasRenderingContext2D | null | undefined;

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
		this.chipEl = top.createSpan({ cls: "jet-chip is-hidden" });
		this.chipLabel = this.chipEl.createSpan({ cls: "jet-chl" });
		const x = this.chipEl.createSpan({ cls: "jet-chx", attr: { "aria-label": "Remove scope", role: "button" } });
		setIcon(x, "x");
		this.fchipsEl = top.createSpan({ cls: "jet-fchips" });
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
		this.ghostEl = top.createSpan({ cls: "jet-ghostbox is-hidden" });
		this.ihintEl = top.createSpan({ cls: "jet-ihint is-hidden" });
		this.statusEl = top.createSpan({ cls: "jet-status" });
		if (host.filters) {
			const fb = top.createSpan({ cls: "jet-fbtn", attr: { "aria-label": "Filters (⌘F)", role: "button" } });
			setIcon(fb, "list-filter");
			fb.addEventListener("mousedown", (e) => e.preventDefault());
			fb.addEventListener("click", () => this.toggleBar());
		}
		this.barEl = this.contentEl.createDiv({ cls: "jet-fbar is-hidden" });

		const body = this.contentEl.createDiv({ cls: "jet-body" });
		this.listEl = body.createDiv({ cls: "jet-list", attr: { id: "jet-list", role: "listbox" } });
		// The banner sits above the rows while a scope is suggested; detached otherwise.
		this.bannerEl = this.listEl.createDiv({ cls: "jet-ban" });
		this.bannerEl.remove();
		this.preview = new Preview(app, body, (a, p) => this.act(a, p));
		this.modalEl.toggleClass("is-preview-off", !host.previewOn());
		this.footEl = this.contentEl.createDiv({ cls: "jet-ft" });

		this.inputEl.addEventListener("input", () => {
			this.chipSelected = false;
			this.filterSel = false;
			this.autoUndo = false;
			this.refresh();
		});
		this.inputEl.addEventListener("scroll", () => this.placeGhost());
		// Any key but the chip's own keeps the chip and unselects it.
		this.inputEl.addEventListener("keydown", (e) => {
			if ((!this.chipSelected && !this.filterSel) || CHIP_KEYS.has(e.key)) return;
			this.chipSelected = false;
			this.filterSel = false;
			this.hideCard();
			this.drawScope();
			this.footer(this.inputEl.value);
		});
		this.chipEl.addEventListener("mousedown", (e) => e.preventDefault());
		x.addEventListener("click", (e) => {
			e.stopPropagation();
			this.removeChip(false);
		});
		this.chipLabel.addEventListener("click", () => (this.cardEl ? this.hideCard() : this.showCard()));
		this.chipEl.addEventListener("mouseenter", () => this.cardSoon(true));
		this.chipEl.addEventListener("mouseleave", () => this.cardSoon(false));
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
		this.shown = true;
		this.inputEl.value = this.initial;
		this.inputEl.select();
		this.refresh(true);
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
		this.shown = false;
		this.resize?.disconnect();
		if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
		this.preview.destroy();
		if (this.cardTimer !== null) window.clearTimeout(this.cardTimer);
		this.host.closed(this.inputEl.value, this.opened, this.chip ?? undefined, this.filters);
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
		// The first header says where the search runs (inside the chip's scope, or everywhere while one
		// is suggested) and how many filters narrow it.
		const n = this.filters.length;
		const where = this.chip ? `in ${this.chip.name}` : this.typing.suggest ? "everywhere" : "";
		const note = [where, n ? `${n} filter${n === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ") || undefined;
		const h = entries.findIndex((e) => e.type === "header");
		const first = entries[h];
		if (note && first?.type === "header") entries = entries.map((e, i) => (i === h ? { ...first, note } : e));
		this.entries = entries;
		this.statusEl.setText(status);
		// The selected note stays selected if it is still listed; else the first row.
		let sel = this.selectedKey ? entries.findIndex((e) => keyOf(e) === this.selectedKey) : -1;
		if (sel < 0) sel = entries.findIndex(selectable);
		this.render();
		this.select(sel, false);
	}

	/**
	 * The text changed: what it says about scopes, then its list. `final`: the text was set whole (a
	 * recent search, the prefill), so an explicit `in:name` at its end applies without a space after it.
	 */
	private refresh(final = false): void {
		let raw = this.inputEl.value;
		// Filters first: finished ones become chips; unfinished ones are left out of the search.
		let pending: Found[] = [];
		if (this.host.filters) {
			const found = this.host.filters.find(raw);
			const done = found.filter((f) => f.complete || final);
			if (done.length) {
				for (const d of done)
					if (!this.filters.some((x) => sameFilter(x, d.filter))) this.filters.push(d.filter);
				raw = withoutPieces(raw, done);
				this.inputEl.value = raw;
				this.inputEl.setSelectionRange(raw.length, raw.length);
				pending = this.host.filters.find(raw).filter((f) => !f.complete);
			} else pending = found;
		}
		this.drawFilters();
		this.typing = {};
		if (!this.chip && this.host.scopes) {
			const t = this.host.scopes.typed(raw);
			if (t.applied && (t.applied.complete || final)) {
				this.applyChip(t.applied.scope, t.applied.text);
				return;
			}
			// Auto: once a space follows the name, the scope applies without Tab.
			const auto = t.auto ? (t.suggest?.scope ?? t.hint) : undefined;
			if (auto && !this.suppressAuto.has(auto.id)) {
				const s = t.suggest;
				const spaced = s ? /\s/u.test(raw[s.at + s.name.length] ?? "") : /\s$/u.test(raw);
				if (spaced) {
					this.applyChip(auto, s?.rest ?? "");
					this.autoUndo = true;
					this.drawScope();
					this.footer(this.inputEl.value);
					return;
				}
			}
			if (!t.applied) this.typing = t;
		}
		this.drawScope();
		const shown = this.inputEl.value;
		const text = pending.length ? withoutPieces(shown, pending) : shown;
		const scope = this.chip?.id;
		this.selectedKey = null;
		const seq = ++this.listSeq;
		this.host.list(
			text,
			(entries, status) => {
				if (seq === this.listSeq) this.paint(entries, status);
			},
			scope,
			[...this.filters],
		);
		this.footer(shown);
	}

	// ── Filters ────────────────────────────────────

	private drawFilters(): void {
		this.fchipsEl.empty();
		this.filters.forEach((f, i) => {
			const [head, value] = filterLabel(f);
			const last = i === this.filters.length - 1;
			const c = this.fchipsEl.createSpan({ cls: `jet-fchip${last && this.filterSel ? " is-selected" : ""}` });
			if (head) c.createSpan({ cls: "jet-fh", text: head });
			c.createSpan({ cls: "jet-fv", text: value });
			const x = c.createSpan({ cls: "jet-chx", attr: { "aria-label": "Remove filter", role: "button" } });
			setIcon(x, "x");
			c.addEventListener("mousedown", (e) => e.preventDefault());
			x.addEventListener("click", () => {
				this.filters = this.filters.filter((y) => y !== f);
				this.filterSel = false;
				this.refresh();
			});
		});
		this.drawBar();
	}

	private addFilter(f: Filter): void {
		if (!this.filters.some((x) => sameFilter(x, f))) this.filters.push(f);
		this.filterSel = false;
		this.refresh();
		this.inputEl.focus();
	}

	/** ⌘F or the filter icon: the bar (Title only, In, Type, Tags, Edited, + Filter, Clear). */
	private toggleBar(): void {
		this.barEl.toggleClass("is-hidden", !this.barEl.hasClass("is-hidden"));
		this.modalEl.toggleClass("has-fbar", !this.barEl.hasClass("is-hidden"));
		this.drawBar();
		this.inputEl.focus();
	}

	private drawBar(): void {
		const f = this.host.filters;
		const bar = this.barEl;
		if (!f || bar.hasClass("is-hidden")) return;
		bar.empty();
		const button = (label: string, icon: string, on: boolean, click: (el: HTMLElement) => void): void => {
			const b = bar.createSpan({ cls: `jet-fb${on ? " is-on" : ""}`, attr: { role: "button" } });
			setIcon(b.createSpan({ cls: "jet-fbi" }), icon);
			b.appendText(label);
			b.addEventListener("mousedown", (e) => e.preventDefault());
			b.addEventListener("click", () => click(b));
		};
		const menu = (el: HTMLElement, items: Array<[string, () => void]>): void => {
			const m = new Menu();
			if (!items.length) m.addItem((i) => i.setTitle("Nothing to pick here"));
			for (const [title, run] of items) m.addItem((i) => i.setTitle(title).onClick(run));
			const r = el.getBoundingClientRect();
			m.showAtPosition({ x: r.left, y: r.bottom + 4 });
		};
		const scope = this.chip?.id;
		const title = this.filters.some((x) => x.kind === "title");
		button("Title only", "type", title, () =>
			title
				? ((this.filters = this.filters.filter((x) => x.kind !== "title")), this.refresh())
				: this.addFilter({ kind: "title" }),
		);
		button(this.chip ? `In: ${this.chip.name}` : "In", "scan-search", !!this.chip, (el) =>
			menu(
				el,
				f
					.scopes()
					.map((v) => [
						`${v.name}${v.kind ? ` · ${v.kind}` : ""} · ${v.members}`,
						() => this.applyChip(v, this.inputEl.value),
					]),
			),
		);
		if (f.keys().some(([k]) => k.toLowerCase() === "type"))
			button(
				"Type",
				"shapes",
				this.filters.some((x) => x.kind === "prop" && x.key.toLowerCase() === "type"),
				(el) =>
					menu(
						el,
						f
							.values("type", scope, this.filters)
							.map(([v, n]) => [
								`${v} · ${n}`,
								() => this.addFilter({ kind: "prop", key: "type", value: v }),
							]),
					),
			);
		button(
			"Tags",
			"hash",
			this.filters.some((x) => x.kind === "tag"),
			(el) =>
				menu(
					el,
					f
						.tags(scope, this.filters)
						.map(([t, n]) => [`${t} · ${n}`, () => this.addFilter({ kind: "tag", tag: t })]),
				),
		);
		button(
			"Edited",
			"calendar",
			this.filters.some((x) => x.kind === "edited"),
			(el) =>
				menu(
					el,
					(
						[
							["Today", 1],
							["Past 7 days", 7],
							["Past 30 days", 30],
							["Past 90 days", 90],
						] as Array<[string, number]>
					).map(([t, days]) => [t, () => this.addFilter({ kind: "edited", days })]),
				),
		);
		button("Filter", "plus", false, (el) =>
			menu(
				el,
				f.keys().map(([k, n]) => [
					`${k} · ${n}`,
					() => {
						const v = this.inputEl.value;
						this.inputEl.value = `${v ? `${v} ` : ""}${k}:`;
						this.inputEl.focus();
						this.refresh();
					},
				]),
			),
		);
		bar.createSpan({ cls: "jet-sp" });
		if (this.filters.length || this.chip)
			button("Clear", "x", false, () => {
				this.filters = [];
				this.filterSel = false;
				this.chip = null;
				this.choices = [];
				this.refresh();
			});
	}

	// ── Scopes ─────────────────────────────────────

	/** Tab, `in:name` or a recent search: the scope becomes the chip; the box keeps the rest. */
	private applyChip(scope: ScopeView, text: string, choices: ScopeView[] = [scope]): void {
		this.chip = scope;
		this.choices = choices;
		this.widened = null;
		this.autoUndo = false;
		this.chipSelected = false;
		this.hideCard();
		this.inputEl.value = text;
		this.inputEl.setSelectionRange(text.length, text.length);
		this.refresh();
	}

	/** × keeps the text; the second ⌫ puts the name back in front of it, as you typed it. */
	private removeChip(nameBack: boolean): void {
		const chip = this.chip;
		if (!chip) return;
		this.chip = null;
		this.choices = [];
		this.autoUndo = false;
		this.chipSelected = false;
		this.hideCard();
		if (nameBack) {
			this.inputEl.value = `${chip.name} ${this.inputEl.value}`;
			this.inputEl.setSelectionRange(chip.name.length + 1, chip.name.length + 1);
		}
		this.refresh();
	}

	/** ⇥ again, or ⇧⇥: the next (or previous) scope of the chip's name. */
	private cycle(step: number): void {
		const n = this.choices.length;
		const i = this.chip ? this.choices.findIndex((c) => c.id === this.chip?.id) : -1;
		const next = this.choices[(i + step + n) % n];
		if (!next || i < 0) return;
		this.chip = next;
		this.refresh();
	}

	/**
	 * ⇧⇧ while open: with a chip, drop it and search the same text everywhere; after
	 * that, put it back. False when there is nothing to widen (⇧⇧ then does what it always does).
	 */
	widen(): boolean {
		if (this.chip) {
			this.widened = { chip: this.chip, choices: this.choices };
			this.chip = null;
			this.choices = [];
			this.chipSelected = false;
			this.autoUndo = false;
			this.hideCard();
			this.refresh();
			return true;
		}
		const w = this.widened;
		if (!w) return false;
		this.widened = null;
		this.chip = w.chip;
		this.choices = w.choices;
		this.refresh();
		return true;
	}

	private drawScope(): void {
		const chip = this.chip;
		this.chipEl.toggleClass("is-hidden", !chip);
		this.chipEl.toggleClass("is-selected", !!chip && this.chipSelected);
		this.chipLabel.setText(
			chip ? (this.choices.length > 1 && chip.kind ? `${chip.name} · ${chip.kind}` : chip.name) : "",
		);
		this.inputEl.placeholder = chip ? `Search in ${chip.name}…` : this.host.placeholder;
		const hint = !chip ? this.typing.hint : undefined;
		this.ihintEl.toggleClass("is-hidden", !hint);
		this.ihintEl.empty();
		if (hint) {
			this.ihintEl.createEl("kbd", { text: "⇥" });
			this.ihintEl.appendText(`Search in ${hint.name}`);
		}
		this.drawBanner();
		this.placeGhost();
		if (!chip) this.hideCard();
	}

	/** The banner above the rows: widened, Auto's undo, the scopes of one name, or the suggestion. */
	private drawBanner(): void {
		const b = this.bannerEl;
		const chip = this.chip;
		const s = this.typing.suggest;
		const keys = (pairs: Array<[string, string]>): void => {
			const k = b.createSpan({ cls: "jet-bk" });
			for (const [key, label] of pairs) {
				k.createEl("kbd", { text: key });
				k.appendText(label);
			}
		};
		const head = (icon: string): HTMLElement => {
			setIcon(b.createSpan({ cls: "jet-bic" }), icon);
			return b.createSpan({ cls: "jet-bt" });
		};
		const pills = (all: ScopeView[], active: string | null): void => {
			const row = b.createDiv({ cls: "jet-pills" });
			for (const v of all)
				row.createSpan({
					cls: `jet-pill${v.id === active ? " is-active" : ""}`,
					text: `${v.name} · ${v.kind || "Scope"} · ${v.members.toLocaleString()}`,
				});
		};
		const notes = (n: number): string => `${n.toLocaleString()} note${n === 1 ? "" : "s"}`;
		b.empty();
		b.removeClass("is-multi");
		if (!chip && this.widened) {
			const t = head("globe");
			t.appendText("Searching everywhere · was in ");
			t.createEl("b", { text: this.widened.chip.name });
			keys([["⇧⇧", "Back"]]);
		} else if (chip && this.autoUndo) {
			const t = head("undo-2");
			t.appendText("Scoped to ");
			t.createEl("b", { text: chip.name });
			t.appendText(" · Auto");
			keys([["⌫", "Undo"]]);
		} else if (chip && this.choices.length > 1) {
			b.addClass("is-multi");
			head("scan-search").appendText(
				`${this.choices.length} scopes are named “${chip.name}”`.replace(/^2 /, "Two "),
			);
			keys([
				["⇥", "next"],
				["⇧⇥", "back"],
			]);
			pills(this.choices, chip.id);
		} else if (s && s.others.length) {
			b.addClass("is-multi");
			const all = [s.scope, ...s.others];
			head("scan-search").appendText(`${all.length} scopes are named “${s.scope.name}”`.replace(/^2 /, "Two "));
			keys([["⇥", "Tab"]]);
			pills(all, null);
		} else if (s) {
			const t = head("scan-search");
			t.appendText("Search in ");
			t.createEl("b", { text: s.scope.name });
			t.appendText(` for “${s.rest}” · ${notes(s.scope.members)}`);
			keys([["⇥", "Tab"]]);
		} else {
			b.remove();
			return;
		}
		if (b.parentElement !== this.listEl) this.listEl.prepend(b);
	}

	/** A dashed box around the typed name; the text itself does not move. */
	private placeGhost(): void {
		const s = this.typing.suggest;
		this.ghostEl.toggleClass("is-hidden", !s);
		if (!s) return;
		const raw = this.inputEl.value;
		const left = this.inputEl.offsetLeft + this.textWidth(raw.slice(0, s.at)) - this.inputEl.scrollLeft;
		this.ghostEl.style.left = `${left - 5}px`;
		this.ghostEl.style.width = `${this.textWidth(raw.slice(s.at, s.at + s.name.length)) + 10}px`;
	}

	private textWidth(text: string): number {
		if (this.measureCtx === undefined) {
			const canvas = this.contentEl.createEl("canvas");
			canvas.remove();
			this.measureCtx = canvas.getContext?.("2d") ?? null;
		}
		const ctx = this.measureCtx;
		if (!ctx) return text.length * 9;
		const cs = this.inputEl.win.getComputedStyle(this.inputEl);
		ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
		return ctx.measureText(text).width;
	}

	private hintState(): HintState {
		const c = this.chip;
		if (c) {
			const st: HintState = { chip: c.name };
			if (this.chipSelected) st.selected = true;
			if (this.autoUndo) st.auto = true;
			if (this.choices.length > 1) st.more = true;
			return st;
		}
		if (this.widened) return { widened: this.widened.chip.name };
		if (this.typing.suggest) return { suggest: this.typing.suggest.scope.name };
		if (this.typing.hint) return { hint: this.typing.hint.name };
		return {};
	}

	private cardSoon(open: boolean): void {
		if (this.cardTimer !== null) window.clearTimeout(this.cardTimer);
		this.cardTimer = window.setTimeout(
			() => {
				this.cardTimer = null;
				if (open) this.showCard();
				else this.hideCard();
			},
			open ? CARD_OPEN_MS : CARD_CLOSE_MS,
		);
	}

	/** The chip's rules with counts, under the chip. */
	private showCard(): void {
		const chip = this.chip;
		if (!chip || !this.host.scopes || this.cardEl) return;
		const c = this.host.scopes.card(chip.id);
		const card = this.chipEl.parentElement?.createDiv({ cls: "jet-card" });
		if (!card) return;
		this.cardEl = card;
		card.style.left = `${this.chipEl.offsetLeft}px`;
		card.addEventListener("mousedown", (e) => e.preventDefault());
		card.addEventListener("mouseenter", () => this.cardSoon(true));
		card.addEventListener("mouseleave", () => this.cardSoon(false));
		const h = card.createDiv({ cls: "jet-c1", text: c.name });
		h.createSpan({ text: ` · ${[c.kind, c.mode].filter(Boolean).join(" · ")}` });
		card.createDiv({ cls: "jet-cm", text: c.all ? "Notes matching all of" : "Notes matching any of" });
		for (const r of c.rules) {
			const row = card.createDiv({ cls: "jet-cr2" });
			setIcon(row.createSpan({ cls: "jet-ci" }), r.icon);
			row.createSpan({ text: r.text });
			row.createSpan({ cls: "jet-cn", text: r.count.toLocaleString() });
		}
		const f = card.createDiv({ cls: "jet-cf" });
		const aliases = c.aliases.length ? ` · aliases ${c.aliases.join(", ")}` : "";
		f.createSpan({ text: `${c.total.toLocaleString()} notes in all${aliases}` });
		const edit = f.createSpan({ cls: "jet-ce", attr: { role: "button" } });
		setIcon(edit, "settings");
		edit.appendText("Edit scope");
		edit.addEventListener("click", () => {
			this.host.scopes?.edit(chip.id);
			this.close();
		});
	}

	private hideCard(): void {
		this.cardEl?.remove();
		this.cardEl = null;
	}

	private footer(text: string): void {
		this.footEl.empty();
		for (const [key, label] of this.host.hints(text, this.hintState())) {
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
			this.refresh(true);
			return;
		}
		if (e.type === "create") {
			this.opened = true;
			this.host.create(e.text, this.chip?.id);
			this.close();
			return;
		}
		if (e.type === "widen") {
			this.widen();
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
			if (this.filterSel) {
				this.filterSel = false;
				this.drawFilters();
				return false;
			}
			if (this.chipSelected) {
				this.chipSelected = false;
				this.hideCard();
				this.drawScope();
				this.footer(this.inputEl.value);
			} else if (this.inputEl.value || this.chip || this.filters.length) {
				this.inputEl.value = "";
				this.chip = null;
				this.choices = [];
				this.filters = [];
				this.refresh();
			} else this.close();
			return false;
		});
		// Tab accepts the suggestion, or the name alone with nothing typed yet.
		this.scope.register(["Shift"], "Tab", (e) => {
			if (e.isComposing || !this.chip || this.choices.length < 2) return;
			this.cycle(-1);
			return false;
		});
		this.scope.register([], "Tab", (e) => {
			if (e.isComposing) return;
			if (this.chip) {
				if (this.choices.length < 2) return;
				this.cycle(1);
				return false;
			}
			const s = this.typing.suggest;
			if (s) {
				this.applyChip(s.scope, s.rest, [s.scope, ...s.others]);
				return false;
			}
			if (this.typing.hint) {
				this.applyChip(this.typing.hint, "");
				return false;
			}
		});
		// ⌫ at the start selects the chip, then removes it; ← at the start opens its card.
		this.scope.register([], "Backspace", (e) => {
			if (e.isComposing || !this.atStart()) return;
			// The last chip first: filters, then the scope.
			if (this.filters.length) {
				if (!this.filterSel) {
					this.filterSel = true;
					this.chipSelected = false;
					this.drawFilters();
					return false;
				}
				const f = this.filters.pop() as Filter;
				this.filterSel = false;
				// Back as text at the end, unfinished, so you can change it (it is not a chip again until a space).
				const t = filterText(f);
				const v = this.inputEl.value;
				if (t) this.inputEl.value = v ? `${v} ${t}` : t;
				this.inputEl.setSelectionRange(this.inputEl.value.length, this.inputEl.value.length);
				this.refresh();
				return false;
			}
			if (!this.chip) return;
			if (this.autoUndo) {
				this.suppressAuto.add(this.chip.id);
				this.removeChip(true);
				return false;
			}
			if (!this.chipSelected) {
				this.chipSelected = true;
				this.drawScope();
				this.footer(this.inputEl.value);
			} else this.removeChip(true);
			return false;
		});
		this.scope.register([], "ArrowLeft", (e) => {
			if (e.isComposing || !this.chip || !this.atStart()) return;
			this.chipSelected = true;
			this.drawScope();
			this.showCard();
			this.footer(this.inputEl.value);
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
		this.scope.register(["Mod"], "f", () => {
			if (!this.host.filters) return;
			this.toggleBar();
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
			this.host.create(text, this.chip?.id);
			this.close();
			return false;
		});
	}

	private atStart(): boolean {
		return this.inputEl.selectionStart === 0 && this.inputEl.selectionEnd === 0;
	}
}

/** Keys the chip handles itself; any other key unselects it. */
const CHIP_KEYS = new Set(["Backspace", "ArrowLeft", "Escape", "Tab", "Shift", "Meta", "Alt", "Control"]);

const selectable = (e: Entry): boolean => e.type !== "header" && e.type !== "notice";
const keyOf = (e: Entry): string | null =>
	e.type === "item"
		? `n:${e.path}${e.at ? `:${e.at.line}` : ""}`
		: e.type === "search"
			? `s:${e.query}`
			: e.type === "create"
				? `c:${e.text}`
				: e.type === "widen"
					? `w:${e.label}`
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
		if (e.note) el.createSpan({ cls: "jet-hscope", text: `· ${e.note}` });
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
	if (e.type === "widen") {
		el.className = "jet-row jet-rowt";
		setIcon(el.createSpan({ cls: "jet-ic" }), "globe");
		const b = el.createDiv({ cls: "jet-rb" });
		b.createDiv({ cls: "jet-l1" }).createSpan({ cls: "jet-rt", text: e.label });
		if (e.detail) b.createDiv({ cls: "jet-l2" }).createSpan({ cls: "jet-cr", text: e.detail });
		return;
	}
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
