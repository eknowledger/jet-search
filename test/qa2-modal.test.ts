/**
 * QA: the search modal's UI and keys: rows and selection, the preview pane,
 * the ⌘K panel, recents and the scopes row, hints, IME composition, the @ list. Every test here fails
 * on the code as it is, for the reason in its name.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, FuzzySuggestModal, Menu, Notice, type Scope as KeyScope, TFile, TFolder } from "obsidian";
import { normalizeData } from "../src/data";
import type { Filter } from "../src/filters/filter";
import { FilterSets } from "../src/filters/sets";
import { type HostScopes, JetHost } from "../src/host";
import JetSearchPlugin from "../src/main";
import {
	type Completion,
	type Entry,
	JetModal,
	type ModalHost,
	type NoteAction,
	type ScopeView,
} from "../src/modal/jet-modal";
import { sectionAround } from "../src/preview/section";
import type { Scope } from "../src/scopes/model";
import { Search } from "../src/search";

type Item = Extract<Entry, { type: "item" }>;
type Mods = Parameters<KeyScope["register"]>[0];

const item = (path: string, extra: Partial<Item> = {}): Item => ({
	type: "item",
	path,
	title: path.replace(/\.md$/, ""),
	titleRanges: [],
	crumb: "",
	meta: "",
	icon: "file-text",
	...extra,
});

const baseHost = (over: Partial<ModalHost> = {}): ModalHost => ({
	placeholder: "Search notes…",
	list: (_t, paint) => paint([]),
	open: () => {},
	hints: () => [["↵", "Open"]],
	closed: () => {},
	previewOn: () => false,
	setPreviewOn: () => {},
	copyLink: () => {},
	insertLink: () => {},
	create: () => {},
	...over,
});

const press = (m: JetModal, key: string, mods: Mods = []): boolean =>
	(m.scope as unknown as { press(k: string, m: unknown[]): boolean }).press(key, mods);

/** A key with event fields the mock's press() leaves out (isComposing), through the modal's own scope. */
const pressEvent = (m: JetModal, key: string, ev: Partial<KeyboardEvent>, mods: string[] = []): boolean => {
	const scope = m.scope as unknown as {
		keys: Array<{ modifiers: string[]; key: string | null; func: (e: KeyboardEvent) => unknown }>;
	};
	const want = [...mods].sort().join(",");
	for (const k of scope.keys)
		if (k.key === key && [...k.modifiers].sort().join(",") === want)
			if (k.func({ key, isComposing: false, ...ev } as KeyboardEvent) === false) return true;
	return false;
};

const type = (m: JetModal, text: string) => {
	m.inputEl.value = text;
	m.inputEl.setSelectionRange(text.length, text.length);
	m.inputEl.dispatchEvent(new Event("input"));
};
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const selected = () => $(".jet-row.is-selected")?.dataset.index;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const footer = () => $(".jet-ft")?.textContent ?? "";

/** An App whose notes have text (the mock's cachedRead returns ""); each read is logged in vault.calls. */
const appWith = (notes: Record<string, string>) => {
	const app = new App();
	for (const p of Object.keys(notes)) app.vault.files.set(p, new TFile(p));
	(app.vault as unknown as { cachedRead: (f: TFile) => Promise<string> }).cachedRead = async (f) => {
		app.vault.calls.push(`cachedRead:${f.path}`);
		return notes[f.path] ?? "";
	};
	return app;
};
const marks = () => [...document.querySelectorAll(".jet-pv .jet-pmark")].map((m) => m.textContent);
const previewTitle = () => $(".jet-pv .jet-pti")?.textContent ?? "";
/** Longer than the preview's 80 ms rest. */
const REST = 120;

const SCOPE: ScopeView = { id: "garden", name: "Garden", kind: "Areas", members: 3 };

