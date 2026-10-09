import { afterEach, describe, expect, it } from "vitest";
import { App, Menu, type Scope } from "obsidian";
import { type Filter, findFilters } from "../src/filters/filter";
import { type Entry, JetModal, type ModalHost, type ScopeView, type Typed } from "../src/modal/jet-modal";

const COBALT: ScopeView = { id: "cobalt", name: "Cobalt", kind: "Projects", members: 34 };
const typed = (text: string): Typed => {
	const m = /^(cobalt)(\s+(\S.*))?$/i.exec(text);
	if (!m) return {};
	return m[3] ? { suggest: { scope: COBALT, others: [], name: m[1] ?? "", rest: m[3], at: 0 } } : { hint: COBALT };
};
const known = (k: string) => ["status", "type"].includes(k.toLowerCase());

const fakeHost = () => {
	const lists: Array<[string, string | undefined, string[]]> = [];
	const closed: Array<[string, string | undefined, string[]]> = [];
	const host: ModalHost = {
		placeholder: "Search notes…",
		list: (text, paint, scope, filters = []) => {
			lists.push([text, scope, filters.map((f) => f.kind)]);
			paint([
				{ type: "header", label: "Results", count: 1 },
				{
					type: "item",
					path: "a.md",
					title: "a",
					titleRanges: [],
					crumb: "",
					meta: "",
					icon: "file-text",
				} as Entry,
			]);
		},
		open: () => {},
		hints: () => [["↵", "Open"]],
		closed: (t, _o, s, f = []) => closed.push([t, s?.name, f.map((x) => x.kind)]),
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
		filters: {
			find: (t) => findFilters(t, known),
			values: () => [
				["status-report", 12],
				["meeting", 30],
			],
			tags: () => [["#cobalt", 34]],
			keys: () => [
				["status", 96],
				["type", 530],
			],
			scopes: () => [COBALT],
			complete: () => null,
			fix: () => null,
			preview: () => [],
		},
	};
	return { host, lists, closed };
};

const press = (m: JetModal, key: string, mods: Parameters<Scope["register"]>[0] = []) =>
	(m.scope as unknown as { press(k: string, m: unknown[]): boolean }).press(key, mods);
const type = (m: JetModal, text: string) => {
	m.inputEl.value = text;
	m.inputEl.setSelectionRange(text.length, text.length);
	m.inputEl.dispatchEvent(new Event("input"));
};
const chips = () => [...document.querySelectorAll(".jet-fchip")].map((c) => c.textContent);
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const pick = (title: string) => {
	const i = (
		Menu as unknown as { last: { items: Array<{ title: string; click: (() => void) | null }> } }
	).last.items.find((x) => x.title.startsWith(title));
	if (!i?.click) throw new Error(`no menu item ${title}`);
	i.click();
};

describe("filters as chips", () => {
	afterEach(() => document.body.replaceChildren());

	it("a finished filter becomes a chip; the rest is the text; an unfinished one is left out of the search", () => {
		const { host, lists } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "status:dra");
		expect(chips()).toEqual([]);
		expect(lists.at(-1)).toEqual(["", undefined, []]);
		type(m, "status:draft ");
		expect(chips()).toEqual(["statusdraft"]);
		expect(m.inputEl.value).toBe("");
		expect(lists.at(-1)).toEqual(["", undefined, ["prop"]]);
		type(m, "world #cobalt ");
		expect(chips()).toEqual(["statusdraft", "tag#cobalt"]);
		// The space typed after the chip stays, so the next word stays apart.
		expect(m.inputEl.value).toBe("world ");
		expect(lists.at(-1)).toEqual(["world ", undefined, ["prop", "tag"]]);
		expect($(".jet-hscope")?.textContent).toBe("· 2 filters");
	});

	it("⌫ at the start selects the last chip, again removes it (it must go, not come back as text)", () => {
		const { host, lists } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "Cobalt world");
		press(m, "Tab");
		type(m, "status:draft world");
		expect(chips()).toEqual(["statusdraft"]);
		m.inputEl.setSelectionRange(0, 0);
		press(m, "Backspace");
		expect($(".jet-fchip")?.hasClass("is-selected")).toBe(true);
		press(m, "Backspace");
		expect(chips()).toEqual([]);
		expect(m.inputEl.value).toBe("world");
		expect(lists.at(-1)).toEqual(["world", "cobalt", []]);
	});

	it("a quoted filter goes too, and the next ⌫ pair takes the one before it", () => {
		const { host } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, 'status:draft type:"ai note" ');
		expect(chips()).toEqual(["statusdraft", "typeai note"]);
		m.inputEl.setSelectionRange(0, 0);
		press(m, "Backspace");
		press(m, "Backspace");
		expect(chips()).toEqual(["statusdraft"]);
		expect(m.inputEl.value).toBe("");
		press(m, "Backspace");
		press(m, "Backspace");
		expect(chips()).toEqual([]);
	});

	it("⌘F shows the bar: Edited, Type, Tags, In, Title only and Clear", () => {
		const { host, lists } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		expect($(".jet-fbar")?.hasClass("is-hidden")).toBe(true);
		press(m, "f", ["Mod"]);
		expect($(".jet-fbar")?.hasClass("is-hidden")).toBe(false);
		const button = (t: string) =>
			[...document.querySelectorAll<HTMLElement>(".jet-fbar .jet-fb")].find((b) => b.textContent?.startsWith(t));
		button("Edited")?.click();
		pick("Past 7 days");
		button("Type")?.click();
		pick("status-report");
		button("Tags")?.click();
		pick("#cobalt");
		expect(chips()).toEqual(["editedpast 7 days", "typestatus-report", "tag#cobalt"]);
		button("Title only")?.click();
		expect(lists.at(-1)?.[2]).toEqual(["edited", "prop", "tag", "title"]);
		button("In")?.click();
		pick("Cobalt");
		expect(lists.at(-1)?.[1]).toBe("cobalt");
		button("Clear")?.click();
		expect(chips()).toEqual([]);
		expect(lists.at(-1)).toEqual(["", undefined, []]);
	});

	it("closing tells the host its filters (a recent search keeps them)", () => {
		const { host, closed } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "status:draft world");
		m.close();
		expect(closed.at(-1)).toEqual(["world", undefined, ["prop"]]);
	});
});

export type { Filter };
