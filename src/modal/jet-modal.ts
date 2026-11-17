import { type App, Menu, Modal, setIcon } from "obsidian";
import { cutPieces, type Filter, filterLabel, type Found, sameFilter, withoutPieces } from "../filters/filter";
import { isLongSearch, isQuestion } from "../meaning/question";
import { joinNames, listNames, type Where } from "../scopes/where";
import { comboLabel, type KeyAction, type KeyMap, keyMap, systemCopy } from "../keys/keymap";
import { type BothLayout, layoutBoth, type MeaningMode } from "./both";
import { Preview, type PreviewAction } from "../preview/preview";
import { highlight } from "./format";
import { closeness } from "../answers/show";
import { themeMark } from "./theme-mark";

export type Ranges = ReadonlyArray<readonly [number, number]>;

/** One line of the result list: a group header, a result, or a recent search. */
export type Entry =
	/** `note`: where the search runs ("in Cobalt", "everywhere"), set by the modal. */
	| {
			type: "header";
			label: string;
			count?: number;
			note?: string;
			sort?: string;
			/** A label only (the suggestions' "Try instead"): no scope note, no sort control. */
			plain?: boolean;
			/** Search by meaning: the switch at the header's right, to the other kind of results. */
			mode?: "words" | "meaning";
			/** Set by the modal: the three-way switch (words, meaning, both), showing the one on. */
			switch?: MeaningMode;
			/** Answers (experiment): the list is the notes by the line that answers the question, in order. */
			answers?: boolean;
	  }
	/** The rest of a group (by words and meaning at once): chosen, it opens in place. */
	| { type: "more"; group: string; n: number; label: string }
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
			/** Shown dimmed: what a fix would find. */
			dim?: boolean;
			/** Why it matched beyond the text: "type = status-report", "via project", "summary". */
			reasons?: string[];
			/** For sorting. */
			mtime?: number;
			ctime?: number;
			/** Found by meaning: its badge says so. */
			meaning?: boolean;
			/**
			 * Answers (experiment): the excerpt is the line that answers the question, `nums` its
			 * figures (within the excerpt), `strength` its score against the first row's (the meter),
			 * `line` the line as written, for the preview to outline.
			 */
			answer?: { strength: number; nums: Ranges; line: string };
	  }
	/** A recent search; `parts` shows its scope and filters as chips. */
	| {
			type: "search";
			query: string;
			detail?: string;
			parts?: Array<{ chip: [string, string] } | { text: string }>;
			/** The spelling your notes use, offered when nothing matched: "Did you mean …?". */
			spelling?: boolean;
	  }
	/** The empty state's scopes: the open note's first, with ⇥; then the most used. */
	| { type: "scopes"; label: string; chips: Array<{ scope: ScopeView; here?: boolean }>; more: number }
	/** A message line (no results), not selectable. */
	| {
			type: "notice";
			title: string;
			detail?: string;
			/** Not "nothing found": no red, an info icon. */ info?: boolean;
	  }
	/** Create a note named after the text (no-results screen). */
	| { type: "create"; text: string; detail?: string }
	/** Search the same text everywhere (nothing in the scope). */
	| { type: "widen"; label: string; detail?: string }
	/** Hand a structural query to Obsidian's own search. */
	| { type: "core"; query: string; detail?: string };

/** A scope as the modal shows it: its chip, banner and hints. */
export type ScopeView = { id: string; name: string; kind: string; members: number };

/** What a typed text says about scopes (the parser). */
export type Typed = {
	/** A name at the start, then more text: `at` is where the name starts in the text. */
	suggest?: { scope: ScopeView; others: ScopeView[]; name: string; rest: string; at: number };
	/** The name alone; `hintOthers`: the other scopes of that name, biggest first. */
	hint?: ScopeView;
	hintOthers?: ScopeView[];
	/** `in:name` or `@name`; `complete` once a space follows it (or it is quoted); `others` share its name. */
	applied?: { scope: ScopeView; text: string; complete: boolean; others?: ScopeView[] };
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
	/** Filters are on (with no text, Esc clears them first). */
	filters?: true;
	/** Several scopes are on: ⇧↵ creates the note in this one, the first. */
	create?: string;
};

/** Result order. */
export type Sort = "best" | "edited-new" | "edited-old" | "created-new" | "created-old" | "title";

export const SORTS: Array<[Sort, string]> = [
	["best", "Best match"],
	["edited-new", "Last edited: newest first"],
	["edited-old", "Last edited: oldest first"],
	["created-new", "Created: newest first"],
	["created-old", "Created: oldest first"],
	["title", "Title: A → Z"],
];

/** The items in this order (the first header's place kept); "best" leaves them as they came. */
export const sortEntries = (entries: Entry[], sort: Sort): Entry[] => {
	if (sort === "best") return entries;
	type It = Extract<Entry, { type: "item" }>;
	const items = entries.filter((e): e is It => e.type === "item" && !e.dim);
	if (items.length < 2) return entries;
	const key: Record<Exclude<Sort, "best">, (a: It, b: It) => number> = {
		"edited-new": (a, b) => (b.mtime ?? 0) - (a.mtime ?? 0),
		"edited-old": (a, b) => (a.mtime ?? 0) - (b.mtime ?? 0),
		"created-new": (a, b) => (b.ctime ?? 0) - (a.ctime ?? 0),
		"created-old": (a, b) => (a.ctime ?? 0) - (b.ctime ?? 0),
		title: (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }),
	};
	const sorted = [...items].sort(key[sort]);
	const at = entries.findIndex((e) => e.type === "header" || e.type === "item");
	// Rows above the results (the "in Obsidian's Search" row) stay above them.
	const lead = at > 0 ? entries.slice(0, at).filter((e) => e.type !== "item") : [];
	const rest = entries.slice(Math.max(0, at)).filter((e) => e.type !== "item" && e.type !== "header");
	const first = entries.find((e) => e.type === "header");
	// The first header keeps its switch, label and total; "Titles" becomes "Results".
	const head: Entry =
		first?.type === "header"
			? {
					...first,
					label: first.label === "Titles" ? "Results" : first.label,
					// One header: its total (it may count more than are shown). Several: the rows merged.
					count:
						entries.filter((e) => e.type === "header").length > 1
							? sorted.length
							: (first.count ?? sorted.length),
				}
			: { type: "header", label: "Results", count: sorted.length };
	return [...lead, head, ...sorted, ...rest];
};

/** How to open a note. */
/**
 * This search by words, by meaning or both (`on`: meaning has a part); `auto` says why it went beyond
 * words by itself; `offered`: a question searched by words, the switch shown.
 */
type MeaningNow = { on: boolean; mode: MeaningMode; offered: boolean; auto: "question" | "long" | null };

export type OpenHow = "default" | "other" | "split";

/** Where in the note: a line of the open note (search in this note), or a character offset in its text. */
export type OpenAt = { line: number; ch: number; len: number } | { offset: number; len: number };

/** Where a row's note should open: its line, or its first hit in the text. */
const openAt = (e: Extract<Entry, { type: "item" }>): OpenAt | undefined => {
	if (e.at) return e.at;
	const off = e.hit?.offset;
	if (off === undefined) return undefined;
	const m = e.excerpt?.marks[0];
	return { offset: off, len: m ? m[1] - m[0] : 0 };
};