afterEach(() => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

// ── The preview pane ───────────────────────────────────────────────────────────

describe("QA2 modal: the preview pane", () => {
	it("the preview marks the new words when the same note stays selected as you type on", async () => {
		const app = appWith({ "Plan.md": "alpha and beta" });
		const terms = (t: string) => t.trim().split(/\s+/);
		const m = new JetModal(
			app as never,
			baseHost({
				previewOn: () => true,
				list: (t, paint) => paint([item("Plan.md", { hit: { terms: terms(t) } })]),
			}),
		);
		m.open();
		type(m, "alpha");
		await wait(REST);
		expect(marks()).toEqual(["alpha"]);
		// One more word: Plan.md is still the first row, and has both words.
		type(m, "alpha beta");
		await wait(REST);
		expect(marks()).toEqual(["alpha", "beta"]);
	});

	it("with no note selected (no results, or only “Create …”), the preview no longer shows the previous note", async () => {
		const app = appWith({ "Alpha.md": "alpha text" });
		const m = new JetModal(
			app as never,
			baseHost({
				previewOn: () => true,
				list: (t, paint) =>
					paint(
						t === "alp"
							? [item("Alpha.md")]
							: t === "alpzz"
								? [{ type: "notice", title: `No results for “${t}”` }]
								: [{ type: "create", text: t, detail: "A new note with this name" }],
					),
			}),
		);
		m.open();
		type(m, "alp");
		await wait(REST);
		expect(previewTitle()).toBe("Alpha");
		// Nothing found: no row is selected at all.
		type(m, "alpzz");
		await wait(REST);
		expect(previewTitle()).toBe("");
		// Back to a note, then a list whose only row is "Create …" (selected, not a note).
		type(m, "alp");
		await wait(REST);
		type(m, "alpzzz");
		await wait(REST);
		expect(previewTitle()).toBe("");
	});

	it("results that arrive after Jet closed render no preview (and load no Component)", async () => {
		const app = appWith({ "A.md": "a", "B.md": "b" });
		const painters: Array<(e: Entry[]) => void> = [];
		const m = new JetModal(
			app as never,
			baseHost({
				previewOn: () => true,
				list: (_t, paint) => {
					painters.push(paint);
					paint([item("A.md")]);
				},
			}),
		);
		m.open();
		type(m, "a");
		// ↵ at once on the first row (a name match), before the full text answers.
		press(m, "Enter");
		expect(m.isOpen).toBe(false);
		// The worker's answer for "a" comes in after the close.
		painters.at(-1)?.([item("B.md"), item("A.md")]);
		await wait(REST);
		expect(app.vault.calls.filter((c) => c.startsWith("cachedRead"))).toEqual([]);
	});
});

describe("QA2 preview: the section around the hit", () => {
	it("a `# comment` line inside a code block is not a heading", () => {
		const text = [
			"## Setup",
			"",
			"```bash",
			"# install the tools",
			"npm install",
			"```",
			"",
			"The word to find is here.",
			"",
			"## Next",
			"more",
		].join("\n");
		const { from, to } = sectionAround(text, 0, text.indexOf("find"));
		// From the comment, the preview renders "# install the tools" as a title, and the closing ```
		// opens a code block that holds the hit.
		expect(text.slice(from, to).startsWith("## Setup")).toBe(true);
		expect(text.slice(to).startsWith("## Next")).toBe(true);
	});
});

// ── The list ───────────────────────────────────────────────────────────────────

describe("QA2 modal: moving through the list", () => {
	it("a new search shows its first row: the list is not left scrolled down", () => {
		const many = (p: string) => Array.from({ length: 40 }, (_, i) => item(`${p}${i}.md`));
		const m = new JetModal(
			new App() as never,
			baseHost({ list: (t, paint) => paint(t === "me" ? many("m") : many("n")) }),
		);
		m.open();
		type(m, "me");
		for (let i = 0; i < 30; i++) press(m, "ArrowDown");
		const list = $(".jet-list") as HTMLElement;
		// Where scrollIntoView left the list, 30 rows down.
		list.scrollTop = 1200;
		const scrolled: Element[] = [];
		vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
			scrolled.push(this);
		});
		type(m, "meeting");
		const sel = $(".jet-row.is-selected");
		expect(sel?.dataset.index).toBe("0");
		expect(list.scrollTop === 0 || scrolled.includes(sel as Element)).toBe(true);
	});

	it("PageDown moves the selection a page down a long list", () => {
		const m = new JetModal(
			new App() as never,
			baseHost({ list: (_t, paint) => paint(Array.from({ length: 40 }, (_, i) => item(`n${i}.md`))) }),
		);
		m.open();
		type(m, "n");
		expect(selected()).toBe("0");
		press(m, "PageDown");
		expect(Number(selected())).toBeGreaterThan(1);
	});
});

