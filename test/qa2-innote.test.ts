/**
 * QA: search in the open note, opening notes, the selection prefill, the hand-offs (Obsidian
 * Search, Omnisearch's ids, ⌘K), creating notes and recents. Every test here fails on the code as it is
 * and names the behaviour it expects.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, Notice, TFile } from "obsidian";
import { normalizeData } from "../src/data";
import { FilterSets } from "../src/filters/sets";
import { type HostScopes, JetHost } from "../src/host";
import { Cancelled } from "../src/index/feeder";
import { InNoteHost } from "../src/innote";
import { type Entry, JetModal, type ModalHost } from "../src/modal/jet-modal";
import type { Scope } from "../src/scopes/model";
import { Search } from "../src/search";
import JetSearchPlugin from "../src/main";

// ── Helpers ──────────────────────────────────────────────────────────────────

type Call = [string, ...unknown[]];

/** A Markdown view over `text`: its editor records what Jet asks of it. `mode` is the view's mode. */
const noteView = (text: string, mode: "source" | "preview" = "source", path = "Garden.md") => {
	const calls: Call[] = [];
	const editor = {
		getValue: () => text,
		getSelection: () => "",
		setSelection: (a: unknown, b: unknown) => calls.push(["select", a, b]),
		setCursor: (a: unknown) => calls.push(["cursor", a]),
		scrollIntoView: (r: unknown) => calls.push(["scroll", r]),
		focus: () => calls.push(["focus"]),
		replaceSelection: (t: string) => calls.push(["replace", t]),
	};
	const previewMode = { applyScroll: (line: number) => calls.push(["applyScroll", line]) };
	const view = {
		editor,
		file: new TFile(path),
		getMode: () => mode,
		setEphemeralState: (s: unknown) => calls.push(["eState", s]),
		previewMode,
		currentMode: mode === "preview" ? previewMode : editor,
		setState: (s: unknown) => (calls.push(["setState", s]), Promise.resolve()),
		leaf: { setViewState: (s: unknown) => (calls.push(["setViewState", s]), Promise.resolve()) },
	};
	return { view, editor, calls };
};

const listOf = (h: ModalHost, q: string): Entry[] => {
	let out: Entry[] = [];
	h.list(q, (e) => (out = e));
	return out;
};

const items = (es: Entry[]) => es.filter((e): e is Extract<Entry, { type: "item" }> => e.type === "item");

const press = (m: JetModal, key: string, mods: string[] = []): boolean =>
	(m.scope as unknown as { press(k: string, m: string[]): boolean }).press(key, mods);

const type = (m: JetModal, text: string): void => {
	m.inputEl.value = text;
	m.inputEl.setSelectionRange(text.length, text.length);
	m.inputEl.dispatchEvent(new Event("input"));
};

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A vault with these notes (path → frontmatter, or null for none). */
const vaultApp = (notes: Record<string, Record<string, unknown> | null> = {}) => {
	const app = new App();
	const files = (app.vault as unknown as { files: Map<string, TFile> }).files;
	for (const [p, fm] of Object.entries(notes)) {
		files.set(p, new TFile(p));
		if (fm) app.metadataCache.caches.set(p, { frontmatter: fm });
	}
	return app;
};

/** A JetHost over the app, with a search that answers nothing (tests give their own list). */
const plainHost = (app: App, opts: { newTab?: boolean; scopes?: Scope[] } = {}) => {
	const data = normalizeData(null);
	const search = { list: () => {}, warm: () => {}, idle: () => {} } as unknown as Search;
	const scopes = opts.scopes ?? [];
	const access: HostScopes = {
		all: () => scopes,
		ensure: () => {},
		count: () => 0,
		membersOf: () => new Set<string>(),
		ruleCount: () => 0,
		edit: () => {},
		ambiguity: () => null,
		measure: () => {},
	};
	const host = new JetHost(
		app as never,
		() => data,
		() => {},
		() => opts.newTab ?? false,
		() => search,
		undefined,
		access,
		new FilterSets(app as never),
	);
	return { host, data };
};