/** What the modal needs from the plugin. */
export type ModalHost = {
	/**
	 * The list for this text (empty text: recents), inside the scope `scope` when a chip is applied, or
	 * any of several when you added more; `paint` may be called again as results arrive.
	 */
	list(
		text: string,
		paint: (entries: Entry[], status?: string) => void,
		scope?: Where,
		filters?: readonly Filter[],
		meaning?: { on: boolean; offered: boolean; both?: boolean },
		/** The order chosen; the notes kept by filters alone are sorted by it before the first ones are taken. */
		order?: Sort,
	): void;
	/**
	 * Search by meaning: whether it can answer (on, model installed), whether questions use it by
	 * themselves, and whether long searches do too (an opt-in, off by default).
	 */
	meaning?: {
		available(): boolean;
		/** What a question shows by itself (your setting): both (the default), by meaning, or by words. */
		questions(): MeaningMode;
		long?(): boolean;
		/** How both are shown (your setting). */
		layout?(): BothLayout;
	};
	open(path: string, how: OpenHow, at?: OpenAt): void;
	/** Footer hints for the current text and scope state. */
	hints(text: string, state?: HintState): Array<[key: string, label: string]>;
	/**
	 * The modal closed: its text, whether a note was opened, the first scope if one was applied, its
	 * filters, and the scopes added beside the first.
	 */
	closed(
		text: string,
		opened: boolean,
		scope?: ScopeView,
		filters?: readonly Filter[],
		also?: readonly ScopeView[],
	): void;
	placeholder: string;
	/** The preview pane's setting (⌘. toggles it). */
	previewOn(): boolean;
	setPreviewOn(on: boolean): void;
	/** Copy a link to the note (⌘C, the preview's link button). Absent: ⌘C does nothing. */
	copyLink?(path: string): void;
	/** ⌥↵: put a link to the note where the cursor is in the note being edited. Absent: ⌥↵ is left alone. */
	insertLink?(path: string): void;
	/**
	 * ⇧↵: create a note named after the text and open it, in the chip's scope if any.
	 * Absent (search in this note): ⇧↵ is left alone, Jet stays open.
	 */
	create?(text: string, scope?: string): void;
	/** False when the list has one order only (the lines of one note): no sort control. */
	sortable?: boolean;
	/** The actions on a note (⌘K), each with its key. */
	actions?(path: string): NoteAction[];
	/** Run one; true when the modal should close. */
	act?(id: string, path: string): boolean;
	/** Open Obsidian's core Search with this query. */
	coreSearch?(query: string): void;
	/** The last scopes and filters to reopen with, or null. */
	restore?(): { scope?: ScopeView; also?: ScopeView[]; filters: Filter[] } | null;
	/** The footer's settings popover, if this host has one. */
	renderSettings?(el: HTMLElement): void;
	/**
	 * Your keys in the window, and the double tap as the hints write it (null: off).
	 * Absent: the defaults, and ⇧⇧.
	 */
	keys?(): { map: KeyMap; tap: string | null };
	/** Scopes typed in the box; absent when there are none. */
	scopes?: {
		typed(text: string): Typed;
		card(id: string): ScopeCard;
		/** Open the scope's settings. */
		edit(id: string): void;
		/** Another scope while one is on: added beside it (the default) or in its place. */
		another?(): "add" | "switch";
	};
	/** Filters typed in the box or picked in the bar; absent: no filters. */
	filters?: {
		/** The filters in the text (links resolved), where each is and whether it is finished. */
		find(text: string): Found[];
		/** A property's values with their note counts, inside the scope and filters (most first). */
		values(key: string, scope?: Where, filters?: readonly Filter[]): Array<[value: string, notes: number]>;
		tags(scope?: Where, filters?: readonly Filter[]): Array<[tag: string, notes: number]>;
		/** Property keys your notes use, with their note counts. */
		keys(): Array<[key: string, notes: number]>;
		/** Every scope, for the bar's In menu. */
		scopes(): ScopeView[];
		/** What to list for the piece at the caret, counted inside the scope and filters. */
		complete(text: string, caret: number, scope?: Where, filters?: readonly Filter[]): Completion | null;
		/** An unknown key a used key is two edits from (`stauts:draft`). */
		fix(text: string): FixView | null;
		/** The notes the fixed filter would keep, as rows (shown dimmed under the results). */
		preview(filter: Filter, scope?: Where, filters?: readonly Filter[]): Entry[];
	};
};

/** The autocomplete list: what replaces the piece [from, to) when chosen. */
export type Completion = {
	from: number;
	to: number;
	title: string;
	where?: string;
	items: Array<{ label: string; count?: number; insert: string }>;
	/** Notes with the key set, and all notes, inside the scope and filters. */
	set?: number;
	total?: number;
	/** The same values across the vault, when a scope or filters narrow the counts. */
	vault?: string;
};

/** An action in the ⌘K panel. */
export type NoteAction = { id: string; label: string; icon: string; key?: string; detail?: string; group?: number };

