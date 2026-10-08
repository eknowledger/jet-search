import { afterEach, describe, expect, it } from "vitest";
import { App, Menu, type Scope } from "obsidian";
import { type Entry, JetModal, type ModalHost, sortEntries } from "../src/modal/jet-modal";

const item = (path: string, mtime: number, ctime: number, reasons?: string[]): Entry => ({
	type: "item",
	path,
	title: path.replace(/\.md$/, ""),
	titleRanges: [],
	crumb: "",
	meta: "",
	icon: "file-text",
	mtime,
	ctime,
	...(reasons ? { reasons } : {}),
});
const LIST: Entry[] = [
	{ type: "header", label: "Titles", count: 1 },
	item("Beta.md", 3, 1),
	{ type: "header", label: "In text", count: 2 },
	item("Alpha.md", 1, 3, ["type = status-report"]),
	item("Gamma.md", 2, 2),
];
const titles = (e: Entry[]) => e.filter((x) => x.type === "item").map((x) => (x as { title: string }).title);

describe("sort", () => {
	afterEach(() => document.body.replaceChildren());

	it("orders the items, one group, the first header's note kept; best match leaves them", () => {
		expect(titles(sortEntries(LIST, "best"))).toEqual(["Beta", "Alpha", "Gamma"]);
		expect(titles(sortEntries(LIST, "edited-new"))).toEqual(["Beta", "Gamma", "Alpha"]);
		expect(titles(sortEntries(LIST, "edited-old"))).toEqual(["Alpha", "Gamma", "Beta"]);
		expect(titles(sortEntries(LIST, "created-new"))).toEqual(["Alpha", "Gamma", "Beta"]);
		expect(titles(sortEntries(LIST, "title"))).toEqual(["Alpha", "Beta", "Gamma"]);
		expect(sortEntries(LIST, "title").filter((e) => e.type === "header")).toEqual([
			{ type: "header", label: "Results", count: 3, note: undefined },
		]);
	});

	it("the header's control opens the menu; ⌘⇧S moves to the next order; reasons show as badges", () => {
		const host: ModalHost = {
			placeholder: "",
			list: (_t, paint) => paint(LIST),
			open: () => {},
			hints: () => [],
			closed: () => {},
			previewOn: () => false,
			setPreviewOn: () => {},
			copyLink: () => {},
			insertLink: () => {},
			create: () => {},
		};
		const m = new JetModal(new App() as never, host);
		m.open();
		m.inputEl.value = "x";
		m.inputEl.dispatchEvent(new Event("input"));
		const sort = document.querySelector<HTMLElement>(".jet-sort");
		expect(sort?.textContent).toBe("Best match");
		sort?.click();
		const menu = (Menu as unknown as { last: { items: Array<{ title: string; click: () => void }> } }).last;
		expect(menu.items.map((i) => i.title)).toContain("Title: A → Z");
		menu.items.find((i) => i.title === "Title: A → Z")?.click();
		expect([...document.querySelectorAll(".jet-row .jet-rt")].map((r) => r.textContent)).toEqual([
			"Alpha",
			"Beta",
			"Gamma",
		]);
		(m.scope as unknown as { press(k: string, m: unknown[]): boolean }).press("s", ["Mod", "Shift"] as Parameters<
			Scope["register"]
		>[0]);
		expect(document.querySelector(".jet-sort")?.textContent).toBe("Best match");
		expect(document.querySelector(".jet-rsn")?.textContent).toBe("type = status-report");
	});
});
