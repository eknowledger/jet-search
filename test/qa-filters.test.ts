/**
 * QA (filters, the bar, autocomplete and fix-it, reasons and sorting): each test is a bug as a user
 * meets it, and fails until it is fixed.
 */
import { afterEach, describe, expect, it } from "vitest";
import { App, Menu, type Scope, TFile } from "obsidian";
import { normalizeData } from "../src/data";
import { findFix } from "../src/filters/complete";
import { type FilterFacts, findFilters, passes } from "../src/filters/filter";
import { FilterSets } from "../src/filters/sets";
import { JetHost } from "../src/host";
import type { Feeder } from "../src/index/feeder";
import { type Entry, JetModal, type ModalHost, type ScopeView, sortEntries, type Typed } from "../src/modal/jet-modal";
import { Search } from "../src/search";
import type { JetClient } from "../src/worker/jet-client";

type Item = Extract<Entry, { type: "item" }>;
type Note = { path: string; fm?: Record<string, unknown>; tags?: string[]; mtime?: number; ctime?: number };

// ── Helpers ──────────────────────────────────────────────────────────────────

const vault = (notes: Note[]): App => {
	const app = new App();
	const files = (app.vault as unknown as { files: Map<string, TFile> }).files;
	const caches = (app.metadataCache as unknown as { caches: Map<string, unknown> }).caches;
	for (const n of notes) {
		const f = new TFile(n.path);
		f.stat.mtime = n.mtime ?? 0;
		f.stat.ctime = n.ctime ?? 0;
		files.set(n.path, f);
		caches.set(n.path, {
			...(n.fm ? { frontmatter: n.fm } : {}),
			...(n.tags ? { tags: n.tags.map((tag) => ({ tag })) } : {}),
		});
	}
	return app;
};

/** The real host's filters (FilterSets on the mock metadata cache). */
const realHost = (app: App) => {
	const data = normalizeData(null);
	const search = { list: () => {}, warm: () => {}, idle: () => {} } as unknown as Search;
	const sets = new FilterSets(app as never);
	const host = new JetHost(
		app as never,
		() => data,
		() => {},
		() => false,
		() => search,
		undefined,
		undefined,
		sets,
	);
	return { host, sets, data };
};

const COBALT: ScopeView = { id: "cobalt", name: "Cobalt", kind: "Projects", members: 34 };
const typed = (text: string): Typed => {
	const m = /^(cobalt)(\s+(\S.*))?$/i.exec(text);
	if (!m) return {};
	return m[3] ? { suggest: { scope: COBALT, others: [], name: m[1] ?? "", rest: m[3], at: 0 } } : { hint: COBALT };
};
const known = (k: string) => ["status", "type"].includes(k.toLowerCase());

/** A modal host; `filters` defaults to findFilters over status/type with a real findFix. */
const fakeHost = (filters?: ModalHost["filters"]) => {
	const lists: Array<[string, string | undefined, string[]]> = [];
	const host: ModalHost = {
		placeholder: "Search notes…",
		list: (text, paint, scope, fs = []) => {
			lists.push([text, scope, fs.map((f) => f.kind)]);
			paint([
				{ type: "header", label: "Results", count: 1 },
				{ type: "item", path: "a.md", title: "a", titleRanges: [], crumb: "", meta: "", icon: "file-text" },
			]);
		},
		open: () => {},
		hints: () => [["↵", "Open"]],
		closed: () => {},
		previewOn: () => false,
		setPreviewOn: () => {},
		copyLink: () => {},
		insertLink: () => {},
		create: () => {},
		scopes: {
			typed,
			card: () => ({ name: "", kind: "", mode: "", rules: [], total: 0, aliases: [] }),
			edit: () => {},
		},
		filters: filters ?? {
			find: (t) => findFilters(t, known),
			values: () => [["draft", 5]],
			tags: () => [["#cobalt", 34]],
			keys: () => [
				["status", 96],
				["type", 530],
			],
			scopes: () => [COBALT],
			complete: () => null,
			fix: (t) => {
				const f = findFix(t, [["status", 96]], known);
				return f ? { ...f, notes: 96 } : null;
			},
			preview: () => [],
		},
	};
	return { host, lists };
};

const press = (m: JetModal, key: string, mods: Parameters<Scope["register"]>[0] = []) =>
	(m.scope as unknown as { press(k: string, m: unknown[]): boolean }).press(key, mods);