// ── The ⌘K panel ───────────────────────────────────────────────────────────────

const ACTIONS: NoteAction[] = [
	{ id: "open", label: "Open", icon: "file", key: "↵", group: 0 },
	{ id: "copy-link", label: "Copy wikilink", icon: "link", key: "⌘L", group: 1 },
	{ id: "reveal", label: "Reveal in file explorer", icon: "folder-open", group: 2 },
];

describe("QA2 modal: the ⌘K action panel", () => {
	it("keys typed in the ⌘K panel stay in the panel: ⌫ does not take the search's scope chip, Ctrl+N moves the actions", () => {
		const m = new JetModal(
			new App() as never,
			baseHost({
				list: (_t, paint) => paint([item("Plan.md"), item("Other.md")]),
				restore: () => ({ scope: SCOPE, filters: [] }),
				actions: () => ACTIONS,
				act: () => false,
			}),
		);
		m.open();
		expect($(".jet-chip")?.hasClass("is-hidden")).toBe(false);
		press(m, "k", ["Mod"]);
		const q = $(".jet-actq") as HTMLInputElement;
		q.value = "cx";
		q.dispatchEvent(new Event("input"));
		// Fixing a typo in "cx": two ⌫ in the panel's box (the search box behind it is empty).
		const first = press(m, "Backspace");
		press(m, "Backspace");
		expect(first).toBe(false);
		expect($(".jet-chip")?.hasClass("is-hidden")).toBe(false);
		expect(m.inputEl.value).toBe("");
		// Ctrl+N is ↓ everywhere else in the modal.
		q.value = "";
		q.dispatchEvent(new Event("input"));
		press(m, "n", ["Ctrl"]);
		expect($(".jet-actr.is-selected .jet-actn")?.textContent).toBe("Copy wikilink");
		expect(selected()).toBe("0");
	});

	it("↑ from the first action selects the last one and brings it into view", () => {
		const many: NoteAction[] = Array.from({ length: 11 }, (_, i) => ({
			id: `a${i}`,
			label: `Action ${i}`,
			icon: "file",
			group: i < 4 ? 0 : 1,
		}));
		const m = new JetModal(
			new App() as never,
			baseHost({ list: (_t, paint) => paint([item("Plan.md")]), actions: () => many, act: () => false }),
		);
		m.open();
		press(m, "k", ["Mod"]);
		const scrolled: Element[] = [];
		vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
			scrolled.push(this);
		});
		press(m, "ArrowUp");
		const sel = $(".jet-actr.is-selected");
		expect(sel?.textContent).toBe("Action 10");
		expect(scrolled).toContain(sel);
	});
});

// ── Keys during an IME composition ─────────────────────────────────────────────

describe("QA2 modal: keys while an input method is composing", () => {
	it("Esc and ↓ that an input method uses while composing are left to it (Enter, Tab, ⌫ and ← already are)", () => {
		const m = new JetModal(
			new App() as never,
			baseHost({ list: (_t, paint) => paint([item("a.md"), item("b.md")]) }),
		);
		m.open();
		// Typing Japanese: the composition is still open in the box.
		type(m, "にほんご");
		// ↓ picks the next conversion candidate; Esc cancels the conversion.
		const down = pressEvent(m, "ArrowDown", { isComposing: true });
		pressEvent(m, "Escape", { isComposing: true });
		expect(m.inputEl.value).toBe("にほんご");
		expect(m.isOpen).toBe(true);
		expect(down).toBe(false);
		expect(selected()).toBe("0");
	});
});

// ── ⇧⇧ while open ──────────────────────────────────────────────────────────────

