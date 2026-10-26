import { afterEach, describe, expect, it } from "vitest";
import { App, type Scope } from "obsidian";
import { type Entry, JetModal, type ModalHost } from "../src/modal/jet-modal";
import type { BothLayout, MeaningMode } from "../src/modal/both";

type Asked = { on: boolean; offered: boolean; both?: boolean } | undefined;

const row = (path: string, meaning = false): Entry => ({
	type: "item",
	path,
	title: path.replace(/\.md$/, ""),
	titleRanges: [],
	crumb: "",
	meta: "",
	icon: "file-text",
	...(meaning ? { meaning: true, badge: "by meaning" } : {}),
});

/** A host whose words find a, b, c… and whose meaning finds b (a note found both ways), m1, m2… */
const fakeHost = (available = true, questions: MeaningMode = "meaning", words = 3, near = 3) => {
	const lists: Array<[string, Asked]> = [];
	let layout: BothLayout = "groups";
	const wordRows = Array.from({ length: words }, (_, i) => row(`${String.fromCharCode(97 + i)}.md`));
	const nearRows = [row("b.md", true), ...Array.from({ length: near - 1 }, (_, i) => row(`m${i + 1}.md`, true))];
	const host: ModalHost = {
		placeholder: "Search notes…",
		list: (text, paint, _scope, _filters, meaning) => {
			lists.push([text, meaning]);
			if (meaning?.both) {
				paint([{ type: "header", label: "Titles", count: words }, ...wordRows, ...nearRows]);
				return;
			}
			paint(
				meaning?.on
					? [{ type: "header", label: "By meaning", count: near }, ...nearRows]
					: [{ type: "header", label: "Results", count: words }, ...wordRows],
			);
		},
		open: () => {},
		hints: () => [["↵", "Open"]],
		closed: () => {},
		previewOn: () => false,
		setPreviewOn: () => {},
		copyLink: () => {},
		insertLink: () => {},
		create: () => {},
		meaning: { available: () => available, questions: () => questions, layout: () => layout },
	};
	return {
		host,
		lists,
		setLayout: (l: BothLayout) => {
			layout = l;
		},
	};
};
const press = (m: JetModal, key: string, mods: Parameters<Scope["register"]>[0] = []) =>
	(m.scope as unknown as { press(k: string, m: unknown[]): boolean }).press(key, mods);
const type = (m: JetModal, text: string) => {
	m.inputEl.value = text;
	m.inputEl.setSelectionRange(text.length, text.length);
	m.inputEl.dispatchEvent(new Event("input"));
};
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const on = () => $(".jet-h .jet-seg .is-on")?.textContent ?? null;
const view = () =>
	[...document.querySelectorAll<HTMLElement>(".jet-list > .jet-h, .jet-list > .jet-row")].map((e) =>
		e.classList.contains("jet-h")
			? `# ${e.firstElementChild?.textContent}`
			: e.classList.contains("jet-more")
				? `+ ${e.textContent}`
				: `${e.querySelector(".jet-rt")?.textContent}${e.querySelector(".jet-bdg") ? ` [${e.querySelector(".jet-bdg")?.textContent}]` : ""}`,
	);

describe("by meaning or by words", () => {
	afterEach(() => document.body.replaceChildren());

	it("a question shows what you chose (here: by meaning), says so, and the switch shows it; keywords stay words", () => {
		const { host, lists } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "how do we ship a release");
		expect(lists.at(-1)?.[1]).toEqual({ on: true, offered: false, both: false });
		expect(on()).toBe("Meaning");
		expect($(".jet-ban")?.textContent).toContain("by meaning");
		type(m, "release checklist");
		expect(lists.at(-1)?.[1]).toEqual({ on: false, offered: false, both: false });
		expect($(".jet-h .jet-seg")).toBeNull();
	});

	it("⌘J moves words → meaning → both → words for this search; the switch's buttons pick one; a new search starts over", () => {
		const { host, lists } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "why did the build fail");
		press(m, "j", ["Mod"]);
		expect(lists.at(-1)?.[1]).toEqual({ on: true, offered: false, both: true });
		expect(on()).toBe("Both");
		press(m, "j", ["Mod"]);
		expect(lists.at(-1)?.[1]).toEqual({ on: false, offered: true, both: false });
		expect(on()).toBe("Words");
		$('.jet-h .jet-seg [data-mode="meaning"]')?.click();
		expect(lists.at(-1)?.[1]?.on).toBe(true);
		type(m, "");
		type(m, "deployment checklist");
		press(m, "j", ["Mod"]);
		expect(lists.at(-1)?.[1]?.on).toBe(true);
	});

	it("off, or questions by words: meaning only when you switch", () => {
		const off = fakeHost(false);
		const m = new JetModal(new App() as never, off.host);
		m.open();
		type(m, "how do we ship a release");
		expect(off.lists.at(-1)?.[1]).toEqual({ on: false, offered: false, both: false });
		press(m, "j", ["Mod"]);
		expect(off.lists.at(-1)?.[1]?.on).toBe(false);
		m.close();
		const manual = fakeHost(true, "words");
		const n = new JetModal(new App() as never, manual.host);
		n.open();
		type(n, "how do we ship a release");
		expect(manual.lists.at(-1)?.[1]).toEqual({ on: false, offered: true, both: false });
	});
});

