import { afterEach, describe, expect, it } from "vitest";
import { App } from "obsidian";
import { type Entry, JetModal, type ModalHost, type ScopeView, type Typed } from "../src/modal/jet-modal";

const COBALT: ScopeView = { id: "cobalt", name: "Cobalt", kind: "Projects", members: 34 };
const BRIDGE: ScopeView = { id: "bridge", name: "Moonbridge", kind: "Projects", members: 35 };

/** @cobalt applies; "cobalt …" suggests; Moonbridge and its alias mb are on Auto. */
const typed = (text: string): Typed => {
	const at = /^@(cob\S*)(\s+(.*))?$/i.exec(text);
	if (at) return { applied: { scope: COBALT, text: (at[3] ?? "").trim(), complete: at[2] !== undefined } };
	const p = /^(moonbridge|mb)(\s+(\S.*))?\s*$/i.exec(text);
	if (p)
		return p[3]
			? { suggest: { scope: BRIDGE, others: [], name: p[1] ?? "", rest: p[3].trim(), at: 0 }, auto: true }
			: { hint: BRIDGE, auto: true };
	const c = /^(cobalt)(\s+(\S.*))?$/i.exec(text);
	if (c)
		return c[3]
			? { suggest: { scope: COBALT, others: [], name: c[1] ?? "", rest: c[3], at: 0 } }
			: { hint: COBALT };
	return {};
};

const item = (path: string): Entry => ({
	type: "item",
	path,
	title: path,
	titleRanges: [],
	crumb: "",
	meta: "",
	icon: "file-text",
});

const fakeHost = () => {
	const lists: Array<[string, string | undefined]> = [];
	const host: ModalHost = {
		placeholder: "Search notes…",
		list: (text, paint, scope) => {
			lists.push([text, scope]);
			paint([{ type: "header", label: "Results", count: 1 }, item(`${scope ?? "all"}/${text}.md`)]);
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
	};
	return { host, lists };
};

const press = (m: JetModal, key: string) =>
	(m.scope as unknown as { press(k: string, m: unknown[]): boolean }).press(key, []);
const type = (m: JetModal, text: string) => {
	m.inputEl.value = text;
	m.inputEl.setSelectionRange(text.length, text.length);
	m.inputEl.dispatchEvent(new Event("input"));
};
const chip = () => document.querySelector(".jet-chip:not(.is-hidden) .jet-chl")?.textContent ?? null;
const open = () => {
	const h = fakeHost();
	const m = new JetModal(new App() as never, h.host);
	m.open();
	return { m, ...h };
};

describe("scopes keep working after Esc, ⌫ and an applied chip", () => {
	afterEach(() => document.body.replaceChildren());

	it("Auto undone with ⌫ stays off only until the box is cleared", () => {
		const { m } = open();
		type(m, "Moonbridge ");
		expect(chip()).toBe("Moonbridge");
		m.inputEl.setSelectionRange(0, 0);
		press(m, "Backspace");
		expect(chip()).toBeNull();
		press(m, "Escape");
		expect(m.inputEl.value).toBe("");
		type(m, "mb ");
		expect(chip()).toBe("Moonbridge");
	});

	it("an Auto chip removed with ⌫ ⌫ does not come straight back from its own name", () => {
		const { m } = open();
		type(m, "Moonbridge ");
		type(m, "status");
		expect(chip()).toBe("Moonbridge");
		m.inputEl.setSelectionRange(0, 0);
		press(m, "Backspace");
		press(m, "Backspace");
		expect(chip()).toBeNull();
		expect(m.inputEl.value).toBe("Moonbridge status");
	});

	it("with a chip on, @name switches to that scope, and the same name only leaves the text", () => {
		const { m, lists } = open();
		type(m, "Moonbridge ");
		type(m, "@cob world");
		expect(chip()).toBe("Cobalt");
		expect(m.inputEl.value).toBe("world");
		expect(lists.at(-1)).toEqual(["world", "cobalt"]);
		type(m, "@cobalt notes");
		expect(chip()).toBe("Cobalt");
		expect(m.inputEl.value).toBe("notes");
	});

	it("with a chip on, an Auto name switches to it; ⌫ undoes back to the chip before", () => {
		const { m } = open();
		type(m, "@cob ");
		expect(chip()).toBe("Cobalt");
		type(m, "mb status");
		expect(chip()).toBe("Moonbridge");
		expect(m.inputEl.value).toBe("status");
		m.inputEl.setSelectionRange(0, 0);
		press(m, "Backspace");
		expect(chip()).toBe("Cobalt");
		expect(m.inputEl.value).toBe("mb status");
	});

	it("with a chip on, a Suggest name offers to switch, and Tab switches", () => {
		const { m } = open();
		type(m, "mb ");
		type(m, "cobalt world");
		expect(chip()).toBe("Moonbridge");
		expect(document.querySelector(".jet-ban")?.textContent).toContain("instead of Moonbridge");
		press(m, "Tab");
		expect(chip()).toBe("Cobalt");
		expect(m.inputEl.value).toBe("world");
	});

	it("after Esc clears a chip, typing a scope works as on a fresh open", () => {
		const { m } = open();
		type(m, "@cob world");
		expect(chip()).toBe("Cobalt");
		press(m, "Escape");
		expect(chip()).toBeNull();
		type(m, "@cob again");
		expect(chip()).toBe("Cobalt");
		press(m, "Escape");
		type(m, "Moonbridge ");
		expect(chip()).toBe("Moonbridge");
	});
});