describe("QA2 modal: ⇧⇧ while Jet is open", () => {
	it("⇧⇧ with no scope to widen keeps the search you typed", async () => {
		vi.stubGlobal(
			"Worker",
			class {
				onmessage = null;
				onerror = null;
				postMessage() {}
				terminate() {}
			},
		);
		vi.spyOn(console, "error").mockImplementation(() => {});
		const plugin = new JetSearchPlugin(
			new App() as never,
			{ id: "jet-search", name: "Jet Search", version: "0.0.1" } as never,
		);
		await plugin.onload();
		try {
			plugin.open();
			const box = () => document.querySelector<HTMLInputElement>(".jet-q");
			const b = box() as HTMLInputElement;
			b.value = "garden plan";
			b.dispatchEvent(new Event("input"));
			// What a double tap of Shift calls (main.ts listen() → open()).
			plugin.open();
			expect(box()?.value).toBe("garden plan");
		} finally {
			plugin.unload();
		}
	});
});

// ── Entries built by Search ────────────────────────────────────────────────────

const stubFeeder = (ensure: () => Promise<void> = async () => {}) =>
	({ ensure, ensureMeaning: async () => true, progress: null, meaningProgress: null }) as never;

describe("QA2 search: entries for the modal", () => {
	it("a live refresh (a note changed) keeps the order you chose for a filters-only list", () => {
		const app = new App();
		const paths: string[] = [];
		for (let i = 1; i <= 60; i++) {
			const f = new TFile(`n${i}.md`);
			f.stat.mtime = i * 1000;
			app.vault.files.set(f.path, f);
			paths.push(f.path);
		}
		const keep = new Set(paths);
		const search = new Search(app as never, {} as never, stubFeeder(), () => normalizeData(null), undefined, {
			notes: () => keep,
		});
		const painted: Entry[][] = [];
		const tag: Filter = { kind: "tag", tag: "#work" };
		search.list("", (e) => painted.push(e), undefined, [tag], undefined, "edited-old");
		const first = (e: Entry[] | undefined) => (e?.find((x) => x.type === "item") as Item | undefined)?.path;
		expect(first(painted[0])).toBe("n1.md");
		// feeder.onChanged → search.refresh(): the same list asked again.
		search.refresh();
		expect(first(painted[1])).toBe("n1.md");
	});

	it("a by-meaning row's preview goes to the line its excerpt shows, with its words marked", async () => {
		const body = "Intro paragraph about other things.\n\n## Process\n\nWe ship a release every Friday.\n";
		const app = appWith({ "Ship.md": body });
		const client = { nearest: async () => ({ near: [{ path: "Ship.md", score: 0.9 }], seq: 1 }) };
		const search = new Search(app as never, client as never, stubFeeder(), () => normalizeData(null));
		const painted: Entry[][] = [];
		search.list("how do we ship a release", (e) => painted.push(e), undefined, [], { on: true, offered: false });
		await wait(20);
		const row = painted.at(-1)?.find((x) => x.type === "item") as Item | undefined;
		expect(row?.excerpt?.text).toContain("ship a release");
		// The preview renders around hit.offset and marks hit.terms.
		const offset = row?.hit?.offset;
		expect(offset).toBeTypeOf("number");
		expect(offset ?? -1).toBeGreaterThanOrEqual(body.indexOf("We ship"));
		expect(offset ?? -1).toBeLessThan(body.indexOf("Friday"));
		expect(row?.hit?.terms.length).toBeGreaterThan(0);
	});

	it("while the answer is loading, the list says so (not blank, not “By meaning 0”)", async () => {
		const app = new App();
		const never = () => new Promise<void>(() => {});
		const search = new Search(app as never, {} as never, stubFeeder(never), () => normalizeData(null));
		const words: Array<[Entry[], string | undefined]> = [];
		search.list("zebra crossing", (e, s) => words.push([e, s]));
		const meaning: Array<[Entry[], string | undefined]> = [];
		search.list("how do zebras sleep", (e, s) => meaning.push([e, s]), undefined, [], { on: true, offered: false });
		await wait(10);
		// The index is still opening: no name matched, no full text yet.
		const [wEntries, wStatus] = words.at(-1) ?? [[], ""];
		expect(wEntries.length > 0 || !!wStatus).toBe(true);
		const [mEntries, mStatus] = meaning.at(-1) ?? [[], ""];
		const head = mEntries[0];
		expect(head?.type === "header" && head.count === 0 && !mStatus).toBe(false);
	});
});

// ── More of the preview ────────────────────────────────────────────────────────

