import { afterEach, describe, expect, it } from "vitest";
import { App, type Scope } from "obsidian";
import { type Entry, JetModal, type ModalHost, type ScopeView, type Typed } from "../src/modal/jet-modal";

const PROJECT: ScopeView = { id: "amb-p", name: "Amber Studio", kind: "Projects", members: 138 };
const AREA: ScopeView = { id: "amb-a", name: "Amber Studio", kind: "Areas", members: 17 };
const BRIDGE: ScopeView = { id: "bridge", name: "Moonbridge", kind: "Projects", members: 35 };

/** "Amber Studio" names two scopes; "Moonbridge" is on Auto. */
const typed = (text: string): Typed => {
	const amb = /^(amber studio)(\s+(\S.*))?$/i.exec(text);
	if (amb)
		return amb[3]
			? { suggest: { scope: PROJECT, others: [AREA], name: amb[1] ?? "", rest: amb[3], at: 0 } }
			: { hint: PROJECT };
	const p = /^(moonbridge)(\s+(\S.*))?\s*$/i.exec(text);
	if (p)
		return p[3]
			? { suggest: { scope: BRIDGE, others: [], name: p[1] ?? "", rest: p[3].trim(), at: 0 }, auto: true }
			: { hint: BRIDGE, auto: true };
	return {};
};

const item = (path: string): Entry => ({
	type: "item",
	path,
	title: path,
	titleRanges: [],
	crumb: "",
	meta: "1h",
	icon: "file-text",
});

const fakeHost = () => {
	const lists: Array<[string, string | undefined]> = [];
	const created: Array<[string, string | undefined]> = [];
	const host: ModalHost = {
		placeholder: "Search notes…",
		list: (text, paint, scope) => {
			lists.push([text, scope]);
			paint(
				text === "zz"
					? [
							{ type: "notice", title: "No results for “zz” in Amber Studio" },
							{ type: "widen", label: "Search everywhere for “zz”", detail: "3 notes" },
						]
					: [{ type: "header", label: "Results", count: 1 }, item(`${scope ?? "all"}/${text}.md`)],
			);
		},
		open: () => {},
		hints: () => [["↵", "Open"]],
		closed: () => {},
		previewOn: () => false,
		setPreviewOn: () => {},
		copyLink: () => {},
		insertLink: () => {},
		create: (t, s) => created.push([t, s]),
		scopes: {
			typed,
			card: () => ({ name: "", kind: "", mode: "", rules: [], total: 0, aliases: [] }),
			edit: () => {},
		},
	};
	return { host, lists, created };
};

const press = (m: JetModal, key: string, mods: Parameters<Scope["register"]>[0] = []) =>
	(m.scope as unknown as { press(k: string, m: unknown[]): boolean }).press(key, mods);
const type = (m: JetModal, text: string) => {
	m.inputEl.value = text;
	m.inputEl.setSelectionRange(text.length, text.length);
	m.inputEl.dispatchEvent(new Event("input"));
};
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const chipText = () => $(".jet-chip:not(.is-hidden) .jet-chl")?.textContent ?? null;

describe("ambiguous names, Auto, widen, empty scope, create in scope", () => {
	afterEach(() => document.body.replaceChildren());

	it("two scopes of one name: the banner lists both; Tab takes the first, Tab again the next, ⇧Tab back", () => {
		const { host, lists } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "Amber Studio plugin");
		expect($(".jet-ban")?.textContent).toContain("Two scopes are named “Amber Studio”");
		expect([...document.querySelectorAll(".jet-pill")].map((p) => p.textContent)).toEqual([
			"Amber Studio · Projects · 138",
			"Amber Studio · Areas · 17",
		]);
		press(m, "Tab");
		expect(chipText()).toBe("Amber Studio · Projects");
		expect(lists.at(-1)).toEqual(["plugin", "amb-p"]);
		expect(press(m, "Tab")).toBe(true);
		expect(chipText()).toBe("Amber Studio · Areas");
		expect(lists.at(-1)).toEqual(["plugin", "amb-a"]);
		expect(press(m, "Tab", ["Shift"])).toBe(true);
		expect(chipText()).toBe("Amber Studio · Projects");
		expect($(".jet-pill.is-active")?.textContent).toBe("Amber Studio · Projects · 138");
	});

	it("Auto: the name and a space apply the scope at once; ⌫ right after undoes it for this search", () => {
		const { host, lists } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "Moonbridge");
		expect(chipText()).toBeNull();
		type(m, "Moonbridge ");
		expect(chipText()).toBe("Moonbridge");
		expect(m.inputEl.value).toBe("");
		expect($(".jet-ban")?.textContent).toContain("Scoped to Moonbridge · Auto");
		expect(lists.at(-1)).toEqual(["", "bridge"]);
		m.inputEl.setSelectionRange(0, 0);
		expect(press(m, "Backspace")).toBe(true);
		expect(chipText()).toBeNull();
		expect(m.inputEl.value).toBe("Moonbridge ");
		// Undone: no Auto again in this search, the suggestion instead.
		type(m, "Moonbridge invoices");
		expect(chipText()).toBeNull();
		expect($(".jet-ban")?.textContent).toContain("Search in Moonbridge");
	});

	it("Auto pasted with more text applies with the rest; typing on hides the undo banner", () => {
		const { host } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "Moonbridge invoices ");
		expect(chipText()).toBe("Moonbridge");
		// The space typed after it stays: the next word does not stick to this one.
		expect(m.inputEl.value).toBe("invoices ");
		type(m, "invoices q");
		expect($(".jet-ban")?.isConnected ?? false).toBe(false);
	});

	it("widen (⇧⇧ while open): the same text everywhere, and ⇧⇧ again goes back", () => {
		const { host, lists } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		expect(m.widen()).toBe(false);
		type(m, "Amber Studio plugin");
		press(m, "Tab");
		expect(m.widen()).toBe(true);
		expect(chipText()).toBeNull();
		expect(m.inputEl.value).toBe("plugin");
		expect(lists.at(-1)).toEqual(["plugin", undefined]);
		expect($(".jet-ban")?.textContent).toContain("Searching everywhere");
		expect(m.widen()).toBe(true);
		expect(chipText()).toBe("Amber Studio · Projects");
		expect(lists.at(-1)).toEqual(["plugin", "amb-p"]);
	});

	it("nothing in the scope: choosing “Search everywhere” widens", () => {
		const { host, lists } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "Amber Studio zz");
		press(m, "Tab");
		expect($(".jet-row")?.textContent).toContain("Search everywhere for “zz”");
		press(m, "Enter");
		expect(chipText()).toBeNull();
		expect(lists.at(-1)).toEqual(["zz", undefined]);
	});

	it("⇧↵ creates the note in the chip's scope", () => {
		const { host, created } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "Amber Studio new idea");
		press(m, "Tab");
		press(m, "Enter", ["Shift"]);
		expect(created).toEqual([["new idea", "amb-p"]]);
	});
});
