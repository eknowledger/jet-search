import { afterEach, describe, expect, it } from "vitest";
import { App, type Scope } from "obsidian";
import {
	type Entry,
	type HintState,
	JetModal,
	type ModalHost,
	type ScopeView,
	type Typed,
} from "../src/modal/jet-modal";

const COBALT: ScopeView = { id: "cobalt", name: "Cobalt", kind: "Projects", members: 34 };

/** A tiny stand-in for the parser: "Cobalt" at the start, `@cobalt` / `in:cobalt` anywhere. */
const typed = (text: string): Typed => {
	const ex = /(^|\s)(?:in:|@)(\S+)(\s|$)/i.exec(text);
	if (ex && ex[2]?.toLowerCase().startsWith("cob")) {
		const done = ex[2].toLowerCase() === "cobalt";
		if (done)
			return {
				applied: {
					scope: COBALT,
					text: (text.slice(0, ex.index) + (ex[1] ?? "") + text.slice(ex.index + ex[0].length)).trim(),
					complete: ex[3] !== "",
				},
			};
	}
	const m = /^(\s*)(cobalt)(\s+(\S.*))?$/i.exec(text);
	if (!m) return {};
	return m[4]
		? { suggest: { scope: COBALT, others: [], name: m[2] ?? "", rest: m[4], at: m[1]?.length ?? 0 } }
		: { hint: COBALT };
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
	const hints: HintState[] = [];
	const closed: Array<[string, boolean, string | undefined]> = [];
	const opened: string[] = [];
	const edited: string[] = [];
	const host: ModalHost = {
		placeholder: "Search notes…",
		list: (text, paint, scope) => {
			lists.push([text, scope]);
			paint(
				text === "" && !scope
					? [{ type: "search", query: "in:Cobalt world" }]
					: [
							{ type: "header", label: "Results", count: 1 },
							item(`${scope ?? "all"}/${text || "recent"}.md`),
						],
			);
		},
		open: (p) => opened.push(p),
		hints: (_t, state) => {
			hints.push(state ?? {});
			return [["↵", "Open"]];
		},
		closed: (t, o, s) => closed.push([t, o, s?.name]),
		previewOn: () => false,
		setPreviewOn: () => {},
		copyLink: () => {},
		insertLink: () => {},
		create: () => {},
		scopes: {
			typed,
			card: () => ({
				name: "Cobalt",
				kind: "Projects",
				mode: "Suggest",
				rules: [
					{ icon: "folder", text: "2.Projects/Cobalt/ and below", count: 33 },
					{ icon: "hash", text: "#cobalt and nested tags", count: 34 },
				],
				total: 34,
				aliases: [],
			}),
			edit: (id) => edited.push(id),
		},
	};
	return { host, lists, hints, closed, opened, edited };
};

const press = (m: JetModal, key: string, mods: Parameters<Scope["register"]>[0] = []) =>
	(m.scope as unknown as { press(k: string, m: unknown[]): boolean }).press(key, mods);
const type = (m: JetModal, text: string) => {
	m.inputEl.value = text;
	m.inputEl.setSelectionRange(text.length, text.length);
	m.inputEl.dispatchEvent(new Event("input"));
};
const caretToStart = (m: JetModal) => m.inputEl.setSelectionRange(0, 0);
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const shown = (sel: string) => {
	const el = $(sel);
	return !!el && el.isConnected && !el.hasClass("is-hidden");
};