describe("QA2 modal: the preview pane, continued", () => {
	it("the preview follows the selection once the modal is wide enough again", async () => {
		const app = appWith({ "A.md": "a", "B.md": "b" });
		let width = 1000;
		let observed: (() => void) | null = null;
		class RO {
			constructor(cb: () => void) {
				observed = cb;
			}
			observe() {}
			disconnect() {}
		}
		vi.stubGlobal("ResizeObserver", RO);
		const m = new JetModal(
			app as never,
			baseHost({ previewOn: () => true, list: (_t, paint) => paint([item("A.md"), item("B.md")]) }),
		);
		Object.defineProperty(m.modalEl, "clientWidth", { get: () => width });
		m.open();
		await wait(REST);
		expect(previewTitle()).toBe("A");
		// The window gets narrow (the pane hides), you move to B, the window gets wide again.
		width = 600;
		observed?.();
		press(m, "ArrowDown");
		await wait(REST);
		width = 1000;
		observed?.();
		await wait(REST);
		expect(previewTitle()).toBe("B");
	});

	it("a click on the preview's buttons keeps the focus in the search box", () => {
		const m = new JetModal(new App() as never, baseHost({ previewOn: () => true }));
		m.open();
		const copy = $('.jet-pv .jet-pb[aria-label="Copy link"]');
		const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
		copy?.dispatchEvent(down);
		// Every other control in the modal (×, the filter button, the list, the chips) keeps the focus.
		expect(down.defaultPrevented).toBe(true);
	});
});

// ── The clear ×, Esc and the footer ───────────────────────────────────────────

describe("QA2 modal: the clear × button, Esc and the footer", () => {
	it("after × with the scope chip selected, Esc closes the (now empty) search", () => {
		const m = new JetModal(
			new App() as never,
			baseHost({
				list: (_t, paint) => paint([item("a.md")]),
				restore: () => ({ scope: SCOPE, filters: [] }),
			}),
		);
		m.open();
		// ⌫ at the start selects the chip; then the mouse clears everything with ×.
		press(m, "Backspace");
		expect($(".jet-chip")?.hasClass("is-selected")).toBe(true);
		$(".jet-clear")?.click();
		expect(m.inputEl.value).toBe("");
		expect($(".jet-chip")?.hasClass("is-hidden")).toBe(true);
		press(m, "Escape");
		expect(m.isOpen).toBe(false);
	});

	it("with filters and nothing typed, the footer does not say Esc closes (Esc clears the filters)", () => {
		const app = new App();
		const data = normalizeData(null);
		const jet = new JetHost(
			app as never,
			() => data,
			() => {},
			() => false,
			() => ({}) as Search,
		);
		const m = new JetModal(
			app as never,
			baseHost({
				hints: (t, s) => jet.hints(t, s),
				list: (_t, paint) => paint([{ type: "header", label: "Results", count: 1 }, item("a.md")]),
				restore: () => ({ filters: [{ kind: "edited", days: 7 }] }),
			}),
		);
		m.open();
		const said = footer();
		press(m, "Escape");
		expect(m.isOpen).toBe(true);
		expect(said).not.toContain("EscClose");
	});
});

// ── The scopes row ─────────────────────────────────────────────────────────────

const scopeOf = (id: string, name: string, mode: Scope["mode"] = "suggest"): Scope => ({
	id,
	name,
	aliases: [],
	kind: "Areas",
	rules: [{ kind: "folder", path: name }],
	combine: "any",
	mode,
	source: "generated",
});

const jetHostWithScopes = (scopes: Scope[]) => {
	const app = new App();
	const data = normalizeData(null);
	const access: HostScopes = {
		all: () => scopes,
		ensure: () => {},
		count: () => 2,
		membersOf: () => new Set(),
		ruleCount: () => 2,
		edit: () => {},
		ambiguity: () => null,
		measure: () => {},
	};
	const search = { list: () => {}, warm: () => {}, idle: () => {} } as unknown as Search;
	const host = new JetHost(
		app as never,
		() => data,
		() => {},
		() => false,
		() => search,
		undefined,
		access,
		new FilterSets(app as never),
	);
	return { app, host };
};

