import type { Explained } from "../explain/explainer";
import type { Table, View } from "../explain/view";
import { noted } from "../diag/diag";

export type Tab = "note" | "search" | "expected";
export type Mode = "words" | "meaning";
export type Pick = { path: string; name: string };
export type Candidate = Pick & { folder: string };

/** What the pane needs of the window and the plugin. */
export type PaneIo = {
	/** Explain the search, and the note (none: the search alone). */
	explain(note: Pick | null, mode: Mode): Promise<Explained>;
	/** Notes whose name matches what was typed, best first. */
	find(text: string): Candidate[];
	/** Keep the explanation for the support info. */
	keep(e: Explained): void;
	/** Show the support info, with the explanation in it. */
	support(): void;
	/** Back to the list (where the pane takes the whole window). */
	back(): void;
};

const TABS: Array<[Tab, string]> = [
	["note", "This note"],
	["search", "The search"],
	["expected", "A note I expected"],
];
/** The rest after the last change in the list or the selection, before the worker is asked. */
const REST_MS = 120;
const SUGGESTIONS = 6;

/**
 * The explanation, in the place of the preview. It asks for nothing until it is opened, and then once
 * after each change that settles (the selection, the text, the note picked). Drawing is from the facts
 * the plugin gives it; it holds no word of the search beyond the screen.
 */
export class ExplainPane {
	readonly el: HTMLElement;
	private readonly tabsEl: HTMLElement;
	private readonly bodyEl: HTMLElement;
	private readonly barEl: HTMLElement;
	private tab: Tab = "search";
	private mode: Mode = "words";
	private both = false;
	private selected: Pick | null = null;
	private expected: Pick | null = null;
	private typed = "";
	private choices: Candidate[] = [];
	private chosen = 0;
	private result: Explained | null = null;
	private token = 0;
	private timer: number | null = null;
	private failed = false;
	shown = false;

	constructor(
		parent: HTMLElement,
		private readonly io: PaneIo,
	) {
		this.el = parent.createDiv({ cls: "jet-ex", attr: { "aria-label": "Why these results" } });
		const card = this.el.createDiv({ cls: "jet-exc" });
		const up = card.createDiv({ cls: "jet-ex-up", text: "‹ Results", attr: { role: "button" } });
		up.addEventListener("mousedown", (e) => e.preventDefault());
		up.addEventListener("click", () => this.io.back());
		this.tabsEl = card.createDiv({ cls: "jet-ex-tabs", attr: { role: "tablist" } });
		this.bodyEl = card.createDiv({ cls: "jet-ex-body", attr: { "aria-live": "polite" } });
		this.barEl = card.createDiv({ cls: "jet-ex-bar" });
	}

	/** Open on the selected note's tab, or on the search's when no note is selected. */
	open(selected: Pick | null, mode: Mode, both: boolean): void {
		this.shown = true;
		this.selected = selected;
		this.mode = mode;
		this.both = both;
		this.tab = selected ? "note" : "search";
		this.draw();
		this.ask(0);
	}

	close(): void {
		this.shown = false;
		this.token++;
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = null;
	}

	/** A different row is selected. */
	select(selected: Pick | null, mode?: Mode): void {
		if (!this.shown) return;
		const same = this.selected?.path === selected?.path;
		this.selected = selected;
		if (mode && this.both) this.mode = mode;
		if (!selected && this.tab === "note") this.tab = "search";
		if (same && !mode) return;
		this.draw();
		this.ask();
	}

	/** The list changed (more text typed, a filter): ask again once it settles. */
	refresh(): void {
		if (this.shown) this.ask();
	}

	/** The tabs that can be shown now, in order. */
	private tabs(): Tab[] {
		return TABS.map(([t]) => t).filter((t) => t !== "note" || this.selected);
	}

	cycle(by: 1 | -1): void {
		const all = this.tabs();
		const next = all[(all.indexOf(this.tab) + by + all.length) % all.length] ?? "search";
		this.go(next);
	}

	private go(tab: Tab): void {
		this.tab = tab;
		this.draw();
		if (tab === "expected") this.bodyEl.querySelector<HTMLInputElement>(".jet-ex-in")?.focus();
		else this.ask(0);
	}

