import { afterEach, describe, expect, it } from "vitest";
import { App, type Scope } from "obsidian";
import { type Entry, JetModal, type ModalHost, type OpenHow } from "../src/modal/jet-modal";

const item = (path: string): Entry => ({
	type: "item",
	path,
	title: path,
	titleRanges: [],
	crumb: "",
	meta: "1h",
	icon: "file-text",
});

const fakeHost = (lists: Record<string, Entry[]>) => {
	const opened: Array<[string, OpenHow]> = [];
	const closed: Array<[string, boolean]> = [];
	const painters: Array<(e: Entry[]) => void> = [];
	const host: ModalHost = {
		placeholder: "Search notes…",
		list: (text, paint) => {
			painters.push(paint);
			paint(lists[text] ?? []);
		},
		open: (p, how) => opened.push([p, how]),
		hints: () => [["↵", "Open"]],
		closed: (t, o) => closed.push([t, o]),
		previewOn: () => false,
		setPreviewOn: () => {},
		copyLink: () => {},
		insertLink: (p) => opened.push([p, "link" as OpenHow]),
		create: (t) => opened.push([t, "create" as OpenHow]),
	};
	return { host, opened, closed, painters };
};

const press = (m: JetModal, key: string, mods: Parameters<Scope["register"]>[0] = []) =>
	(m.scope as unknown as { press(k: string, m: unknown[]): boolean }).press(key, mods);
const rows = () => [...document.querySelectorAll(".jet-list > *")];
const selected = () => document.querySelector(".jet-row.is-selected")?.getAttribute("data-index");
const type = (m: JetModal, text: string) => {
	m.inputEl.value = text;
	m.inputEl.dispatchEvent(new Event("input"));
};

describe("Jet modal", () => {
	afterEach(() => document.body.replaceChildren());

	it("shows the empty list, selects the first row and skips headers with the arrows", () => {
		const { host } = fakeHost({
			"": [
				{ type: "header", label: "Today" },
				item("a.md"),
				{ type: "header", label: "Past week" },
				item("b.md"),
			],
		});
		const m = new JetModal(new App() as never, host);
		m.open();
		expect(rows().map((r) => r.textContent)).toEqual(["Today", "a.md1h", "Past week", "b.md1h"]);
		expect(selected()).toBe("1");
		press(m, "ArrowDown");
		expect(selected()).toBe("3");
		press(m, "ArrowDown");
		expect(selected()).toBe("1");
		press(m, "ArrowUp");
		expect(selected()).toBe("3");
	});

	it("opens the selected note with Enter, in another tab with Mod+Enter, split with Mod+Alt+Enter", () => {
		for (const [mods, how] of [
			[[], "default"],
			[["Mod"], "other"],
			[["Mod", "Alt"], "split"],
		] as const) {
			const { host, opened, closed } = fakeHost({ "": [item("a.md")] });
			const m = new JetModal(new App() as never, host);
			m.open();
			press(m, "Enter", [...mods]);
			expect(opened).toEqual([["a.md", how]]);
			expect(closed).toEqual([["", true]]);
		}
	});

	it("clears the text with the first Esc and closes with the second", () => {
		const { host, closed } = fakeHost({ "": [item("a.md")], x: [item("x.md")] });
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "x");
		expect(rows().map((r) => r.textContent)).toEqual(["x.md1h"]);
		press(m, "Escape");
		expect(m.inputEl.value).toBe("");
		expect(rows().map((r) => r.textContent)).toEqual(["a.md1h"]);
		expect(m.isOpen).toBe(true);
		press(m, "Escape");
		expect(m.isOpen).toBe(false);
		expect(closed).toEqual([["", false]]);
	});

	it("keeps the selected note selected when results update", () => {
		const { host, painters } = fakeHost({ q: [item("a.md"), item("b.md")] });
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "q");
		press(m, "ArrowDown");
		expect(selected()).toBe("1");
		painters[painters.length - 1]?.([item("c.md"), item("a.md"), item("b.md")]);
		expect(rows()[Number(selected())]?.textContent).toBe("b.md1h");
	});

	it("is a combobox with a listbox of options", () => {
		const { host } = fakeHost({ "": [item("a.md")] });
		const m = new JetModal(new App() as never, host);
		m.open();
		expect(m.inputEl.getAttribute("role")).toBe("combobox");
		expect(document.querySelector(".jet-list")?.getAttribute("role")).toBe("listbox");
		const row = rows()[0];
		expect(row?.getAttribute("role")).toBe("option");
		expect(row?.getAttribute("aria-selected")).toBe("true");
		expect(m.inputEl.getAttribute("aria-activedescendant")).toBe(row?.id);
	});

	it("inserts a link with Alt+Enter and creates a note named after the text with Shift+Enter", () => {
		const { host, opened } = fakeHost({ "": [item("a.md")], "new idea": [item("x.md")] });
		const m = new JetModal(new App() as never, host);
		m.open();
		press(m, "Enter", ["Alt"]);
		expect(opened).toEqual([["a.md", "link"]]);
		const n = new JetModal(new App() as never, host);
		n.open();
		type(n, "new idea");
		press(n, "Enter", ["Shift"]);
		expect(opened[1]).toEqual(["new idea", "create"]);
	});

	it("runs a recent search when it is chosen", () => {
		const { host } = fakeHost({ "": [{ type: "search", query: "garden" }], garden: [item("g.md")] });
		const m = new JetModal(new App() as never, host);
		m.open();
		press(m, "Enter");
		expect(m.inputEl.value).toBe("garden");
		expect(rows().map((r) => r.textContent)).toEqual(["g.md1h"]);
	});
});