describe("typing a scope in the modal", () => {
	afterEach(() => document.body.replaceChildren());

	it("a suggestion: banner and outline, results from everywhere; Tab applies it and searches inside", () => {
		const { host, lists, hints } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "Cobalt world");
		expect($(".jet-ban")?.textContent).toContain("Search in Cobalt for “world” · 34 notes");
		expect(shown(".jet-ghostbox")).toBe(true);
		expect(lists.at(-1)).toEqual(["Cobalt world", undefined]);
		expect($(".jet-hscope")?.textContent).toBe("· everywhere");
		expect(hints.at(-1)).toEqual({ suggest: "Cobalt" });
		expect(press(m, "Tab")).toBe(true);
		expect(m.inputEl.value).toBe("world");
		expect($(".jet-chip")?.textContent).toContain("Cobalt");
		expect(shown(".jet-ban")).toBe(false);
		expect(shown(".jet-ghostbox")).toBe(false);
		expect(lists.at(-1)).toEqual(["world", "cobalt"]);
		expect($(".jet-hscope")?.textContent).toBe("· in Cobalt");
		expect(hints.at(-1)).toEqual({ chip: "Cobalt" });
	});

	it("⌫ at the start selects the chip; a second ⌫ puts its name back as text", () => {
		const { host, lists } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "Cobalt world");
		press(m, "Tab");
		m.inputEl.setSelectionRange(2, 2);
		expect(press(m, "Backspace")).toBe(false);
		caretToStart(m);
		expect(press(m, "Backspace")).toBe(true);
		expect($(".jet-chip")?.hasClass("is-selected")).toBe(true);
		expect(press(m, "Backspace")).toBe(true);
		expect(shown(".jet-chip")).toBe(false);
		expect(m.inputEl.value).toBe("Cobalt world");
		expect(m.inputEl.selectionStart).toBe(7);
		expect(lists.at(-1)).toEqual(["Cobalt world", undefined]);
		expect(shown(".jet-ban")).toBe(true);
	});

	it("any other key keeps the chip; Esc while it is selected only unselects it", () => {
		const { host } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "Cobalt world");
		press(m, "Tab");
		caretToStart(m);
		press(m, "Backspace");
		type(m, "worlds");
		expect($(".jet-chip")?.hasClass("is-selected")).toBe(false);
		caretToStart(m);
		press(m, "Backspace");
		press(m, "Escape");
		expect(shown(".jet-chip")).toBe(true);
		expect($(".jet-chip")?.hasClass("is-selected")).toBe(false);
		expect(m.isOpen).toBe(true);
	});

	it("Esc clears the text and the chip, then closes; ↵ opens, never applies", () => {
		const { host, opened, closed } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "Cobalt world");
		press(m, "Enter");
		expect(opened).toEqual(["all/Cobalt world.md"]);
		const n = new JetModal(new App() as never, host);
		n.open();
		type(n, "Cobalt world");
		press(n, "Tab");
		press(n, "Escape");
		expect(n.inputEl.value).toBe("");
		expect(shown(".jet-chip")).toBe(false);
		press(n, "Escape");
		expect(n.isOpen).toBe(false);
		expect(closed.at(-1)).toEqual(["", false, undefined]);
	});

	it("@name applies once a space follows it, not while it is typed", () => {
		const { host, lists } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "@cob");
		expect(shown(".jet-chip")).toBe(false);
		type(m, "@cobalt");
		expect(shown(".jet-chip")).toBe(false);
		type(m, "@cobalt world");
		expect(shown(".jet-chip")).toBe(true);
		expect(m.inputEl.value).toBe("world");
		expect(lists.at(-1)).toEqual(["world", "cobalt"]);
	});

	it("the name alone: a hint; Tab applies the scope with nothing typed yet", () => {
		const { host, lists, hints } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "Cobalt");
		expect(shown(".jet-ihint")).toBe(true);
		expect($(".jet-ihint")?.textContent).toContain("Search in Cobalt");
		expect(hints.at(-1)).toEqual({ hint: "Cobalt" });
		press(m, "Tab");
		expect(m.inputEl.value).toBe("");
		expect(m.inputEl.placeholder).toBe("Search in Cobalt…");
		expect(lists.at(-1)).toEqual(["", "cobalt"]);
		expect(shown(".jet-ihint")).toBe(false);
	});

	it("Tab without a suggestion is left alone", () => {
		const { host } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "garden");
		expect(press(m, "Tab")).toBe(false);
	});

	it("← at the start opens the chip's card with its rules; Edit scope goes to its settings", () => {
		const { host, edited } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "Cobalt world");
		press(m, "Tab");
		caretToStart(m);
		expect(press(m, "ArrowLeft")).toBe(true);
		expect(shown(".jet-card")).toBe(true);
		expect($(".jet-card")?.textContent).toContain("2.Projects/Cobalt/ and below33");
		expect($(".jet-card")?.textContent).toContain("34 notes in all");
		$(".jet-card .jet-ce")?.click();
		expect(edited).toEqual(["cobalt"]);
		expect(m.isOpen).toBe(false);
	});

	it("closing with a chip tells the host its scope; a chosen recent search re-applies it", () => {
		const { host, closed } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		press(m, "Enter");
		expect(shown(".jet-chip")).toBe(true);
		expect(m.inputEl.value).toBe("world");
		m.close();
		expect(closed.at(-1)).toEqual(["world", false, "Cobalt"]);
	});

	it("× on the chip removes it and keeps the text", () => {
		const { host, lists } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "Cobalt world");
		press(m, "Tab");
		$(".jet-chip .jet-chx")?.click();
		expect(shown(".jet-chip")).toBe(false);
		expect(m.inputEl.value).toBe("world");
		expect(lists.at(-1)).toEqual(["world", undefined]);
	});
});