	/** Esc: the typed name first, then the pane. True when the pane stays. */
	escape(): boolean {
		if (this.tab === "expected" && (this.typed || this.expected)) {
			this.typed = "";
			this.expected = null;
			this.choices = [];
			this.result = null;
			this.draw();
			this.bodyEl.querySelector<HTMLInputElement>(".jet-ex-in")?.focus();
			return true;
		}
		return false;
	}

	private ask(wait = REST_MS): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		const token = ++this.token;
		const note = this.tab === "note" ? this.selected : this.tab === "expected" ? this.expected : null;
		if (this.tab === "expected" && !note) {
			this.result = null;
			this.draw();
			return;
		}
		this.timer = window.setTimeout(() => {
			this.timer = null;
			this.failed = false;
			this.io
				.explain(note, this.mode)
				.then((r) => {
					if (token !== this.token) return;
					this.result = r;
					this.draw();
				})
				.catch((e: unknown) => {
					if (token !== this.token) return;
					noted("explain.run", e);
					this.failed = true;
					this.result = null;
					this.draw();
				});
		}, wait);
	}

	private draw(): void {
		const hadFocus = this.bodyEl.querySelector<HTMLInputElement>(".jet-ex-in") === activeDocument.activeElement;
		this.tabsEl.empty();
		for (const t of this.tabs()) {
			const label = TABS.find(([k]) => k === t)?.[1] ?? "";
			const el = this.tabsEl.createSpan({
				cls: `jet-ex-tab${t === this.tab ? " is-on" : ""}`,
				text: label,
				attr: { role: "tab", "aria-selected": String(t === this.tab) },
			});
			el.addEventListener("mousedown", (e) => e.preventDefault());
			el.addEventListener("click", () => this.go(t));
		}
		if (this.both) {
			this.tabsEl.createSpan({ cls: "jet-sp" });
			for (const m of ["words", "meaning"] as const) {
				const el = this.tabsEl.createSpan({
					cls: `jet-ex-tab jet-ex-mode${m === this.mode ? " is-on" : ""}`,
					text: m === "words" ? "By words" : "By meaning",
				});
				el.addEventListener("mousedown", (e) => e.preventDefault());
				el.addEventListener("click", () => {
					this.mode = m;
					this.draw();
					this.ask(0);
				});
			}
		}
		const typedBefore = this.typed;
		this.bodyEl.empty();
		this.barEl.empty();
		if (this.tab === "expected") this.drawFinder();
		this.drawView();
		if (this.tab === "expected" && hadFocus) {
			const input = this.bodyEl.querySelector<HTMLInputElement>(".jet-ex-in");
			input?.focus();
			input?.setSelectionRange(typedBefore.length, typedBefore.length);
		}
	}

	private drawFinder(): void {
		const field = this.bodyEl.createDiv({ cls: "jet-ex-find" });
		field.createDiv({ cls: "jet-ex-lab", text: "A note you expected to see" });
		const input = field.createEl("input", {
			cls: "jet-ex-in",
			attr: { type: "text", placeholder: "Start typing a note's name", spellcheck: "false", role: "combobox" },
		});
		input.value = this.expected ? this.expected.name : this.typed;
		input.addEventListener("input", () => {
			this.typed = input.value;
			this.expected = null;
			this.choices = this.typed.trim() ? this.io.find(this.typed) : [];
			this.chosen = 0;
			this.result = null;
			this.drawChoices(field);
		});
		input.addEventListener("keydown", (e) => {
			if (e.isComposing) return;
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				if (!this.choices.length) return;
				this.chosen =
					(this.chosen + (e.key === "ArrowDown" ? 1 : -1) + this.choices.length) % this.choices.length;
				this.drawChoices(field);
				e.preventDefault();
				e.stopPropagation();
			} else if (e.key === "Enter") {
				const pick = this.choices[this.chosen];
				if (pick) this.pickNote(pick);
				e.preventDefault();
				e.stopPropagation();
			}
		});
		this.drawChoices(field);
	}

	private drawChoices(field: HTMLElement): void {
		field.querySelector(".jet-ex-list")?.remove();
		if (!this.choices.length || this.expected) return;
		const ul = field.createDiv({ cls: "jet-ex-list", attr: { role: "listbox" } });
		this.choices.slice(0, SUGGESTIONS).forEach((c, i) => {
			const row = ul.createDiv({
				cls: `jet-ex-opt${i === this.chosen ? " is-on" : ""}`,
				attr: { role: "option", "aria-selected": String(i === this.chosen) },
			});
			row.createSpan({ cls: "jet-ex-oname", text: c.name });
			if (c.folder) row.createSpan({ cls: "jet-ex-ofolder", text: c.folder });
			row.addEventListener("mousedown", (e) => e.preventDefault());
			row.addEventListener("click", () => this.pickNote(c));
		});
	}

	private pickNote(c: Candidate): void {
		this.expected = { path: c.path, name: c.name };
		this.typed = c.name;
		this.choices = [];
		this.draw();
		this.ask(0);
	}

	private drawView(): void {
		const r = this.result;
		const want = this.tab === "note" ? "note" : this.tab === "search" ? "search" : "note";
		if (this.tab === "expected" && !this.expected) return;
		if (this.tab === "note" && !this.selected) {
			this.bodyEl.createDiv({ cls: "jet-ex-hint", text: "Select a note in the list to see why it is there." });
			return;
		}
		if (this.failed) {
			this.bodyEl.createDiv({
				cls: "jet-ex-hint",
				text: "Jet could not explain this search. Try again, or copy the support info and report it.",
			});
			return;
		}
		const view: View | null = r ? (want === "search" ? r.search : r.note) : null;
		if (!view) {
			this.bodyEl.createDiv({ cls: "jet-ex-hint", text: "Looking…" });
			return;
		}
		const verdict = this.bodyEl.createDiv({ cls: `jet-ex-verdict ${view.tone === "ok" ? "is-ok" : "is-warn"}` });
		verdict.createDiv({ cls: "jet-ex-v1", text: view.head });
		if (view.detail) verdict.createDiv({ cls: "jet-ex-v2", text: view.detail });
		for (const t of view.tables) this.drawTable(t);
		for (const n of view.notes) this.bodyEl.createDiv({ cls: "jet-ex-note", text: n });
		this.drawSetup(view.setup);
		const btn = this.barEl.createEl("button", {
			cls: "jet-ex-add mod-cta",
			text: "Add to support info",
			attr: { "aria-label": "Opens the support info with this explanation in it" },
		});
		btn.addEventListener("mousedown", (e) => e.preventDefault());
		btn.addEventListener("click", () => {
			if (!this.result) return;
			this.io.keep(this.result);
			this.io.support();
		});
	}

	/** How the search was set: plain facts, one to a line, under the answer. */
	private drawSetup(rows: ReadonlyArray<readonly [string, string]>): void {
		const sec = this.bodyEl.createDiv({ cls: "jet-ex-sl" });
		sec.createEl("h4", { text: "How this search was set" });
		const dl = sec.createEl("dl", { cls: "jet-ex-dl" });
		for (const [label, value] of rows) {
			dl.createEl("dt", { text: label });
			dl.createEl("dd", { text: value });
		}
	}

	private drawTable(t: Table): void {
		const sec = this.bodyEl.createDiv({ cls: "jet-ex-sec" });
		sec.createEl("h4", { text: t.title });
		if (t.cards) {
			for (const row of t.rows) {
				const [title, ...rest] = row;
				const card = sec.createDiv({ cls: "jet-ex-wc" });
				const name = card.createDiv({ cls: "jet-ex-wn", text: title?.text ?? "" });
				if (title?.note) name.createEl("i", { text: title.note });
				const figs = card.createDiv({ cls: "jet-ex-figs" });
				rest.forEach((c, i) => {
					const fig = figs.createDiv({ cls: "jet-ex-fig" });
					fig.createDiv({ cls: "jet-ex-fl", text: t.head[i + 1] ?? "" });
					fig.createDiv({ cls: "jet-ex-fv", text: c.text });
				});
			}
			return;
		}
		const table = sec.createEl("table");
		if (t.head.some(Boolean)) {
			const tr = table.createEl("thead").createEl("tr");
			for (const h of t.head) tr.createEl("th", { text: h });
		}
		const tb = table.createEl("tbody");
		for (const row of t.rows) {
			const tr = tb.createEl("tr");
			for (const c of row) {
				const td = tr.createEl("td");
				if (c.pill) td.createSpan({ cls: `jet-ex-pill is-${c.pill}`, text: c.text });
				else td.setText(c.text);
			}
		}
	}
}