const type = (m: JetModal, text: string, caret = text.length) => {
	m.inputEl.value = text;
	m.inputEl.setSelectionRange(caret, caret);
	m.inputEl.dispatchEvent(new Event("input"));
};
const chips = () => [...document.querySelectorAll(".jet-fchip")].map((c) => c.textContent);
const pick = (title: string) => {
	const i = (
		Menu as unknown as { last: { items: Array<{ title: string; click: (() => void) | null }> } }
	).last.items.find((x) => x.title.startsWith(title));
	if (!i?.click) throw new Error(`no menu item ${title}`);
	i.click();
};

const NOW = Date.parse("2026-10-08T12:00:00Z");
const facts = (over: Partial<FilterFacts> = {}): FilterFacts => ({
	path: "a.md",
	props: {},
	links: {},
	tags: [],
	mtime: NOW,
	ctime: NOW,
	outgoing: [],
	...over,
});

const searchOver = (app: App, building: boolean, keep?: Set<string>): Search => {
	const feeder = {
		progress: building ? { done: 1, total: 100 } : null,
		ensure: () => new Promise<void>(() => {}),
	} as unknown as Feeder;
	const data = normalizeData(null);
	data.indexedAt = building ? null : 1;
	return new Search(
		app as never,
		{} as JetClient,
		feeder,
		() => data,
		undefined,
		keep ? { notes: () => keep } : undefined,
	);
};
const firstPaint = (
	s: Search,
	text: string,
	filters: Parameters<Search["list"]>[3],
	order?: Parameters<Search["list"]>[5],
): Entry[] => {
	let shown: Entry[] | null = null;
	s.list(
		text,
		(e) => {
			shown ??= e;
		},
		undefined,
		filters,
		undefined,
		order,
	);
	return shown ?? [];
};
const items = (e: Entry[]) => e.filter((x): x is Item => x.type === "item");

afterEach(() => document.body.replaceChildren());

// ── Typing filters in the box ─────────────────────────────────────────────────

describe("QA: typing filters in the box", () => {
	it("words, then a filter, then more words: the words stay apart", () => {
		const { host, lists } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		// Typed as a person types: the space after #cobalt makes the chip, then the next word.
		type(m, "world #cobalt ");
		type(m, `${m.inputEl.value}notes`);
		expect(chips()).toEqual(["tag#cobalt"]);
		expect(lists.at(-1)?.[0]).toBe("world notes");
	});

	it("a chip made mid-text leaves the caret where you were typing", () => {
		const { host } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		// "alpha beta", caret after "alpha ", you type "#cobalt " there.
		type(m, "alpha #cobalt beta", "alpha #cobalt ".length);
		expect(m.inputEl.value.replace(/\s+/g, " ").trim()).toBe("alpha beta");
		expect(m.inputEl.selectionStart).toBe("alpha ".length);
	});

	it("path:\"Daily Notes\" (the folder autocomplete's own insert) keeps the folder's notes", () => {
		const app = vault([{ path: "Daily Notes/2026-10-01.md" }, { path: "Projects/x.md" }]);
		const { host, sets } = realHost(app);
		const c = host.filters?.complete("path:Dai", 8);
		const insert = c?.items[0]?.insert ?? "";
		expect(insert).toBe('path:"Daily Notes" ');
		const [found] = host.filters?.find(insert) ?? [];
		expect(found?.filter).toEqual({ kind: "path", prefix: "Daily Notes" });
		expect(found && [...sets.notes(found.filter)]).toEqual(["Daily Notes/2026-10-01.md"]);
	});

	it("a remembered search with a folder that has a space gives the same folder back", () => {
		const app = vault([{ path: "Daily Notes/a.md" }]);
		const { host, data } = realHost(app);
		host.closed("plan", true, undefined, [{ kind: "path", prefix: "Daily Notes" }]);
		const again = host.filters?.find(data.searches[0] ?? "") ?? [];
		expect(again.map((x) => x.filter)).toContainEqual({ kind: "path", prefix: "Daily Notes" });
	});

	it('links:"My Note" links to My Note (quotes are not part of the name)', () => {
		const [f] = findFilters('links:"My Note" ', () => false);
		expect(f?.filter).toEqual({ kind: "links", name: "My Note" });
	});

	it("#42 (an issue number) stays text: Obsidian never makes an all-digit tag", () => {
		expect(findFilters("bug #42 crash", known)).toEqual([]);
	});

	it("#work, (punctuation after a tag) keeps notes tagged #work", () => {
		const [f] = findFilters("#work, #home ", known);
		expect(f && passes(f.filter, facts({ tags: ["#work"] }), NOW)).toBe(true);
	});

	it("path:Work keeps the Work folder, not Workshop (the chip says “in folder”)", () => {
		expect(passes({ kind: "path", prefix: "Work" }, facts({ path: "Work/a.md" }), NOW)).toBe(true);
		expect(passes({ kind: "path", prefix: "Work" }, facts({ path: "Workshop/b.md" }), NOW)).toBe(false);
	});

	it("edited:0d is not a filter that keeps nothing (a note edited a minute ago)", () => {
		const [f] = findFilters("edited:0d ", known);
		expect(!f || passes(f.filter, facts({ mtime: NOW - 60_000 }), NOW)).toBe(true);
	});

	it("tags:work (the tags property) keeps notes with #work written in the text too", () => {
		const app = vault([
			{ path: "fm.md", fm: { tags: ["work"] } },
			{ path: "inline.md", tags: ["#work"] },
			{ path: "nested.md", fm: { tags: ["work/client"] } },
		]);
		const { host, sets } = realHost(app);
		const [found] = host.filters?.find("tags:work ") ?? [];
		expect(found).toBeDefined();
		expect(found && [...sets.notes(found.filter)].sort()).toEqual(["fm.md", "inline.md", "nested.md"]);
	});
});