/** A fix for an unknown key. */
export type FixView = { from: number; to: number; wrong: string; key: string; value: string; notes: number };

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
	private previewKey: string | null = null;
	private previewTimer: number | null = null;
	private resize: ResizeObserver | null = null;
	// Scopes: the applied chip, what the text says, and their elements.
	/** The last scope applied: ⌫ selects it, ⇥ cycles its name, its card opens on hover. */
	private chip: ScopeView | null = null;
	/** The scopes added before it: the search covers them all, first added first. */
	private kept: ScopeView[] = [];
	/** A recent search being applied: each scope it names is added, whatever the setting. */
	private restoring = false;
	private chipSelected = false;
	/** The scopes sharing the chip's name (⇥ cycles them); just the chip otherwise. */
	private choices: ScopeView[] = [];
	/** Auto applied the chip just now: ⌫ at the start undoes it. */
	private autoUndo = false;
	/** Scopes whose Auto was undone in this search: suggested from then on. */
	/** Auto scopes you undid or removed in this search: their names stay text until the box is cleared. */
	private readonly suppressAuto = new Set<string>();
	/** ⌘J's choice for this search: words or meaning; null follows the question rule. */
	private meaningPick: MeaningMode | null = null;
	/** Groups whose "more" row was chosen (both at once); a new search closes them. */
	private readonly expanded = new Set<string>();
	/** The last search's meaning state, for the header switch, the footer and the banner. */
	private meaningNow: MeaningNow = { on: false, mode: "words", offered: false, auto: null };
	private clearEl!: HTMLElement;
	/** The chips an Auto scope replaced just now (Switch to it): ⌫ undoes back to them. */
	private autoPrev: { chip: ScopeView; kept: ScopeView[] } | null = null;
	/** The name as you typed it when Auto applied (`mb`): the undo puts that back. */
	private autoName: string | null = null;
	/** Widened from a chip (⇧⇧): ⇧⇧ again puts it back. */
	private widened: { chip: ScopeView; choices: ScopeView[]; kept: ScopeView[] } | null = null;
	/** Between onOpen and onClose. */
	shown = false;
	// Filters: chips after the scope's, the last one selected by ⌫, and the bar.
	private filters: Filter[] = [];
	private filterSel = false;
	private readonly fchipsEl: HTMLElement;
	private readonly barEl: HTMLElement;
	/** Each list request; a paint for an older one is dropped. */
	private listSeq = 0;
	/** Result order for this search. */
	private sort: Sort = "best";
	/** The chips as restored: marked pinned while they stay so. */
	private pinnedKey: string | null = null;
	// The ⌘K panel: its element, actions, query and selection.
	private actPanel: {
		el: HTMLElement;
		input: HTMLInputElement;
		path: string;
		all: NoteAction[];
		shown: NoteAction[];
		i: number;
	} | null = null;
	// Autocomplete and fix-it.
	private ac: Completion | null = null;
	private acIndex = 0;
	private acEl: HTMLElement | null = null;
	/** The piece the list was closed for with Esc: not offered again until it changes. */
	private acClosedFor: string | null = null;
	private fix: FixView | null = null;
	private fixPreview: Entry[] = [];
	private readonly fixEl: HTMLElement;
	private typing: Typed = {};
	private readonly keptEl: HTMLElement;
	private readonly chipEl: HTMLElement;
	private readonly chipLabel: HTMLElement;
	private readonly ghostEl: HTMLElement;
	private readonly ihintEl: HTMLElement;
	private readonly bannerEl: HTMLElement;
	private cardEl: HTMLElement | null = null;
	private cardTimer: number | null = null;
	private measureCtx: CanvasRenderingContext2D | null | undefined;
	/** Your keys, read once per opening: every hint in the window writes them. */
	private readonly k: KeyMap;
	/** The double tap as the hints write it (⇧⇧), or null when you turned it off. */
	private readonly tap: string | null;
	private lab(a: KeyAction): string {
		return comboLabel(this.k[a]);
	}

	constructor(
		app: App,
		private readonly host: ModalHost,
		private readonly initial = "",
	) {
		super(app);
		const keys = host.keys?.();
		this.k = keys?.map ?? keyMap();
		this.tap = keys ? keys.tap : "⇧⇧";
		this.modalEl.addClass("jet-modal");
		this.modalEl.setAttr("aria-label", "Jet Search");
		this.contentEl.addClass("jet-content");
		const top = this.contentEl.createDiv({ cls: "jet-in" });
		setIcon(top.createSpan({ cls: "jet-sic" }), "search");
		this.keptEl = top.createSpan({ cls: "jet-kept" });
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
		this.fixEl = top.createSpan({ cls: "jet-ghostbox is-fix is-hidden" });
		this.ihintEl = top.createSpan({ cls: "jet-ihint is-hidden" });
		this.statusEl = top.createSpan({ cls: "jet-status" });
		// × clears the text, the scope and the filters, as the first Esc does.
		this.clearEl = top.createSpan({
			cls: "jet-clear is-hidden",
			attr: { "aria-label": "Clear the search, its scope and filters (Esc)", role: "button" },
		});
		setIcon(this.clearEl, "x-circle");
		this.clearEl.addEventListener("mousedown", (e) => e.preventDefault());
		this.clearEl.addEventListener("click", () => {
			this.clearAll();
			this.inputEl.focus();
		});
		if (host.filters) {
			const fb = top.createSpan({
				cls: "jet-fbtn",
				attr: { "aria-label": `Filters (${this.lab("filters")})`, role: "button" },
			});
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
		this.preview = new Preview(app, body, (a, p) => this.act(a, p), {
			prev: this.lab("prevHit"),
			next: this.lab("nextHit"),
			link: this.lab("copyLink"),
			split: this.lab("split"),
			open: this.lab("open"),
		});
		this.modalEl.toggleClass("is-preview-off", !host.previewOn());
		this.footEl = this.contentEl.createDiv({ cls: "jet-ft" });

		this.inputEl.addEventListener("input", () => {
			this.expanded.clear();
			this.chipSelected = false;
			this.filterSel = false;
			this.autoUndo = false;
			this.refresh();
		});
		this.inputEl.addEventListener("scroll", () => this.placeGhost());
		// The caret moved without typing: the list follows the piece it is in.
		this.inputEl.addEventListener("click", () => this.updateAC());
		this.inputEl.addEventListener("keyup", (e) => {
			if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") this.updateAC();
		});
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
			const s = (e.target as HTMLElement).closest<HTMLElement>(".jet-sort");
			if (s) {
				e.stopPropagation();
				this.sortMenu(s);
				return;
			}
			const seg = (e.target as HTMLElement).closest<HTMLElement>(".jet-seg [data-mode]");
			if (seg) {
				e.stopPropagation();
				this.setMeaningMode(seg.dataset.mode as MeaningMode);
				this.inputEl.focus();
				return;
			}
			const c = (e.target as HTMLElement).closest<HTMLElement>(".jet-schip");
			if (c) {
				e.stopPropagation();
				this.scopeChipClicked(c);
			}
		});
		this.listEl.addEventListener("click", (e) => {
			const row = (e.target as HTMLElement).closest<HTMLElement>(".jet-row");
			const i = row ? Number(row.dataset.index) : -1;
			if (i < 0) return;
			this.select(i);
			this.choose(e.metaKey || e.ctrlKey ? "other" : "default");
		});
		this.listEl.addEventListener("mousemove", (e) => {
			const row = (e.target as HTMLElement).closest<HTMLElement>(".jet-row");
			if (row && Number(row.dataset.index) !== this.selected) {
				this.moved = true;
				this.select(Number(row.dataset.index), false);
			}
		});
		this.keys();
	}

	onOpen(): void {
		this.shown = true;
		// Marks in the theme's own highlight colours (some themes pair an opaque highlight with dark text).
		this.modalEl.setCssProps(themeMark(this.modalEl.doc));
		this.inputEl.value = this.initial;
		this.inputEl.select();
		// Persisted filters: the last scope and filters, pinned.
		const r = this.initial ? null : (this.host.restore?.() ?? null);
		if (r && (r.scope || r.filters.length)) {
			const all = r.scope ? [r.scope, ...(r.also ?? [])] : [];
			this.chip = all.at(-1) ?? null;
			this.kept = all.slice(0, -1);
			this.choices = this.chip ? [this.chip] : [];
			this.filters = [...r.filters];
			this.pinnedKey = this.chipsKey();
		}
		this.refresh(true);
		this.inputEl.focus();
		// The modal's own window (it may be a popout): its ResizeObserver.
		const win = this.modalEl.win as Window & { ResizeObserver: typeof ResizeObserver };
		const ro = new win.ResizeObserver(() => {
			const was = this.modalEl.hasClass("is-narrow");
			this.modalEl.toggleClass("is-narrow", this.modalEl.clientWidth < NARROW_PX);
			// Wide enough again: the preview follows the selection.
			if (was && !this.modalEl.hasClass("is-narrow")) {
				this.preview.path = null;
				this.schedulePreview();
			}
		});
		ro.observe(this.modalEl);
		this.resize = ro;
	}

	onClose(): void {
		this.shown = false;
		this.resize?.disconnect();
		if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
		this.preview.destroy();
		if (this.cardTimer !== null) window.clearTimeout(this.cardTimer);
		const [first, ...also] = this.where();
		this.host.closed(this.inputEl.value, this.opened, first, this.filters, also);
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
			// The same note with other words, or the full-text answer: drawn again.
			const key = JSON.stringify([e.path, e.hit?.terms ?? [], e.hit?.offset ?? null, e.answer?.line ?? null]);
			if (this.preview.path === e.path && this.previewKey === key) return;
			this.previewKey = key;
			void this.preview.show(
				file,
				e.hit?.terms ?? [],
				e.hit?.offset,
				e.answer?.line ? { line: e.answer.line, question: this.inputEl.value } : undefined,
			);
		}, PREVIEW_REST_MS);
	}

	private act(a: PreviewAction, path: string): void {
		if (a === "link") {
			this.host.copyLink?.(path);
			return;
		}
		this.opened = true;
		// At the hit the preview shows, when it is the selected row's.
		const e = this.entries[this.selected];
		this.host.open(
			path,
			a === "split" ? "split" : "default",
			e?.type === "item" && e.path === path ? openAt(e) : undefined,
		);
		this.close();
	}

	/** Paint a list (called by the host, maybe several times per keystroke as tiers answer). */
	/** The entries as the host gave them (re-sorted without asking again). */
	private lastEntries: Entry[] = [];
	/** Answers (experiment): the list shown is the notes by the line that answers the question. */
	private answersShown = false;
	/** You moved the selection in this list (keys or the pointer): a later paint does not take it back. */
	private moved = false;

	paint(entries: Entry[], status = ""): void {
		// An answer that arrives after Jet closed draws nothing (and loads no preview).
		if (!this.shown) return;
		this.lastEntries = entries;
		// The first header says where the search runs (inside the chip's scope, or everywhere while one
		// is suggested) and how many filters narrow it.
		const n = this.filters.length;
		const where = this.chip
			? `in ${joinNames(this.where().map((s) => s.name))}`
			: this.typing.suggest
				? "everywhere"
				: "";
		const note = [where, n ? `${n} filter${n === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ") || undefined;
		// Sorting is for a search (text or filters), not the recents with nothing typed.
		const searching = !!this.inputEl.value.trim() || this.filters.length > 0;
		// By words and by meaning at once: grouped as you chose (each group in the order chosen).
		// Answers (experiment): one list, in the order of the lines that answer the question.
		const answers = entries.some((e) => e.type === "header" && e.answers);
		if (answers !== this.answersShown) {
			// The answers replace the lists: their first row is selected, unless you moved the selection.
			if (answers && !this.moved) this.selectedKey = null;
			this.answersShown = answers;
			this.drawBanner();
		}
		const both = searching && this.meaningNow.mode === "both" && !answers;
		if (both) entries = layoutBoth(entries, this.host.meaning?.layout?.() ?? "groups", this.sort, this.expanded);
		else if (searching && this.host.sortable !== false) entries = sortEntries(entries, this.sort);
		const h = entries.findIndex((e) => e.type === "header" && !e.plain);
		const first = entries[h];
		if (note && first?.type === "header") entries = entries.map((e, i) => (i === h ? { ...first, note } : e));
		// The switch (words, meaning, both) on the first header, whenever meaning has a part or is offered.
		const sw = this.host.meaning?.available() && (this.meaningNow.on || this.meaningNow.offered);
		const hw = entries.findIndex((e) => e.type === "header");
		const fw = entries[hw];
		if (sw && fw?.type === "header")
			entries = entries.map((e, i) => (i === hw ? { ...fw, switch: this.meaningNow.mode } : e));
		// The sort control sits on the first header, once there is something to order.
		const hs = entries.findIndex((e) => e.type === "header" && !e.plain);
		const hh = entries[hs];
		if (
			searching &&
			this.host.sortable !== false &&
			hh?.type === "header" &&
			entries.filter((e) => e.type === "item").length > 1
		)
			entries = entries.map((e, i) =>
				i === hs ? { ...hh, sort: SORTS.find(([k]) => k === this.sort)?.[1] ?? "" } : e,
			);
		// A fix for an unknown key: what it would find, dimmed, under the results.
		if (this.fix && this.fixPreview.length)
			entries = [
				...entries,
				{
					type: "header",
					label: `With the fix — ${this.fix.key}: ${this.fix.value}`,
					count: this.fixPreview.length,
				},
				...this.fixPreview,
			];
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
	/** The sort menu, at the header's control. */
	private sortMenu(at: HTMLElement): void {
		const m = new Menu();
		for (const [k, label] of SORTS)
			m.addItem((i) =>
				i
					.setTitle(label)
					.setChecked(k === this.sort)
					.onClick(() => this.setSort(k)),
			);
		const r = at.getBoundingClientRect();
		m.showAtPosition({ x: r.left, y: r.bottom + 4 });
	}

	private setSort(k: Sort): void {
		this.sort = k;
		// Filters with no text list a window of the notes they keep: ask again in the new order.
		if (!this.inputEl.value.trim() && this.filters.length) {
			this.refresh();
			return;
		}
		this.paint(this.lastEntries, this.statusEl.textContent ?? "");
	}

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
				// The space you typed after a chip stays, and so does the caret.
				const cut = cutPieces(raw, done, this.inputEl.selectionStart ?? raw.length);
				raw = cut.text;
				this.inputEl.value = raw;
				this.inputEl.setSelectionRange(cut.caret, cut.caret);
				pending = this.host.filters.find(raw).filter((f) => !f.complete);
			} else pending = found;
		}
		this.drawFilters();
		const fx = this.host.filters?.fix(raw) ?? null;
		this.fix = fx;
		this.fixPreview = fx
			? (this.host.filters?.preview(
					{ kind: "prop", key: fx.key, value: fx.value },
					this.whereArg(),
					this.filters,
				) ?? [])
			: [];
		this.typing = {};
		// A cleared box is a new search: Auto scopes you turned off apply again.
		if (!raw.trim() && !this.chip && !this.filters.length) this.suppressAuto.clear();
		if (this.host.scopes) {
			// With a chip on too: `@name`, an Auto name or a suggestion switch scopes (they were ignored).
			const t = this.host.scopes.typed(raw);
			const current = this.chip;
			const on = this.where();
			const same = (v: ScopeView | undefined): boolean => !!v && on.some((x) => x.id === v.id);
			// The space you typed after the name stays, so the next word does not stick to the last one.
			const keep = (rest: string): string => (rest && /\s$/u.test(raw) && !/\s$/u.test(rest) ? `${rest} ` : rest);
			if (t.applied && (t.applied.complete || final)) {
				this.applyChip(t.applied.scope, keep(t.applied.text), [t.applied.scope, ...(t.applied.others ?? [])]);
				return;
			}
			// Auto: once a space follows the name, the scope applies without Tab.
			const auto = t.auto ? (t.suggest?.scope ?? t.hint) : undefined;
			// The chip's own name is just a word (it is already applied).
			if (auto && !same(auto) && !this.suppressAuto.has(auto.id)) {
				const s = t.suggest;
				const spaced = s ? /\s/u.test(raw[s.at + s.name.length] ?? "") : /\s$/u.test(raw);
				if (spaced) {
					// Switching: ⌫ puts back the chips it replaced. Adding: ⌫ just removes it.
					const before =
						current && this.another() === "switch" ? { chip: current, kept: [...this.kept] } : null;
					this.applyChip(auto, keep(s?.rest ?? ""));
					this.autoUndo = true;
					this.autoPrev = before;
					this.autoName = s ? s.name : raw.trim();
					this.drawScope();
					this.footer(this.inputEl.value);
					return;
				}
			}
			// The chip's own name is just a word.
			if (!t.applied && !same(t.suggest?.scope) && !same(t.hint)) this.typing = t;
		}
		const shown = this.inputEl.value;
		const text = pending.length ? withoutPieces(shown, pending) : shown;
		this.meaningNow = this.meaningState(text);
		this.drawScope();
		const scope = this.whereArg();
		this.selectedKey = null;
		this.moved = false;
		const seq = ++this.listSeq;
		// A new list starts at its top: the selected first row is in view.
		this.listEl.scrollTop = 0;
		this.host.list(
			text,
			(entries, status) => {
				if (seq === this.listSeq) this.paint(entries, status);
			},
			scope,
			[...this.filters],
			this.host.meaning
				? { on: this.meaningNow.on, offered: this.meaningNow.offered, both: this.meaningNow.mode === "both" }
				: undefined,
			this.sort,
		);
		this.footer(shown);
		this.updateAC();
	}

	// ── Autocomplete and fix-it ────────────────────────────────────────

	private updateAC(): void {
		const f = this.host.filters;
		const v = this.inputEl.value;
		const caret = this.inputEl.selectionStart ?? v.length;
		const c = f ? f.complete(v, caret, this.whereArg(), this.filters) : null;
		const piece = c ? v.slice(c.from, c.to) : null;
		if (!c || piece === this.acClosedFor) {
			this.closeAC();
			return;
		}
		this.acClosedFor = null;
		const same = this.ac && this.ac.from === c.from && this.ac.items.length === c.items.length;
		if (!same) this.acIndex = 0;
		this.ac = c;
		this.drawAC();
		this.footer(v);
	}

	private closeAC(): void {
		const was = !!this.ac;
		this.ac = null;
		this.acEl?.remove();
		this.acEl = null;
		if (was) this.footer(this.inputEl.value);
	}

	private drawAC(): void {
		const c = this.ac;
		if (!c) return;
		this.acEl?.remove();
		const el = this.inputEl.parentElement?.createDiv({ cls: "jet-ac" });
		if (!el) return;
		this.acEl = el;
		// Under the piece, as the box is scrolled (a long search).
		el.style.left = `${Math.max(0, this.inputEl.offsetLeft + this.textWidth(this.inputEl.value.slice(0, c.from)) - this.inputEl.scrollLeft - 8)}px`;
		el.addEventListener("mousedown", (e) => e.preventDefault());
		const h = el.createDiv({ cls: "jet-ach" });
		h.createSpan({ text: c.where ? `${c.title} · in ${c.where}` : c.title });
		if (c.set !== undefined && c.total !== undefined)
			h.createSpan({ cls: "jet-acs", text: `${c.set.toLocaleString()} of ${c.total.toLocaleString()} set` });
		const max = Math.max(1, ...c.items.map((i) => i.count ?? 0));
		c.items.forEach((it, i) => {
			const r = el.createDiv({ cls: `jet-acr${i === this.acIndex ? " is-selected" : ""}` });
			r.createSpan({ cls: "jet-acl", text: it.label });
			if (it.count !== undefined) {
				r.createSpan({ cls: "jet-acn", text: it.count.toLocaleString() });
				const bar = r.createSpan({ cls: "jet-acb" });
				bar.createSpan({ cls: "jet-acbf" }).style.width = `${Math.round((100 * it.count) / max)}%`;
			}
			r.addEventListener("mousemove", () => {
				if (this.acIndex === i) return;
				this.acIndex = i;
				this.drawAC();
			});
			r.addEventListener("click", () => {
				this.acIndex = i;
				this.acceptAC();
			});
		});
		if (c.set !== undefined && c.total !== undefined && c.total > c.set)
			el.createDiv({ cls: "jet-acf", text: `Not set · ${(c.total - c.set).toLocaleString()}` });
		if (c.vault) el.createDiv({ cls: "jet-acv", text: c.vault });
	}

	private acceptAC(): void {
		const c = this.ac;
		const it = c?.items[this.acIndex];
		if (!c || !it) return;
		const v = this.inputEl.value;
		// The space after is dropped only when the insert brings its own (a key is not finished).
		const tail = v.slice(c.to);
		const next = v.slice(0, c.from) + it.insert + (/\s$/u.test(it.insert) ? tail.replace(/^\s+/u, "") : tail);
		this.closeAC();
		this.inputEl.value = next;
		const at = c.from + it.insert.length;
		this.inputEl.setSelectionRange(at, at);
		this.refresh();
		this.inputEl.focus();
	}

	/** ⇥ on a fix: the used key in place of the typed one, finished, so it becomes a chip. */
	private applyFix(): void {
		const f = this.fix;
		if (!f) return;
		const v = this.inputEl.value;
		const end = f.to - f.wrong.length + f.key.length;
		let next = v.slice(0, f.from) + f.key + v.slice(f.from + f.wrong.length);
		if (!/\s/u.test(next[end] ?? "")) next = `${next.slice(0, end)} ${next.slice(end)}`;
		this.inputEl.value = next;
		this.inputEl.setSelectionRange(next.length, next.length);
		this.refresh();
	}

	// ── Filters ────────────────────────────────────

	private chipsKey(): string {
		return JSON.stringify([this.where().map((s) => s.id), this.filters]);
	}

	private pinned(): boolean {
		return this.pinnedKey !== null && this.pinnedKey === this.chipsKey();
	}

	/** A chip in the empty state's scopes row: that scope; "All" lists every one. */
	private scopeChipClicked(el: HTMLElement): void {
		const row = this.entries.find((e) => e.type === "scopes");
		if (row?.type !== "scopes") return;
		if (el.hasClass("is-all")) {
			const all = this.host.filters?.scopes() ?? row.chips.map((c) => c.scope);
			const m = new Menu();
			for (const v of all) m.addItem((i) => i.setTitle(scopeListLabel(v)).onClick(() => this.applyChip(v, "")));
			const r = el.getBoundingClientRect();
			m.showAtPosition({ x: r.left, y: r.bottom + 4 });
			return;
		}
		const c = row.chips[Number(el.dataset.i)];
		if (c) this.applyChip(c.scope, this.inputEl.value);
		this.inputEl.focus();
	}

	private drawFilters(): void {
		this.fchipsEl.empty();
		const pinned = this.pinned();
		this.filters.forEach((f, i) => {
			const [head, value] = filterLabel(f);
			const last = i === this.filters.length - 1;
			const c = this.fchipsEl.createSpan({
				cls: `jet-fchip${last && this.filterSel ? " is-selected" : ""}${pinned ? " is-pinned" : ""}`,
			});
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
		// A second Edited or Created window replaces the first: beside it, it would change nothing.
		if (f.kind === "edited" || f.kind === "created") this.filters = this.filters.filter((x) => x.kind !== f.kind);
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
		const scope = this.whereArg();
		const title = this.filters.some((x) => x.kind === "title");
		button("Title only", "type", title, () =>
			title
				? ((this.filters = this.filters.filter((x) => x.kind !== "title")), this.refresh())
				: this.addFilter({ kind: "title" }),
		);
		const inLabel = this.chip ? `In: ${joinNames(this.where().map((s) => s.name))}` : "In";
		button(inLabel, "scan-search", !!this.chip, (el) =>
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
				this.kept = [];
				this.choices = [];
				this.refresh();
			});
	}

	// ── Scopes ─────────────────────────────────────

	/** Every scope the search covers, first added first (none: everywhere). */
	private where(): ScopeView[] {
		return this.chip ? [...this.kept, this.chip] : [];
	}

	/** The same, as the host takes it: one id, or several. */
	private whereArg(): Where | undefined {
		const w = this.where();
		return w.length > 1 ? w.map((s) => s.id) : w[0]?.id;
	}

	/** Another scope while one is on: your setting, Add it by default; a recent search adds each it names. */
	private another(): "add" | "switch" {
		return this.restoring ? "add" : (this.host.scopes?.another?.() ?? "add");
	}

	/**
	 * Tab, `in:name` or a recent search: the scope becomes the chip; the box keeps the rest. With a chip
	 * on, `add` keeps it beside the new one, `switch` replaces every chip.
	 */
	private applyChip(
		scope: ScopeView,
		text: string,
		choices: ScopeView[] = [scope],
		how: "add" | "switch" = this.another(),
	): void {
		const cur = this.chip;
		// A scope already on stays where it is (the first one is where ⇧↵ creates): only its name is used up.
		const on = cur && how === "add" && this.kept.some((s) => s.id === scope.id);
		if (on) scope = cur;
		else if (cur && how === "add" && cur.id !== scope.id) this.kept = [...this.kept, cur];
		else if (how === "switch") this.kept = [];
		if (on) choices = this.choices;
		this.chip = scope;
		this.choices = choices;
		this.widened = null;
		this.autoUndo = false;
		this.autoPrev = null;
		this.chipSelected = false;
		this.hideCard();
		this.inputEl.value = text;
		this.inputEl.setSelectionRange(text.length, text.length);
		// A recent search names its scopes one after the other: each applies as typed whole.
		this.refresh(this.restoring);
	}

	/** × on a chip added before the last one: the search no longer covers it; the text stays. */
	private removeKept(id: string): void {
		this.kept = this.kept.filter((s) => s.id !== id);
		this.suppressAuto.add(id);
		this.refresh();
	}

	/**
	 * × keeps the text; the second ⌫ puts the name back in front of it, as you typed it. The chip added
	 * before it, if any, becomes the last one.
	 */
	private removeChip(nameBack: boolean, typedName?: string): void {
		const chip = this.chip;
		if (!chip) return;
		const back = this.kept.pop() ?? null;
		this.chip = back;
		this.choices = back ? [back] : [];
		this.autoUndo = false;
		this.autoPrev = null;
		this.chipSelected = false;
		this.hideCard();
		// Removed on purpose: its name, if Auto, must not re-apply it at once (for this search).
		this.suppressAuto.add(chip.id);
		this.autoName = null;
		if (nameBack) {
			const name = typedName ?? chip.name;
			this.inputEl.value = `${name} ${this.inputEl.value}`;
			this.inputEl.setSelectionRange(name.length + 1, name.length + 1);
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
		this.kept = this.kept.filter((s) => s.id !== next.id);
		this.refresh();
	}

	/**
	 * ⇧⇧ while open: with a chip, drop it and search the same text everywhere; after
	 * that, put it back. False when there is nothing to widen (⇧⇧ then does what it always does).
	 */
	widen(): boolean {
		if (this.chip) {
			this.widened = { chip: this.chip, choices: this.choices, kept: this.kept };
			this.chip = null;
			this.kept = [];
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
		this.kept = w.kept;
		this.choices = w.choices;
		this.refresh();
		return true;
	}

	/**
	 * By meaning or by words: ⌘J's choice for this search, else a question goes by meaning when
	 * questions use it by themselves; a question searched by words is offered meaning.
	 */
	private meaningState(text: string): MeaningNow {
		const m = this.host.meaning;
		if (!text.trim()) this.meaningPick = null;
		if (!m?.available() || !text.trim()) return { on: false, mode: "words", offered: false, auto: null };
		const question = isQuestion(text);
		// Long searches go by meaning too, when you opted in; a long question is still a question.
		const long = !question && m.long?.() === true && isLongSearch(text);
		const asked = m.questions();
		// A question shows what you chose (both, by default); a long search, opted in, at least meaning.
		const own: MeaningMode = question ? asked : long ? (asked === "both" ? "both" : "meaning") : "words";
		const auto = this.meaningPick !== null || own === "words" ? null : question ? "question" : "long";
		const mode = this.meaningPick ?? own;
		return { on: mode !== "words", mode, offered: mode === "words" && (question || long), auto };
	}

	/** ⌘J: the next kind of results for this search, words → meaning → both → words. */
	private toggleMeaning(): void {
		const next: Record<MeaningMode, MeaningMode> = { words: "meaning", meaning: "both", both: "words" };
		this.setMeaningMode(next[this.meaningNow.mode]);
	}

	/** The header's switch, or ⌘J: this search by words, by meaning or both. */
	private setMeaningMode(mode: MeaningMode): void {
		if (!this.host.meaning?.available() || !this.inputEl.value.trim()) return;
		this.meaningPick = mode;
		this.refresh();
	}

	/** Empty box, no scope, no filters: a new search. */
	private clearAll(): void {
		this.inputEl.value = "";
		// Nothing left selected: the next Esc closes the empty search.
		this.chipSelected = false;
		this.filterSel = false;
		this.widened = null;
		this.chip = null;
		this.kept = [];
		this.choices = [];
		this.filters = [];
		this.refresh();
	}

	private drawScope(): void {
		const chip = this.chip;
		this.clearEl?.toggleClass("is-hidden", !chip && !this.inputEl.value && !this.filters.length);
		this.chipEl.toggleClass("is-hidden", !chip);
		this.chipEl.toggleClass("is-selected", !!chip && this.chipSelected);
		this.chipEl.toggleClass("is-pinned", !!chip && this.pinned());
		this.chipLabel.setText(
			chip ? (this.choices.length > 1 && chip.kind ? `${chip.name} · ${chip.kind}` : chip.name) : "",
		);
		this.drawKept();
		const names = this.where().map((s) => s.name);
		this.inputEl.placeholder = chip ? `Search in ${listNames(names)}…` : this.host.placeholder;
		const hint = !chip ? this.typing.hint : undefined;
		this.ihintEl.toggleClass("is-hidden", !hint);
		this.ihintEl.empty();
		if (hint) {
			this.ihintEl.createEl("kbd", { text: this.lab("accept") });
			this.ihintEl.appendText(`Search in ${hint.name}`);
		}
		this.drawBanner();
		this.placeGhost();
		if (!chip) this.hideCard();
	}

	/** The chips added before the last one: each with its ×. */
	private drawKept(): void {
		const el = this.keptEl;
		el.empty();
		const pinned = this.pinned();
		for (const s of this.chip ? this.kept : []) {
			const c = el.createSpan({ cls: `jet-chip is-kept${pinned ? " is-pinned" : ""}` });
			c.createSpan({ cls: "jet-chl", text: s.name });
			const x = c.createSpan({ cls: "jet-chx", attr: { "aria-label": `Remove ${s.name}`, role: "button" } });
			setIcon(x, "x");
			c.addEventListener("mousedown", (e) => e.preventDefault());
			x.addEventListener("click", (e) => {
				e.stopPropagation();
				this.removeKept(s.id);
			});
		}
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
			if (this.tap) keys([[this.tap, "Back"]]);
		} else if (chip && this.autoUndo) {
			const t = head("undo-2");
			t.appendText("Scoped to ");
			t.createEl("b", { text: chip.name });
			t.appendText(" · Auto");
			keys([["⌫", "Undo"]]);
		} else if (chip && s && !s.others.length && this.another() === "add") {
			// A scope named in the text while one is on: ⇥ adds it, ⇧⇥ searches it alone.
			const t = head("plus");
			t.appendText("Add ");
			t.createEl("b", { text: s.scope.name });
			t.appendText(" to this search");
			keys([
				[this.lab("accept"), "Add"],
				[this.lab("back"), `Only ${s.scope.name}`],
			]);
		} else if (chip && s && !s.others.length) {
			// Switch to it (your setting): ⇥ switches, ⇧⇥ adds it instead.
			const t = head("scan-search");
			t.appendText("Search in ");
			t.createEl("b", { text: s.scope.name });
			t.appendText(
				` instead of ${joinNames(this.where().map((x) => x.name))} for “${s.rest}” · ${notes(s.scope.members)}`,
			);
			keys([
				[this.lab("accept"), "Switch"],
				[this.lab("back"), "Add it"],
			]);
		} else if (chip && this.choices.length > 1) {
			b.addClass("is-multi");
			head("scan-search").appendText(
				`${this.choices.length} scopes are named “${chip.name}”`.replace(/^2 /, "Two "),
			);
			keys([
				[this.lab("accept"), "next"],
				[this.lab("back"), "back"],
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
			if (chip) t.appendText(` instead of ${chip.name}`);
			t.appendText(` for “${s.rest}” · ${notes(s.scope.members)}`);
			keys([["⇥", "Tab"]]);
		} else if (this.meaningNow.auto && !chip) {
			// A question (or a long search, opted in) went beyond words by itself: say so, once per search.
			const long = this.meaningNow.auto === "long";
			head("sparkles").appendText(
				this.answersShown
					? "A question: notes by the line that answers it"
					: this.meaningNow.mode === "both"
						? long
							? "A long search: by words and by meaning"
							: "A question: by words and by meaning"
						: long
							? "A long search, so by meaning: notes about what you wrote, even in other words"
							: "A question, so by meaning: notes about what you asked, even in other words",
			);
			keys([[this.lab("meaning"), "Words · Meaning · Both"]]);
		} else if (this.fix) {
			const t = head("lightbulb");
			t.appendText("Did you mean ");
			t.createEl("code", { text: `${this.fix.key}:` });
			t.appendText(`? · on ${notes(this.fix.notes)}`);
			keys([[this.lab("accept"), "Fix"]]);
		} else {
			b.remove();
			return;
		}
		if (b.parentElement !== this.listEl) this.listEl.prepend(b);
	}

	/** A dashed box around the typed name; the text itself does not move. */
	private placeGhost(): void {
		const f = this.fix;
		this.fixEl.toggleClass("is-hidden", !f);
		if (f) {
			const raw = this.inputEl.value;
			const left = this.inputEl.offsetLeft + this.textWidth(raw.slice(0, f.from)) - this.inputEl.scrollLeft;
			this.fixEl.style.left = `${left}px`;
			this.fixEl.style.width = `${this.textWidth(f.wrong)}px`;
		}
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
			if (this.kept[0]) st.create = this.kept[0].name;
			return st;
		}
		if (this.widened) return { widened: this.widened.chip.name };
		if (this.typing.suggest) return { suggest: this.typing.suggest.scope.name };
		if (this.typing.hint) return { hint: this.typing.hint.name };
		return this.filters.length ? { filters: true } : {};
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
		const hints: Array<[string, string]> = this.ac
			? [
					["↑↓", "Choose value"],
					[this.lab("accept"), "Accept"],
					["Esc", "Close list"],
				]
			: this.fix && !this.typing.suggest
				? [
						[this.lab("accept"), `Fix to ${this.fix.key}:`],
						[this.lab("open"), "Open"],
						["Esc", "Clear"],
					]
				: this.host.hints(text, this.hintState());
		// ⌘J, whenever meaning can answer.
		if (!this.ac && this.host.meaning?.available() && text.trim())
			hints.splice(Math.min(3, hints.length), 0, [
				this.lab("meaning"),
				{ words: "By meaning", meaning: "Both", both: "By words" }[this.meaningNow.mode],
			]);
		for (const [key, label] of hints) {
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

	/** The keys the rows show (the suggestion cards, the scopes row, the meaning switch). */
	private get rowKeys(): RowKeys {
		return {
			open: this.lab("open"),
			create: this.lab("create"),
			accept: this.lab("accept"),
			meaning: this.lab("meaning"),
			sort: this.lab("sort"),
		};
	}

	/** Text selected in the search box, or anywhere in the window (the preview): ⌘C copies it. */
	private textSelected(): boolean {
		const i = this.inputEl;
		if ((i.selectionStart ?? 0) !== (i.selectionEnd ?? 0)) return true;
		const sel = this.modalEl.win?.getSelection?.() ?? window.getSelection?.();
		return !!sel && !sel.isCollapsed && this.modalEl.contains(sel.anchorNode) && !!sel.toString();
	}

	private render(): void {
		const list = this.listEl;
		this.entries.forEach((e, i) => {
			let el = this.pool[i];
			if (!el) {
				el = list.createDiv();
				this.pool[i] = el;
			} else if (el.parentElement !== list) list.append(el);
			fillRow(el, e, i, this.rowKeys);
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
			// No note selected: the preview lets go of the last one.
			this.schedulePreview();
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
				this.moved = true;
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
			this.restoring = true;
			try {
				this.refresh(true);
			} finally {
				this.restoring = false;
			}
			return;
		}
		if (e.type === "create") {
			if (!this.host.create) return;
			this.opened = true;
			this.host.create(e.text, this.where()[0]?.id);
			this.close();
			return;
		}
		if (e.type === "widen") {
			this.widen();
			return;
		}
		if (e.type === "more") {
			// The rest of the group, in place; the row that was "more" is now its next note.
			this.expanded.add(e.group);
			this.paint(this.lastEntries, this.statusEl.textContent ?? "");
			return;
		}
		if (e.type === "core") {
			this.opened = true;
			this.host.coreSearch?.(e.query);
			this.close();
			return;
		}
		if (e.type !== "item") return;
		this.opened = true;
		// A note found by its text opens at the hit, not at the top.
		this.host.open(e.path, how, openAt(e));
		this.close();
	}

	private keys(): void {
		// Our Escape replaces the Modal's: it clears the text first, then closes.
		const scope = this.scope as unknown as { keys?: Array<{ key: string | null }>; unregister(h: unknown): void };
		const escapes = (scope.keys ?? []).filter((k) => k.key === "Escape");
		for (const k of escapes) scope.unregister(k);
		this.scope.register([], "Escape", (e) => {
			// An input method's Esc is its own.
			if (e.isComposing) return;
			if (this.actPanel) {
				this.closeActions();
				return false;
			}
			if (this.ac) {
				this.acClosedFor = this.inputEl.value.slice(this.ac.from, this.ac.to);
				this.closeAC();
				return false;
			}
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
			} else if (this.inputEl.value || this.chip || this.filters.length) this.clearAll();
			else this.close();
			return false;
		});
		// Your keys: each action on the key you gave it, the default otherwise.
		const reg = (a: KeyAction, fn: (e: KeyboardEvent) => false | undefined | void): void => {
			const combo = this.k[a];
			// On ⌘C (your default for Copy link), text you selected (in the box, the preview) is copied as usual.
			const copy = systemCopy(combo);
			this.scope.register(combo.mods, combo.key, (e) => (copy && this.textSelected() ? undefined : fn(e)));
		};
		// Tab accepts the suggestion, or the name alone with nothing typed yet.
		reg("back", (e) => {
			if (e.isComposing) return;
			// A scope offered while one is on: the other choice than ⇥'s.
			const s = this.typing.suggest;
			if (this.chip && s && !s.others.length) {
				this.applyChip(s.scope, s.rest, [s.scope], this.another() === "add" ? "switch" : "add");
				return false;
			}
			if (!this.chip || this.choices.length < 2) return;
			this.cycle(-1);
			return false;
		});
		reg("accept", (e) => {
			if (e.isComposing) return;
			if (this.ac) {
				this.acceptAC();
				return false;
			}
			if (this.fix && !this.typing.suggest) {
				this.applyFix();
				return false;
			}
			if (this.chip && !this.typing.suggest && !this.typing.hint) {
				if (this.choices.length < 2) return;
				this.cycle(1);
				return false;
			}
			// Nothing typed: the open note's scope (the empty state's first chip).
			if (!this.inputEl.value.trim()) {
				const row = this.entries.find((x) => x.type === "scopes");
				const here = row?.type === "scopes" ? row.chips.find((c) => c.here) : undefined;
				if (here) {
					this.applyChip(here.scope, "");
					return false;
				}
			}
			const s = this.typing.suggest;
			if (s) {
				this.applyChip(s.scope, s.rest, [s.scope, ...s.others]);
				return false;
			}
			if (this.typing.hint) {
				this.applyChip(this.typing.hint, "", [this.typing.hint, ...(this.typing.hintOthers ?? [])]);
				return false;
			}
		});
		// ⌫ at the start selects the chip, then removes it; ← at the start opens its card.
		this.scope.register([], "Backspace", (e) => {
			// In the ⌘K panel's box, ⌫ edits that box, not the search's chips.
			if (this.actPanel || e.isComposing || !this.atStart()) return;
			// The last chip first: filters, then the scope.
			if (this.filters.length) {
				if (!this.filterSel) {
					this.filterSel = true;
					this.chipSelected = false;
					this.drawFilters();
					return false;
				}
				// Removed, as a chip's × does (putting it back as text re-made a quoted one at once).
				this.filters.pop();
				this.filterSel = false;
				this.refresh();
				return false;
			}
			if (!this.chip) return;
			if (this.autoUndo) {
				// Back to the chip Auto replaced, if any, with the name as text.
				const prev = this.autoPrev;
				this.removeChip(true, this.autoName ?? undefined);
				if (prev) {
					this.chip = prev.chip;
					this.kept = prev.kept;
					this.choices = [prev.chip];
					this.refresh();
				}
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
			if (this.actPanel || e.isComposing || !this.chip || !this.atStart()) return;
			this.chipSelected = true;
			this.drawScope();
			this.showCard();
			this.footer(this.inputEl.value);
			return false;
		});
		this.scope.register([], "ArrowDown", (e) => {
			if (e.isComposing) return;
			if (this.actPanel) {
				this.moveAction(1);
				return false;
			}
			if (this.ac) {
				this.acIndex = (this.acIndex + 1) % this.ac.items.length;
				this.drawAC();
			} else this.move(1);
			return false;
		});
		this.scope.register([], "ArrowUp", (e) => {
			if (e.isComposing) return;
			if (this.actPanel) {
				this.moveAction(-1);
				return false;
			}
			if (this.ac) {
				this.acIndex = (this.acIndex - 1 + this.ac.items.length) % this.ac.items.length;
				this.drawAC();
			} else this.move(-1);
			return false;
		});
		this.scope.register(["Ctrl"], "n", () => {
			if (this.actPanel) this.moveAction(1);
			else this.move(1);
			return false;
		});
		this.scope.register(["Ctrl"], "p", () => {
			if (this.actPanel) this.moveAction(-1);
			else this.move(-1);
			return false;
		});
		// A page at a time.
		const page = (step: number): false => {
			const h = this.listEl.clientHeight;
			const rows = h > 0 ? Math.max(1, Math.floor(h / 44) - 1) : 8;
			for (let k = 0; k < rows; k++) this.move(step);
			return false;
		};
		this.scope.register([], "PageDown", () => page(1));
		this.scope.register([], "PageUp", () => page(-1));
		reg("open", (e) => {
			if (e.isComposing) return false;
			if (this.actPanel) this.runAction();
			else if (this.ac) this.acceptAC();
			else this.choose("default");
			return false;
		});
		// Open moved off ↵: ↵ still runs the ⌘K panel's action and takes a value from the list.
		if (this.k.open.key !== "Enter" || this.k.open.mods.length)
			this.scope.register([], "Enter", (e) => {
				if (e.isComposing) return false;
				if (this.actPanel) this.runAction();
				else if (this.ac) this.acceptAC();
				else return;
				return false;
			});
		reg("openOther", () => {
			this.choose("other");
			return false;
		});
		reg("split", () => {
			this.choose("split");
			return false;
		});
		// ⌘J: by meaning or by words, for this search.
		reg("meaning", () => {
			this.toggleMeaning();
			return false;
		});
		// ⌘⇧S: the next order.
		reg("sort", () => {
			const i = SORTS.findIndex(([k]) => k === this.sort);
			this.setSort((SORTS[(i + 1) % SORTS.length] as [Sort, string])[0]);
			return false;
		});
		// ⌘K: the selected note's actions.
		reg("actions", () => {
			if (this.actPanel) this.closeActions();
			else this.openActions();
			return false;
		});
		// ⌘⇧L: copy the note's obsidian:// URL.
		reg("copyUrl", () => {
			const e = this.entries[this.selected];
			if (e?.type === "item") this.host.act?.("copy-url", e.path);
			return false;
		});
		// ⌘⌃C: the note's full path on disk.
		reg("copyPath", () => {
			const e = this.entries[this.selected];
			if (e?.type === "item") this.host.act?.("copy-path", e.path);
			return false;
		});
		reg("filters", () => {
			if (!this.host.filters) return;
			this.toggleBar();
			return false;
		});
		reg("nextHit", () => {
			this.preview.step(1);
			return false;
		});
		reg("prevHit", () => {
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
		reg("preview", () => {
			this.host.setPreviewOn(!this.host.previewOn());
			// As the host has it now: a host with no preview (search in this note) stays without.
			const on = this.host.previewOn();
			this.modalEl.toggleClass("is-preview-off", !on);
			this.preview.path = null;
			if (on) this.schedulePreview();
			return false;
		});
		reg("copyLink", () => {
			const e = this.entries[this.selected];
			if (e?.type === "item") this.host.copyLink?.(e.path);
			return false;
		});
		reg("insertLink", () => {
			const e = this.entries[this.selected];
			if (e?.type !== "item" || !this.host.insertLink) return false;
			this.opened = true;
			this.host.insertLink(e.path);
			this.close();
			return false;
		});
		reg("create", () => {
			const text = this.inputEl.value.trim();
			if (!text || !this.host.create) return false;
			this.opened = true;
			this.host.create(text, this.where()[0]?.id);
			this.close();
			return false;
		});
	}

	// ── The ⌘K panel ──────────────────────────────────

	private openActions(): void {
		const e = this.entries[this.selected];
		if (e?.type !== "item" || !this.host.actions) return;
		const all = this.host.actions(e.path);
		if (!all.length) return;
		const el = this.contentEl.createDiv({ cls: "jet-act" });
		el.createDiv({ cls: "jet-acth" }).appendText(`Actions for ${e.title}`);
		const row = el.createDiv({ cls: "jet-actin" });
		setIcon(row.createSpan({ cls: "jet-actsi" }), "search");
		const input = row.createEl("input", {
			cls: "jet-actq",
			attr: { type: "text", placeholder: "Search actions…" },
		});
		el.createDiv({ cls: "jet-actl" });
		input.addEventListener("input", () => this.filterActions());
		el.addEventListener("mousedown", (ev) => {
			if (ev.target !== input) ev.preventDefault();
		});
		this.actPanel = { el, input, path: e.path, all, shown: all, i: 0 };
		this.drawActions();
		this.footerActions();
		input.focus();
	}

	private closeActions(): void {
		this.actPanel?.el.remove();
		this.actPanel = null;
		this.inputEl.focus();
		this.footer(this.inputEl.value);
	}

	private filterActions(): void {
		const a = this.actPanel;
		if (!a) return;
		const q = a.input.value.trim().toLowerCase();
		a.shown = q ? a.all.filter((x) => x.label.toLowerCase().includes(q)) : a.all;
		a.i = 0;
		this.drawActions();
	}

	private moveAction(step: number): void {
		const a = this.actPanel;
		if (!a || !a.shown.length) return;
		a.i = (a.i + step + a.shown.length) % a.shown.length;
		this.drawActions();
		// The selected action in view, as list rows are.
		this.modalEl.querySelector<HTMLElement>(".jet-act .is-selected")?.scrollIntoView?.({ block: "nearest" });
	}

	private runAction(): void {
		const a = this.actPanel;
		const x = a?.shown[a.i];
		if (!a || !x) return;
		const close = this.host.act?.(x.id, a.path) ?? false;
		this.closeActions();
		if (close) {
			this.opened = true;
			this.close();
		}
	}

	private drawActions(): void {
		const a = this.actPanel;
		if (!a) return;
		const list = a.el.querySelector<HTMLElement>(".jet-actl");
		if (!list) return;
		list.empty();
		let group = a.shown[0]?.group ?? 0;
		a.shown.forEach((x, i) => {
			if ((x.group ?? 0) !== group) {
				list.createDiv({ cls: "jet-actsep" });
				group = x.group ?? 0;
			}
			const r = list.createDiv({ cls: `jet-actr${i === a.i ? " is-selected" : ""}` });
			setIcon(r.createSpan({ cls: "jet-acti" }), x.icon);
			r.createSpan({ cls: "jet-actn", text: x.label });
			if (x.detail) r.createSpan({ cls: "jet-actd", text: x.detail });
			if (x.key) r.createEl("kbd", { text: x.key });
			r.addEventListener("mousemove", () => {
				if (a.i === i) return;
				a.i = i;
				this.drawActions();
			});
			r.addEventListener("click", () => {
				a.i = i;
				this.runAction();
			});
		});
		if (!a.shown.length) list.createDiv({ cls: "jet-actnone", text: "No such action" });
	}

	private footerActions(): void {
		this.footEl.empty();
		const keys: Array<[string, string]> = [
			[this.lab("open"), "Run"],
			["↑↓", "Choose"],
			["Esc", "Back to results"],
		];
		for (const [key, label] of keys) {
			const h = this.footEl.createSpan({ cls: "jet-ht" });
			h.createEl("kbd", { text: key });
			h.appendText(label);
		}
	}

	private atStart(): boolean {
		return this.inputEl.selectionStart === 0 && this.inputEl.selectionEnd === 0;
	}
}

/** The keys a row shows, as you set them. */
type RowKeys = { open: string; create: string; accept: string; meaning: string; sort: string };

/** A scope in a list: "Cobalt · [Projects] (34)". */
export const scopeListLabel = (v: ScopeView): string =>
	`${v.name}${v.kind ? ` · [${v.kind}]` : ""} (${v.members.toLocaleString()})`;

/** Keys the chip handles itself; any other key unselects it. */
const CHIP_KEYS = new Set(["Backspace", "ArrowLeft", "Escape", "Tab", "Shift", "Meta", "Alt", "Control"]);

const selectable = (e: Entry): boolean => e.type !== "header" && e.type !== "notice" && e.type !== "scopes";
const MODE_NAMES: ReadonlyArray<[MeaningMode, string]> = [
	["words", "Words"],
	["meaning", "Meaning"],
	["both", "Both"],
];
const keyOf = (e: Entry): string | null =>
	e.type === "item"
		? `n:${e.path}${e.at ? `:${e.at.line}` : ""}`
		: e.type === "search"
			? `s:${e.query}`
			: e.type === "create"
				? `c:${e.text}`
				: e.type === "widen"
					? `w:${e.label}`
					: e.type === "core"
						? `o:${e.query}`
						: e.type === "more"
							? `m:${e.group}`
							: null;

/** Fill a pooled row element for an entry (rebuilt each time: rows are few and small). */
const fillRow = (el: HTMLElement, e: Entry, i: number, keys: RowKeys): void => {
	el.replaceChildren();
	el.className = "";
	el.dataset.index = String(i);
	el.id = `jet-row-${i}`;
	if (e.type === "header") {
		el.className = "jet-h";
		el.removeAttribute("role");
		el.createSpan({ text: e.label });
		if (e.note) el.createSpan({ cls: "jet-hscope", text: `· ${e.note}` });
		if (e.switch) {
			// Words, meaning or both, one click away; ⌘J (your key) moves to the next.
			const seg = el.createSpan({
				cls: "jet-seg",
				attr: { role: "group", "aria-label": `Words, meaning or both (${keys.meaning})` },
			});
			for (const [m, name] of MODE_NAMES)
				seg.createSpan({
					cls: `jet-segb${m === e.switch ? " is-on" : ""}`,
					text: name,
					attr: { role: "button", "data-mode": m, "aria-pressed": String(m === e.switch) },
				});
		}
		if (e.sort) {
			const s = el.createSpan({ cls: "jet-sort", attr: { role: "button", "aria-label": `Sort (${keys.sort})` } });
			s.appendText(e.sort);
			setIcon(s.createSpan({ cls: "jet-sorti" }), "chevron-down");
		}
		if (e.count !== undefined) el.createSpan({ cls: "jet-hs", text: String(e.count) });
		return;
	}
	if (e.type === "scopes") {
		// One line that slides: ‹ › at the ends while there is more that way, a fade, counts.
		el.className = "jet-scrow is-slide";
		el.removeAttribute("role");
		el.createSpan({ cls: "jet-scl", text: e.label });
		const fadeL = el.createSpan({ cls: "jet-scfade is-l" });
		const fadeR = el.createSpan({ cls: "jet-scfade is-r" });
		const prev = el.createSpan({
			cls: "jet-scarrow is-l",
			attr: { role: "button", "aria-label": "Earlier scopes" },
		});
		const next = el.createSpan({ cls: "jet-scarrow is-r", attr: { role: "button", "aria-label": "More scopes" } });
		setIcon(prev, "chevron-left");
		setIcon(next, "chevron-right");
		const row = el.createDiv({ cls: "jet-schips" });
		e.chips.forEach((c, i) => {
			const chip = row.createSpan({
				cls: `jet-schip${c.here ? " is-here" : ""}`,
				attr: { "data-i": String(i), role: "button" },
			});
			chip.appendText(c.scope.name);
			chip.createSpan({ cls: "jet-scn", text: c.scope.members.toLocaleString() });
			if (c.here) chip.createEl("kbd", { text: keys.accept });
		});
		row.createSpan({
			cls: "jet-schip is-all",
			text: `All ${(e.chips.length + e.more).toLocaleString()} ▾`,
			attr: { role: "button" },
		});
		const ends = (): void => {
			const more = row.scrollWidth - row.clientWidth > 1;
			const atL = row.scrollLeft <= 1;
			const atR = row.scrollLeft >= row.scrollWidth - row.clientWidth - 1;
			prev.toggleClass("is-hidden", !more || atL);
			fadeL.toggleClass("is-hidden", !more || atL);
			next.toggleClass("is-hidden", !more || atR);
			fadeR.toggleClass("is-hidden", !more || atR);
		};
		const slide = (dir: number) => (ev: MouseEvent) => {
			ev.preventDefault();
			ev.stopPropagation();
			row.scrollBy({ left: dir * Math.max(120, row.clientWidth * 0.7), behavior: "smooth" });
		};
		prev.addEventListener("mousedown", slide(-1));
		next.addEventListener("mousedown", slide(1));
		// Resting the pointer on an arrow slides the line that way, until it leaves or the end shows;
		// no click is needed.
		const win = row.win ?? window;
		let gliding = 0;
		const glide = (dir: number): void => {
			win.cancelAnimationFrame(gliding);
			const step = (): void => {
				const before = row.scrollLeft;
				row.scrollLeft += dir * 6;
				if (row.scrollLeft !== before) gliding = win.requestAnimationFrame(step);
			};
			gliding = win.requestAnimationFrame(step);
		};
		const stop = (): void => win.cancelAnimationFrame(gliding);
		prev.addEventListener("mouseenter", () => glide(-1));
		next.addEventListener("mouseenter", () => glide(1));
		prev.addEventListener("mouseleave", stop);
		next.addEventListener("mouseleave", stop);
		row.addEventListener("scroll", ends, { passive: true });
		// A vertical wheel slides the line sideways (most mice have no sideways wheel).
		row.addEventListener(
			"wheel",
			(ev) => {
				if (Math.abs(ev.deltaY) <= Math.abs(ev.deltaX)) return;
				// Nothing to slide: the wheel scrolls the list.
				if (row.scrollWidth - row.clientWidth <= 1) return;
				ev.preventDefault();
				row.scrollLeft += ev.deltaY;
			},
			{ passive: false },
		);
		window.requestAnimationFrame(ends);
		return;
	}
	if (e.type === "notice") {
		// Nothing found is red, with an alert icon.
		el.className = e.info ? "jet-notice" : "jet-notice is-error";
		el.removeAttribute("role");
		setIcon(el.createSpan({ cls: "jet-ic" }), e.info ? "info" : "alert-circle");
		const b = el.createDiv({ cls: "jet-rb" });
		b.createDiv({ cls: "jet-nt", text: e.title });
		if (e.detail) b.createDiv({ cls: "jet-nd", text: e.detail });
		return;
	}
	el.setAttr("role", "option");
	el.setAttr("aria-selected", "false");
	// Suggestions: tinted cards, the accent on their icon and title, the key on the right.
	const card = (icon: string, title: string, detail: string | undefined, key: string): void => {
		el.className = "jet-row jet-rowt jet-sugg";
		setIcon(el.createSpan({ cls: "jet-ic" }), icon);
		const b = el.createDiv({ cls: "jet-rb" });
		const l1 = b.createDiv({ cls: "jet-l1" });
		l1.createSpan({ cls: "jet-rt", text: title });
		l1.createSpan({ cls: `jet-skey${key === keys.open ? " is-enter" : ""}` }).createEl("kbd", { text: key });
		if (detail) b.createDiv({ cls: "jet-l2" }).createSpan({ cls: "jet-cr", text: detail });
	};
	if (e.type === "more") {
		el.className = "jet-row jet-more";
		const t = el.createDiv({ cls: "jet-moret" });
		t.appendText(`${e.n.toLocaleString()} more ${e.label.toLowerCase()} · `);
		t.createSpan({ cls: "jet-morel", text: "Show them" });
		return;
	}
	if (e.type === "core") return card("search-code", "Search with Obsidian Search", e.detail ?? e.query, keys.open);
	if (e.type === "widen") return card("globe", e.label, e.detail, keys.open);
	if (e.type === "search" && e.spelling)
		return card("spell-check", `Did you mean “${e.query}”?`, e.detail, keys.open);
	if (e.type === "create" && e.detail) return card("file-plus", `Create “${e.text}”`, e.detail, keys.create);
	if (e.type === "search" || e.type === "create") {
		el.className = `jet-row ${e.detail ? "jet-rowt" : "jet-row-search"}`;
		setIcon(el.createSpan({ cls: "jet-ic" }), e.type === "create" ? "file-plus" : e.detail ? "search" : "history");
		const b = el.createDiv({ cls: "jet-rb" });
		const label = e.type === "create" ? `Create “${e.text}”` : e.detail ? `Search for “${e.query}”` : e.query;
		const l1 = b.createDiv({ cls: "jet-l1" });
		if (e.type === "search" && e.parts?.length && !e.detail) {
			const t = l1.createSpan({ cls: "jet-rt" });
			for (const p of e.parts)
				if ("chip" in p) {
					const c = t.createSpan({ cls: "jet-mchip" });
					if (p.chip[0]) c.createSpan({ cls: "jet-fh", text: p.chip[0] });
					c.createSpan({ cls: "jet-fv", text: p.chip[1] });
				} else t.appendText(` ${p.text}`);
		} else l1.createSpan({ cls: "jet-rt", text: label });
		if (e.detail) b.createDiv({ cls: "jet-l2" }).createSpan({ cls: "jet-cr", text: e.detail });
		return;
	}
	const content = !!e.excerpt;
	el.className = `${content ? "jet-row jet-rowc" : "jet-row jet-rowt"}${e.dim ? " is-dim" : ""}`;
	setIcon(el.createSpan({ cls: "jet-ic" }), e.icon);
	const body = el.createDiv({ cls: "jet-rb" });
	const l1 = body.createDiv({ cls: "jet-l1" });
	highlight(l1.createSpan({ cls: "jet-rt" }), e.title, e.titleRanges, "jet-th");
	if (e.badge) {
		// Found by meaning; found both ways (by words and meaning); by words, in a list of both.
		const kind = e.meaning
			? " is-meaning"
			: e.badge === "both" || e.badge === "also by meaning"
				? " is-both"
				: e.badge === "by words"
					? " is-words"
					: "";
		l1.createSpan({ cls: `jet-bdg${kind}`, text: e.badge });
	}
	if (e.answer) {
		// Answers (experiment): how much of the question the row's line holds.
		const c = closeness(e.answer.strength);
		const m = l1.createSpan({
			cls: `jet-close is-${c.word}`,
			attr: { "aria-label": `How close its line is to your question: ${c.pct}% of the first row's` },
		});
		m.createSpan({ cls: "jet-cbar" }).createSpan({ cls: "jet-cfill" }).style.width = `${c.pct}%`;
		m.appendText(c.word);
	}
	l1.createSpan({ cls: "jet-rm", text: e.meta });
	const l2 = body.createDiv({ cls: "jet-l2" });
	if (e.crumb) l2.createSpan({ cls: "jet-cr", text: e.crumb });
	for (const r of e.reasons ?? []) l2.createSpan({ cls: "jet-rsn", text: r });
	if (e.excerpt) {
		if (e.excerpt.more) l2.createSpan({ cls: "jet-more", text: `+${e.excerpt.more} more` });
		const l3 = body.createDiv({ cls: "jet-l3" });
		if (e.answer) answerHighlight(l3, e.excerpt.text, e.excerpt.marks, e.answer.nums);
		else highlight(l3, e.excerpt.text, e.excerpt.marks, "jet-mark", "mark");
	}
};

/**
 * An answer line (experiment): the question's words marked as in any excerpt, the answer's figures
 * coloured; a figure that is also a question word is coloured.
 */
const answerHighlight = (el: HTMLElement, text: string, marks: Ranges, nums: Ranges): void => {
	el.replaceChildren();
	const kind = new Uint8Array(text.length);
	for (const [a, b] of marks) kind.fill(1, Math.max(0, a), Math.min(text.length, b));
	for (const [a, b] of nums) kind.fill(2, Math.max(0, a), Math.min(text.length, b));
	let at = 0;
	while (at < text.length) {
		const k = kind[at] as number;
		let end = at + 1;
		while (end < text.length && kind[end] === k) end++;
		const piece = text.slice(at, end);
		if (k === 1) el.createEl("mark", { cls: "jet-mark", text: piece });
		else if (k === 2) el.createSpan({ cls: "jet-num", text: piece });
		else el.appendText(piece);
		at = end;
	}
};