describe("by words and by meaning at once", () => {
	afterEach(() => document.body.replaceChildren());
	const both = (layout: BothLayout, words = 3, near = 3) => {
		const f = fakeHost(true, "both", words, near);
		f.setLayout(layout);
		const m = new JetModal(new App() as never, f.host);
		m.open();
		type(m, "how do we ship a release");
		return { m, ...f };
	};

	it("a question shows both by default; the banner says so", () => {
		const { lists } = both("groups");
		expect(lists.at(-1)?.[1]).toEqual({ on: true, offered: false, both: true });
		expect(on()).toBe("Both");
		expect($(".jet-ban")?.textContent).toContain("A question: by words and by meaning");
	});

	it("A, two groups: by words (a note meaning found too is marked), then only what meaning found", () => {
		both("groups");
		expect(view()).toEqual([
			"# By words",
			"a",
			"b [also by meaning]",
			"c",
			"# By meaning",
			"m1 [by meaning]",
			"m2 [by meaning]",
		]);
	});

	it("B, found both ways first, then words, then meaning", () => {
		both("first");
		expect(view()).toEqual([
			"# Found both ways",
			"b [both]",
			"# By words",
			"a",
			"c",
			"# By meaning",
			"m1 [by meaning]",
			"m2 [by meaning]",
		]);
	});

	it("C, one list ranked together, each row badged", () => {
		both("ranked");
		expect(view()).toEqual([
			"# Results",
			"a [by words]",
			"b [both]",
			"m1 [by meaning]",
			"c [by words]",
			"m2 [by meaning]",
		]);
	});

	it("a long group shows its first 5 and a “more” row; ↵ on it opens the rest in place; a new search closes it", () => {
		const { m } = both("groups", 9, 2);
		const v = view();
		expect(v.slice(0, 7)).toEqual([
			"# By words",
			"a",
			"b [also by meaning]",
			"c",
			"d",
			"e",
			"+ 4 more by words · Show them",
		]);
		expect(v.slice(7)).toEqual(["# By meaning", "m1 [by meaning]"]);
		for (let i = 0; i < 5; i++) press(m, "ArrowDown");
		press(m, "Enter");
		expect(view().slice(0, 11)).toEqual([
			"# By words",
			"a",
			"b [also by meaning]",
			"c",
			"d",
			"e",
			"f",
			"g",
			"h",
			"i",
			"# By meaning",
		]);
		type(m, "how do we ship a release now");
		expect(view()).toContain("+ 4 more by words · Show them");
	});
});

describe("long searches by meaning, an opt-in", () => {
	afterEach(() => document.body.replaceChildren());
	const withLong = (long: boolean, asked: MeaningMode = "meaning") => {
		const f = fakeHost(true, asked);
		f.host.meaning = { available: () => true, questions: () => asked, long: () => long };
		return f;
	};
	const SENTENCE = "the billing service retries failed card payments twice";

	it("off (the default): a long search stays words and is not offered meaning", () => {
		const { host, lists } = withLong(false);
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, SENTENCE);
		expect(lists.at(-1)?.[1]).toEqual({ on: false, offered: false, both: false });
	});

	it("on: 6 words or more go by meaning (or both, when questions show both); 5 words, quotes or a filter stay words", () => {
		const { host, lists } = withLong(true);
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, SENTENCE);
		expect(lists.at(-1)?.[1]).toEqual({ on: true, offered: false, both: false });
		expect($(".jet-ban")?.textContent).toContain("A long search, so by meaning");
		type(m, "billing service retries failed payments");
		expect(lists.at(-1)?.[1]?.on).toBe(false);
		type(m, '"the billing service retries failed card payments"');
		expect(lists.at(-1)?.[1]?.on).toBe(false);
		type(m, "the billing service retries failed card #payments");
		expect(lists.at(-1)?.[1]?.on).toBe(false);
		m.close();
		const b = withLong(true, "both");
		const n = new JetModal(new App() as never, b.host);
		n.open();
		type(n, SENTENCE);
		expect(b.lists.at(-1)?.[1]).toEqual({ on: true, offered: false, both: true });
		expect($(".jet-ban")?.textContent).toContain("A long search: by words and by meaning");
	});

	it("a long question is still a question, and ⌘J still moves a long search on", () => {
		const { host, lists } = withLong(true);
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "why does the billing service retry failed card payments");
		expect($(".jet-ban")?.textContent).toContain("A question, so by meaning");
		type(m, "");
		type(m, SENTENCE);
		press(m, "j", ["Mod"]);
		expect(lists.at(-1)?.[1]).toEqual({ on: true, offered: false, both: true });
	});
});