// ── Fix-it ───────────────────────────────────────────────────────────────────

describe("QA: fix-it", () => {
	it("inside a scope, the banner's ⇥ Fix fixes the key", () => {
		const { host } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "Cobalt world");
		press(m, "Tab");
		type(m, "stauts:draft");
		expect(document.querySelector(".jet-ban")?.textContent).toContain("Did you mean status:?");
		press(m, "Tab");
		expect(chips()).toEqual(["statusdraft"]);
	});

	it("-status:draft (Obsidian's minus) is not “fixed” into status:draft, which keeps the opposite", () => {
		expect(findFix("-status:draft", [["status", 96]], known)).toBeNull();
	});
});

// ── Autocomplete ─────────────────────────────────────────────────────────────

describe("QA: autocomplete", () => {
	it('a value with a space keeps listing after the space (type:"ai n → ai note)', () => {
		const app = vault([
			{ path: "a.md", fm: { type: "ai note" } },
			{ path: "b.md", fm: { type: "plan" } },
		]);
		const { host } = realHost(app);
		const text = 'type:"ai n';
		const c = host.filters?.complete(text, text.length);
		expect(c?.items.map((i) => i.label)).toEqual(["ai note"]);
		expect(c?.from).toBe(0);
	});

	it("accepting a key in front of a word does not glue the word into its value", () => {
		const app = vault([{ path: "a.md", fm: { status: "draft" } }]);
		const { host: real } = realHost(app);
		const { host, lists } = fakeHost(real.filters);
		const m = new JetModal(new App() as never, host);
		m.open();
		// "sta: hello", the caret back after "sta:": the list offers status.
		type(m, "sta: hello", 4);
		expect(document.querySelector(".jet-ac .jet-acl")?.textContent).toBe("status");
		press(m, "Tab");
		expect(m.inputEl.value).not.toBe("status:hello");
		expect(lists.at(-1)?.[0]).toContain("hello");
	});
});

// ── The filters bar ──────────────────────────────────────────────────────────

describe("QA: the filters bar", () => {
	it("Edited: picking another window replaces the first (it would have no effect beside it)", () => {
		const { host } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		press(m, "f", ["Mod"]);
		const edited = () =>
			[...document.querySelectorAll<HTMLElement>(".jet-fbar .jet-fb")].find((b) =>
				b.textContent?.startsWith("Edited"),
			);
		edited()?.click();
		pick("Past 7 days");
		edited()?.click();
		pick("Past 30 days");
		expect(chips()).toEqual(["editedpast 30 days"]);
	});

	it("Title only with nothing typed yet does not say “No notes match these filters”", () => {
		const app = vault([
			{ path: "Garden.md", mtime: 5 },
			{ path: "Lyon.md", mtime: 3 },
		]);
		const data = normalizeData(null);
		const search = searchOver(app, false);
		const host = new JetHost(
			app as never,
			() => data,
			() => {},
			() => false,
			() => search,
			undefined,
			undefined,
			new FilterSets(app as never),
		);
		let shown: Entry[] = [];
		host.list("", (e) => (shown = e), undefined, [{ kind: "title" }]);
		expect(shown).not.toContainEqual({ type: "notice", title: "No notes match these filters" });
	});

	it("Title only leaves out notes found by a heading or property while the index builds", () => {
		const app = vault([{ path: "Garden.md" }]);
		(app.metadataCache as unknown as { caches: Map<string, unknown> }).caches.set("Garden.md", {
			headings: [{ level: 2, heading: "Watering schedule" }],
		});
		const s = searchOver(app, true);
		expect(items(firstPaint(s, "watering", [])).map((x) => x.path)).toEqual(["Garden.md"]);
		expect(items(firstPaint(s, "watering", [{ kind: "title" }]))).toEqual([]);
	});

	it("a remembered search keeps Title only", () => {
		const { host, data } = realHost(vault([{ path: "a.md" }]));
		host.closed("budget", true, undefined, [{ kind: "title" }]);
		const again = host.filters?.find(data.searches[0] ?? "") ?? [];
		expect(again.map((x) => x.filter.kind)).toContain("title");
	});
});