afterEach(() => {
	document.body.replaceChildren();
	Notice.shown.length = 0;
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

// ── Search in this note (src/innote.ts) ──────────────────────────────────────

describe("QA2 in-note: jumping to a line", () => {
	it("in Reading view, Enter on a line moves the view to that line (not only the hidden editor)", () => {
		const text = ["# Garden", "", "Water the orchard on Sunday."].join("\n");
		const { view, calls } = noteView(text, "preview");
		const h = new InNoteHost(new App() as never, view.file, view as never, (fn) => fn());
		const row = items(listOf(h, "orchard"))[0];
		if (!row?.at) throw new Error("no row for 'orchard'");
		h.open(row.path, "default", row.at);
		// Reading view shows the rendered note, not the editor: setSelection/scrollIntoView on the editor
		// move nothing you can see. Something must scroll the reading view (or switch to editing).
		const seen = calls.some(
			(c) =>
				(c[0] === "eState" && (c[1] as { line?: number }).line === 2) ||
				(c[0] === "applyScroll" && c[1] === 2) ||
				c[0] === "setViewState" ||
				c[0] === "setState",
		);
		// Today only the editor is told (select, scroll, focus): the reading view stays where it was.
		expect(seen).toBe(true);
	});
});

describe("QA2 in-note: what the list says", () => {
	it("a one-letter or punctuation-only text says something instead of an empty list", () => {
		const { view } = noteView("x marks the spot\n# Garden\n- [ ] plant x");
		const h = new InNoteHost(new App() as never, view.file, view as never);
		const shown = Object.fromEntries(["x", "#", "->"].map((q) => [q, listOf(h, q).length > 0]));
		// Today: [] for each — the headings vanish and the list is blank, with no notice at all.
		expect(shown).toEqual({ x: true, "#": true, "->": true });
	});

	it("more than 100 matching lines: the lines after the 100th can be reached, or the list says it was cut", () => {
		const lines = Array.from({ length: 150 }, (_, i) => `- task ${i + 1}: review the plan`);
		const { view } = noteView(lines.join("\n"));
		const h = new InNoteHost(new App() as never, view.file, view as never);
		const out = listOf(h, "review");
		const head = out.find((e) => e.type === "header");
		expect(head?.type === "header" && head.count).toBe(150);
		const rows = items(out);
		// A notice, a "show more" row or any other line after the rows would do.
		const told = out.some((e) => e.type !== "item" && e.type !== "header");
		// Today: the header says 150, 100 rows are listed, and nothing says where the other 50 went.
		expect(rows.length === 150 || told).toBe(true);
	});

	it("a long line that holds every typed word ranks above a line with one of them (hits are capped at 20 a line)", () => {
		const long = `${Array.from({ length: 25 }, (_, i) => `data point ${i}`).join(", ")} feed the model.`;
		const text = ["The data is ready.", long].join("\n");
		const { view } = noteView(text);
		const h = new InNoteHost(new App() as never, view.file, view as never);
		const rows = items(listOf(h, "data model"));
		// Line 2 holds "data" and "model"; line 1 only "data". Today the 20-hit cap stops before "model".
		expect(rows.map((r) => r.crumb)).toEqual(["Line 2", "Line 1"]);
	});
});

describe("QA2 in-note: the modal's keys", () => {
	const text = ["# Garden", "Water the orchard.", "The orchard paths."].join("\n");

	it("⌘. in Search in this note does not open an empty preview pane that ⌘. cannot close", () => {
		const { view } = noteView(text);
		const m = new JetModal(new App() as never, new InNoteHost(new App() as never, view.file, view as never));
		m.open();
		expect(m.modalEl.hasClass("is-preview-off")).toBe(true);
		press(m, ".", ["Mod"]);
		const afterOne = m.modalEl.hasClass("is-preview-off");
		press(m, ".", ["Mod"]);
		const afterTwo = m.modalEl.hasClass("is-preview-off");
		// This host has no preview (previewOn() is always false): the pane must stay hidden, or at least
		// the second ⌘. must hide it again. Today both presses leave it shown.
		expect([afterOne, afterTwo]).toEqual([true, true]);
	});

	it("no sort control (Last edited, Created…) on the lines of a single note", () => {
		const { view } = noteView(text);
		const m = new JetModal(new App() as never, new InNoteHost(new App() as never, view.file, view as never));
		m.open();
		type(m, "orchard");
		expect(document.querySelectorAll(".jet-row").length).toBe(2);
		expect(document.querySelector(".jet-sort")).toBeNull();
	});

	it("⇧↵ and ⌥↵ (create, insert link) do not close Search in this note doing nothing", () => {
		const kept: Record<string, boolean> = {};
		for (const mod of ["Shift", "Alt"]) {
			const { view, calls } = noteView(text);
			const app = new App();
			const m = new JetModal(app as never, new InNoteHost(app as never, view.file, view as never, (fn) => fn()));
			m.open();
			type(m, "orchard");
			press(m, "Enter", [mod]);
			// Open still, or it did something (jumped, inserted, created). Today it closes and nothing happens.
			const made = (app.vault as unknown as { files: Map<string, TFile> }).files.size > 0;
			kept[mod] = m.isOpen || calls.length > 0 || made;
			m.close();
			document.body.replaceChildren();
		}
		expect(kept).toEqual({ Shift: true, Alt: true });
	});
});

// ── Opening a result (src/host.ts open) ──────────────────────────────────────

describe("QA2 open: a result found in the text", () => {
	it("Enter on an 'In text' row opens the note at the excerpt's hit, not at the top", async () => {
		const app = vaultApp({ "Projects/Garden.md": null });
		const opened: Array<{ path: string; state: unknown }> = [];
		const editorCalls: Call[] = [];
		const editor = {
			setCursor: (p: unknown) => editorCalls.push(["cursor", p]),
			setSelection: (a: unknown) => editorCalls.push(["select", a]),
			scrollIntoView: () => {},
		};
		Object.assign(app.workspace, {
			getLeaf: () => ({
				view: { editor, setEphemeralState: (s: unknown) => editorCalls.push(["eState", s]) },
				openFile: (f: TFile, state?: unknown) => (opened.push({ path: f.path, state }), Promise.resolve()),
			}),
			openLinkText: (link: string, _from: string, _tab: unknown, state?: unknown) => (
				opened.push({ path: link, state }),
				Promise.resolve()
			),
		});
		const { host } = plainHost(app);
		const row: Entry = {
			type: "item",
			path: "Projects/Garden.md",
			title: "Garden",
			titleRanges: [],
			crumb: "Projects",
			meta: "1h",
			icon: "file-text",
			excerpt: { text: "…water the orchard on Sunday…", marks: [[10, 17]], more: 0 },
			hit: { terms: ["orchard"], offset: 1200 },
		};
		const wrapped = Object.assign(Object.create(host) as JetHost, {
			list: (_t: string, paint: (e: Entry[]) => void) =>
				paint([{ type: "header", label: "In text", count: 1 }, row]),
			restore: () => null,
		});
		const m = new JetModal(app as never, wrapped);
		m.open();
		type(m, "orchard");
		press(m, "Enter");
		await tick();
		expect(opened.map((o) => o.path.replace(/#.*$/, ""))).toEqual(["Projects/Garden.md"]);
		const eState = (opened[0]?.state as { eState?: Record<string, unknown> } | undefined)?.eState;
		// Any way of placing it: an eState (line, match, cursor…), a #subpath, or the cursor set afterwards.
		const placed =
			Object.keys(eState ?? {}).length > 0 || (opened[0]?.path ?? "").includes("#") || editorCalls.length > 0;
		// Today open(path, how) drops the hit: openFile gets no state and nothing moves the cursor.
		expect(placed).toBe(true);
	});

	it("a result whose note was deleted meanwhile says so instead of closing Jet with nothing opened", () => {
		const app = vaultApp({});
		const { host } = plainHost(app);
		host.open("Projects/Gone.md", "default");
		expect(app.workspace.opened).toEqual([]);
		// Today: nothing at all — no note, no notice; the search is even remembered as one that opened a note.
		expect(Notice.shown.length).toBeGreaterThan(0);
	});
});

// ── Obsidian Search hand-off (wantsCoreSearch, the "Search with Obsidian Search" row) ──

describe("QA2 hand-off: Search with Obsidian Search", () => {
	it("the query handed to Obsidian's Search keeps the filter chips (#tag) typed with it", async () => {
		const app = vaultApp({ "Projects/Review.md": { tags: ["project"] } });
		const handed: string[] = [];
		Object.assign(app, {
			internalPlugins: {
				getPluginById: (id: string) =>
					id === "global-search" ? { instance: { openGlobalSearch: (q: string) => handed.push(q) } } : null,
			},
		});
		const data = normalizeData(null);
		const feeder = {
			ensure: () => Promise.reject(new Cancelled()),
			progress: null,
			meaningProgress: null,
		};
		const sets = new FilterSets(app as never);
		const search = new Search(app as never, {} as never, feeder as never, () => data, undefined, sets);
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
		const m = new JetModal(app as never, host);
		m.open();
		type(m, "#project task:review");
		await tick();
		// `#project ` became a chip; the text left is `task:review`, which only Obsidian's Search answers.
		expect(document.querySelector(".jet-fchip")?.textContent).toContain("#project");
		const core = document.querySelector(".jet-sugg");
		expect(core?.textContent).toContain("Search with Obsidian Search");
		press(m, "Enter");
		expect(handed.length).toBe(1);
		// Today Obsidian gets "task:review" alone: the tag is dropped and it searches the whole vault.
		expect(handed[0]).toMatch(/#project/);
	});
});

// ── Creating a note (src/host.ts create) ─────────────────────────────────────

describe("QA2 create: names and where the note goes", () => {
	it("a name that differs only in case from an existing note opens that note (macOS and Windows)", async () => {
		const app = vaultApp({ "Inbox/Garden Plan.md": null });
		const vault = app.vault as unknown as {
			files: Map<string, TFile>;
			create: (p: string, d: string) => Promise<TFile>;
		};
		const real = vault.create.bind(vault);
		// As Obsidian does on a case-insensitive disk: the same name in another case already exists.
		vault.create = async (p: string, d: string) => {
			if ([...vault.files.keys()].some((k) => k.toLowerCase() === p.toLowerCase()))
				throw new Error("File already exists.");
			return real(p, d);
		};
		vi.spyOn(console, "error").mockImplementation(() => {});
		const { host } = plainHost(app);
		host.create("garden plan");
		await tick();
		await tick();
		// Today: the exact-case lookup misses, create throws, and Jet says "The note could not be created."
		expect(Notice.shown).not.toContain("The note could not be created.");
		expect(app.workspace.opened.map((o) => o.path)).toEqual(["Inbox/Garden Plan.md"]);
	});

	it("a note created in a scope whose rules must all hold ends up in that scope", async () => {
		const scope: Scope = {
			id: "active",
			name: "Active projects",
			aliases: [],
			kind: "",
			rules: [
				{ kind: "property", key: "type", value: "project" },
				{ kind: "property", key: "status", value: "active" },
				{ kind: "tag", tag: "#work" },
			],
			combine: "all",
			mode: "suggest",
			source: "manual",
		};
		const app = vaultApp({});
		const { host } = plainHost(app, { scopes: [scope] });
		host.create("New launch", "active");
		await tick();
		await tick();
		const fm = (app as unknown as { frontmatter: Map<string, Record<string, unknown>> }).frontmatter.get(
			"Inbox/New launch.md",
		);
		// Today only the first property is filled in (type: project): no status, no tag, so the note is
		// not in "Active projects" although it was created there.
		expect(fm).toMatchObject({ type: "project", status: "active" });
		expect(fm?.tags).toEqual(expect.arrayContaining(["work"]));
	});

	it("a name typed with its .md extension is not created as 'Name.md.md'", async () => {
		const app = vaultApp({});
		const { host } = plainHost(app);
		host.create("Weekly review.md");
		await tick();
		expect([...(app.vault as unknown as { files: Map<string, TFile> }).files.keys()]).toEqual([
			"Inbox/Weekly review.md",
		]);
	});

	it("a name starting with a dot does not make a hidden file Obsidian will not show", async () => {
		const app = vaultApp({});
		const { host } = plainHost(app);
		host.create(".env settings");
		await tick();
		const made = [...(app.vault as unknown as { files: Map<string, TFile> }).files.keys()];
		expect(made.length).toBe(1);
		expect(made[0]?.split("/").pop()?.startsWith(".")).toBe(false);
	});

	it("a long name is never cut inside a character (an emoji at the 120th place)", async () => {
		const app = vaultApp({});
		const { host } = plainHost(app);
		host.create(`${"a".repeat(119)}🌱 garden`);
		await tick();
		const made = [...(app.vault as unknown as { files: Map<string, TFile> }).files.keys()][0] ?? "";
		// Today the name ends in half of 🌱 (a lone surrogate): an invalid file name.
		expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(made)).toBe(false);
	});

	it("'Folder/Name' creates the note in that folder, as Obsidian's quick switcher does", async () => {
		const app = vaultApp({});
		(app.vault as unknown as { folders: Set<string> }).folders.add("Projects");
		const { host } = plainHost(app);
		host.create("Projects/New plan");
		await tick();
		// Today the "/" becomes a space: "Inbox/Projects New plan.md", in the default folder.
		expect([...(app.vault as unknown as { files: Map<string, TFile> }).files.keys()]).toEqual([
			"Projects/New plan.md",
		]);
	});
});

// ── ⌘K "Search in this note" ────────────────────────────────────────────────

describe("QA2 ⌘K: Search in this note", () => {
	it("with 'open in a new tab' on, the action does not replace the note in the current tab", async () => {
		const app = vaultApp({ "Projects/Garden.md": null });
		const { host } = plainHost(app, { newTab: true });
		host.inNote = () => {};
		host.act("in-note", "Projects/Garden.md");
		await tick();
		// Open, the other ⌘K actions and creating all follow the setting; this one always uses the current tab.
		expect(app.workspace.opened).toEqual([{ path: "Projects/Garden.md", how: "tab" }]);
	});
});

// ── The plugin: the selection prefill and Omnisearch's ids (src/main.ts) ──────

/** A worker that never answers (the tests only need what is painted at once). */
class SilentWorker {
	onmessage: unknown = null;
	onerror: unknown = null;
	postMessage(): void {}
	terminate(): void {}
}

type Cmd = { id: string; name: string; callback?: () => unknown };

/** Jet in a mock app with Obsidian's command registry; `view` is the active Markdown view, if any. */
const jet = async (view?: unknown) => {
	vi.stubGlobal("Worker", SilentWorker);
	const app = new App();
	Object.assign(app.workspace, { on: () => ({ off: () => {} }) });
	if (view) Object.assign(app.workspace, { getActiveViewOfType: () => view });
	Object.assign(app.metadataCache, { on: () => ({ off: () => {} }) });
	const commands: Record<string, Cmd> = {};
	Object.assign(app, {
		commands: {
			commands,
			addCommand: (c: Cmd) => {
				commands[c.id] = c;
			},
			removeCommand: (id: string) => {
				delete commands[id];
			},
		},
		plugins: { plugins: {}, enabledPlugins: new Set<string>(), getPlugin: () => null },
	});
	const manifest = { id: "jet-search", name: "Jet Search", version: "0.0.1" };
	const plugin = new JetSearchPlugin(app as never, manifest as never);
	Object.assign(plugin, { loadData: async () => ({ indexedAt: 1 }), saveData: async () => {} });
	await plugin.onload();
	for (const cb of app.workspace.layoutReadyCallbacks.splice(0)) cb();
	await tick();
	return { app, plugin, commands, manifest, own: (plugin as unknown as { commands: Cmd[] }).commands };
};

const box = (): string => (document.querySelector(".jet-q") as HTMLInputElement | null)?.value ?? "<no modal>";

describe("QA2 prefill: the selection when Jet opens", () => {
	let unload: (() => void) | null = null;
	afterEach(() => {
		unload?.();
		unload = null;
	});

	it("a line selected by triple-click (it ends with its line break) is prefilled", async () => {
		const { view, editor } = noteView("Garden plan\nWater the orchard.");
		// CodeMirror's triple-click selects the whole line and the line break after it.
		editor.getSelection = () => "Garden plan\n";
		const { plugin } = await jet(view);
		unload = () => plugin.unload();
		plugin.open();
		// Today: the "\n" makes it a multi-line selection, so nothing is prefilled.
		expect(box()).toBe("Garden plan");
	});

	it("in Reading view, the text selected on screen is prefilled, not the hidden editor's old selection", async () => {
		const { view, editor } = noteView("Garden plan\nWater the orchard.", "preview");
		// Selected once in editing view, before switching to Reading view: the editor still holds it.
		editor.getSelection = () => "Garden plan";
		const shown = document.createElement("div");
		shown.textContent = "orchard";
		document.body.appendChild(shown);
		Object.assign(view, { containerEl: shown, previewMode: { containerEl: shown, applyScroll: () => {} } });
		const range = document.createRange();
		range.selectNodeContents(shown);
		document.getSelection()?.removeAllRanges();
		document.getSelection()?.addRange(range);
		expect(document.getSelection()?.toString()).toBe("orchard");
		const { plugin } = await jet(view);
		unload = () => plugin.unload();
		plugin.openInNote();
		// Today: "Garden plan" (the editor's stale selection) although "orchard" is what is selected.
		expect(box()).toBe("orchard");
	});
});

describe("QA2 Omnisearch's ids", () => {
	it("the stand-ins for Omnisearch's ids do not show as duplicates of Jet's own commands in the palette", async () => {
		const { plugin, commands, manifest, own } = await jet();
		try {
			expect(Object.keys(commands)).toEqual(
				expect.arrayContaining(["omnisearch:show-modal", "omnisearch:show-modal-infile"]),
			);
			// Obsidian lists a plugin's own command as "<plugin name>: <name>".
			const palette = own.map((c) => `${manifest.name}: ${c.name}`);
			const standIns = [commands["omnisearch:show-modal"]?.name, commands["omnisearch:show-modal-infile"]?.name];
			// Today both stand-ins are named exactly like Jet's two commands: the palette and the Hotkeys
			// page show "Jet Search: Search notes" and "Jet Search: Search in this note" twice each.
			for (const n of standIns) expect(palette).not.toContain(n);
		} finally {
			plugin.unload();
		}
	});
});
