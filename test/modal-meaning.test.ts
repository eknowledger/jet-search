import { afterEach, describe, expect, it } from "vitest";
import { App, type Scope } from "obsidian";
import { type Entry, JetModal, type ModalHost } from "../src/modal/jet-modal";

const fakeHost = (available = true, questions = true) => {
	const lists: Array<[string, { on: boolean; offered: boolean } | undefined]> = [];
	const host: ModalHost = {
		placeholder: "Search notes…",
		list: (text, paint, _scope, _filters, meaning) => {
			lists.push([text, meaning]);
			const header: Entry = meaning?.on
				? { type: "header", label: "By meaning", count: 1, mode: "meaning" }
				: {
						type: "header",
						label: "Results",
						count: 1,
						...(meaning?.offered ? { mode: "words" as const } : {}),
					};
			paint([
				header,
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
		meaning: { available: () => available, questions: () => questions },
	};
	return { host, lists };
};
const press = (m: JetModal, key: string, mods: Parameters<Scope["register"]>[0] = []) =>
	(m.scope as unknown as { press(k: string, m: unknown[]): boolean }).press(key, mods);
const type = (m: JetModal, text: string) => {
	m.inputEl.value = text;
	m.inputEl.setSelectionRange(text.length, text.length);
	m.inputEl.dispatchEvent(new Event("input"));
};
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);

describe("by meaning or by words", () => {
	afterEach(() => document.body.replaceChildren());

	it("a question goes by meaning by itself, says so, and offers words; keywords stay words", () => {
		const { host, lists } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "how do we ship a release");
		expect(lists.at(-1)?.[1]).toEqual({ on: true, offered: false });
		expect($(".jet-h .jet-mode")?.textContent).toContain("Words");
		expect($(".jet-ban")?.textContent).toContain("by meaning");
		type(m, "release checklist");
		expect(lists.at(-1)?.[1]).toEqual({ on: false, offered: false });
		expect($(".jet-h .jet-mode")).toBeNull();
	});

	it("⌘J switches for this search, either way; a new search starts over", () => {
		const { host, lists } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "why did the build fail");
		press(m, "j", ["Mod"]);
		expect(lists.at(-1)?.[1]).toEqual({ on: false, offered: true });
		expect($(".jet-h .jet-mode")?.textContent).toContain("By meaning");
		$(".jet-h .jet-mode")?.click();
		expect(lists.at(-1)?.[1]?.on).toBe(true);
		type(m, "");
		type(m, "deployment checklist");
		press(m, "j", ["Mod"]);
		expect(lists.at(-1)?.[1]?.on).toBe(true);
	});

	it("off, or questions only on ⌘J", () => {
		const off = fakeHost(false);
		const m = new JetModal(new App() as never, off.host);
		m.open();
		type(m, "how do we ship a release");
		expect(off.lists.at(-1)?.[1]).toEqual({ on: false, offered: false });
		press(m, "j", ["Mod"]);
		expect(off.lists.at(-1)?.[1]?.on).toBe(false);
		m.close();
		const manual = fakeHost(true, false);
		const n = new JetModal(new App() as never, manual.host);
		n.open();
		type(n, "how do we ship a release");
		expect(manual.lists.at(-1)?.[1]).toEqual({ on: false, offered: true });
	});
});