// ── Reasons ──────────────────────────────────────────────────────────────────

describe("QA: match reasons", () => {
	it("a list property's badge names the value that matched (accents folded), not the first", () => {
		const app = vault([{ path: "a.md", fm: { authors: ["Bob", "Zoë"] } }]);
		const sets = new FilterSets(app as never);
		const f = { kind: "prop" as const, key: "authors", value: "zoe" };
		expect(sets.notes(f).has("a.md")).toBe(true);
		expect(sets.reason(f, "a.md")).toBe("authors = Zoë");
	});

	it("edited:1d asked again two days later (no vault change) no longer keeps a note edited before that", () => {
		const app = vault([{ path: "a.md", mtime: NOW - 3_600_000 }]);
		const sets = new FilterSets(app as never);
		const f = { kind: "edited" as const, days: 1 };
		expect(sets.notes(f, NOW).has("a.md")).toBe(true);
		expect(sets.notes(f, NOW + 2 * 86_400_000).has("a.md")).toBe(false);
	});

	it("created:30d kept a note by its date property: the badge does not name the file's creation day", () => {
		const ctime = new Date(2025, 0, 3).getTime();
		const app = vault([{ path: "a.md", fm: { date: "2026-10-01" }, ctime }]);
		const sets = new FilterSets(app as never);
		const f = { kind: "created" as const, days: 30 };
		expect(sets.notes(f, NOW).has("a.md")).toBe(true);
		const fileDay = new Date(ctime).toLocaleDateString(undefined, { month: "short", day: "numeric" });
		expect(sets.reason(f, "a.md")).not.toBe(`created ${fileDay}`);
	});
});

// ── Sorting ──────────────────────────────────────────────────────────────────

describe("QA: sorting", () => {
	const item = (title: string, mtime = 0): Item => ({
		type: "item",
		path: `${title}.md`,
		title,
		titleRanges: [],
		crumb: "",
		meta: "",
		icon: "file-text",
		mtime,
		ctime: mtime,
	});

	it("filters with no text: oldest first shows the oldest notes, and the count stays the total", () => {
		const notes = Array.from({ length: 60 }, (_, i) => ({ path: `n${i + 1}.md`, mtime: i + 1 }));
		const app = vault(notes);
		const s = searchOver(app, false, new Set(notes.map((n) => n.path)));
		// The modal passes the order with the list (filters alone list a window of the notes they keep).
		const listed = firstPaint(s, "", [{ kind: "tag", tag: "#x" }], "edited-old");
		expect(listed[0]).toMatchObject({ type: "header", count: 60 });
		const sorted = sortEntries(listed, "edited-old");
		expect(items(sorted)[0]?.path).toBe("n1.md");
		expect(sorted[0]).toMatchObject({ type: "header", count: 60 });
	});

	it("sorting keeps the header's By meaning switch", () => {
		const list: Entry[] = [
			{ type: "header", label: "By meaning", count: 2, mode: "meaning" },
			item("b"),
			item("a"),
		];
		expect(sortEntries(list, "title")[0]).toMatchObject({ type: "header", mode: "meaning" });
	});

	it("sorting keeps the “in Obsidian's Search” row on top", () => {
		const list: Entry[] = [
			{ type: "core", query: "task:x", detail: "" },
			{ type: "header", label: "Results", count: 2 },
			item("b"),
			item("a"),
		];
		expect(sortEntries(list, "title")[0]?.type).toBe("core");
	});

	it("Title: A → Z puts Note 2 before Note 10", () => {
		const list: Entry[] = [
			{ type: "header", label: "Results", count: 3 },
			item("Note 10"),
			item("Note 2"),
			item("Note 1"),
		];
		expect(items(sortEntries(list, "title")).map((x) => x.title)).toEqual(["Note 1", "Note 2", "Note 10"]);
	});
});