describe("QA2 modal: the sliding scopes row", () => {
	it("“All N” lists N scopes", () => {
		const { app, host } = jetHostWithScopes([
			scopeOf("a", "Garden"),
			scopeOf("b", "Kitchen"),
			scopeOf("c", "Archive", "in-only"),
		]);
		const m = new JetModal(app as never, host);
		m.open();
		const all = $(".jet-schip.is-all");
		const n = Number(/All (\d+)/.exec(all?.textContent ?? "")?.[1]);
		all?.click();
		const menu = (Menu as unknown as { last: { items: Array<{ title: string }> } }).last;
		expect(menu.items.length).toBe(n);
	});

	it("the mouse wheel scrolls the list when the scopes row has nothing more to slide", () => {
		const m = new JetModal(
			new App() as never,
			baseHost({
				list: (_t, paint) =>
					paint([
						{ type: "scopes", label: "Search in · 1 scope", chips: [{ scope: SCOPE }], more: 0 },
						item("a.md"),
					]),
			}),
		);
		m.open();
		const row = $(".jet-schips") as HTMLElement;
		// All the chips fit (scrollWidth = clientWidth): there is nothing to slide sideways.
		expect(row.scrollWidth - row.clientWidth).toBe(0);
		const wheel = new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true });
		row.dispatchEvent(wheel);
		expect(wheel.defaultPrevented).toBe(false);
	});
});

// ── The @ / filter autocomplete list ──────────────────────────────────────────

describe("QA2 modal: the autocomplete list", () => {
	it("the list opens under the piece when the box is scrolled (a long search)", () => {
		const long = `${"word ".repeat(20)}@ga`;
		const c: Completion = {
			from: long.length - 3,
			to: long.length,
			title: "Scopes",
			items: [{ label: "Garden", insert: "@Garden " }],
		};
		const m = new JetModal(
			new App() as never,
			baseHost({
				filters: {
					find: () => [],
					values: () => [],
					tags: () => [],
					keys: () => [],
					scopes: () => [],
					complete: (t) => (t.endsWith("@ga") ? c : null),
					fix: () => null,
					preview: () => [],
				},
			}),
		);
		m.open();
		type(m, long);
		// The box shows the end of the text: scrolled 400 px left. A click in it lists again.
		m.inputEl.scrollLeft = 400;
		m.inputEl.dispatchEvent(new MouseEvent("click"));
		expect(m.inputEl.scrollLeft).toBe(400);
		const left = Number.parseFloat($(".jet-ac")?.style.left ?? "NaN");
		// The mock measures 9 px a character; the dashed boxes (placeGhost) subtract the scroll too.
		expect(left).toBe(9 * c.from - 8 - 400);
	});
});

// ── Actions the host runs ─────────────────────────────────────────────────────

describe("QA2 host: actions", () => {
	it("⇧↵ on a text no file name can hold says why nothing was created", async () => {
		const app = new App();
		const data = normalizeData(null);
		const jet = new JetHost(
			app as never,
			() => data,
			() => {},
			() => false,
			() => ({}) as Search,
		);
		const before = Notice.shown.length;
		// "???" (or "[[", "//"): every character is one a file name cannot hold.
		jet.create("???");
		await wait(5);
		expect(app.vault.files.size).toBe(0);
		expect(Notice.shown.length).toBeGreaterThan(before);
	});

	it("“Move to scope or folder…” offers the vault's top level", () => {
		const { app, host } = jetHostWithScopes([]);
		const f = new TFile("Projects/Plan.md");
		app.vault.files.set(f.path, f);
		(app.vault as unknown as { getAllLoadedFiles: () => unknown[] }).getAllLoadedFiles = () => [
			new TFolder("/"),
			new TFolder("Projects"),
			new TFolder("Archive"),
			f,
		];
		const open = vi.spyOn(FuzzySuggestModal.prototype, "open").mockImplementation(() => {});
		expect(host.act("move", f.path)).toBe(true);
		// The picker Jet opened is the spy's `this` for that call.
		const picker = open.mock.contexts[0] as unknown as { getItems(): Array<{ folder: string }> } | undefined;
		const folders = picker?.getItems().map((t) => t.folder);
		expect(folders).toContain("Archive");
		expect(folders?.some((x) => x === "/" || x === "")).toBe(true);
	});
});
