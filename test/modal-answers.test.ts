import { afterEach, describe, expect, it } from "vitest";
import { App } from "obsidian";
import { type Entry, JetModal, type ModalHost } from "../src/modal/jet-modal";

const item = (path: string, extra: Partial<Extract<Entry, { type: "item" }>> = {}): Entry => ({
	type: "item",
	path,
	title: path.replace(/\.md$/, ""),
	titleRanges: [],
	crumb: "",
	meta: "",
	icon: "file-text",
	...extra,
});
const ANSWERS: Entry[] = [
	{ type: "header", label: "Answers", count: 3, answers: true },
	item("m1.md", {
		badge: "by meaning",
		meaning: true,
		excerpt: { text: "Screens are ~20-30% of the sales", marks: [[27, 32]], more: 0 },
		answer: { cover: 0.9, nums: [[12, 19]], line: "- Screens are ~20-30% of the sales" },
	}),
	item("a.md", {
		badge: "by words",
		excerpt: { text: "A line", marks: [], more: 0 },
		answer: { cover: 0.55, nums: [], line: "A line" },
	}),
	item("b.md", { badge: "both", answer: { cover: 0.2, nums: [], line: "" } }),
];

const host = (): ModalHost => ({
	placeholder: "Search notes…",
	list: (_text, paint, _s, _f, meaning) => {
		// The lists both ways first, then the answers.
		if (meaning?.both)
			paint([{ type: "header", label: "Titles", count: 2 }, item("a.md"), item("m1.md", { meaning: true })]);
		paint(ANSWERS);
	},
	open: () => {},
	hints: () => [["↵", "Open"]],
	closed: () => {},
	previewOn: () => false,
	setPreviewOn: () => {},
	copyLink: () => {},
	insertLink: () => {},
	create: () => {},
	meaning: { available: () => true, questions: () => "both", layout: () => "groups" },
});
const type = (m: JetModal, text: string) => {
	m.inputEl.value = text;
	m.inputEl.setSelectionRange(text.length, text.length);
	m.inputEl.dispatchEvent(new Event("input"));
};
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];

let open: JetModal | null = null;
afterEach(() => {
	open?.close();
	open = null;
});

describe("answers in the window (experiment)", () => {
	it("keeps the answers' order in a search both ways, says why, and shows each line's closeness and figures", () => {
		const m = new JetModal(new App() as never, host());
		open = m;
		m.open();
		type(m, "what share of the sales has screens?");
		expect($$(".jet-list > .jet-row .jet-rt").map((e) => e.textContent)).toEqual(["m1", "a", "b"]);
		expect($(".jet-list > .jet-h")?.firstElementChild?.textContent).toBe("Answers");
		expect($(".jet-ban .jet-bt")?.textContent).toBe("A question: notes by the line that answers it");
		const meters = $$(".jet-close");
		expect(meters.map((e) => e.textContent)).toEqual(["close", "fair", "loose"]);
		expect((meters[0]?.querySelector(".jet-cfill") as HTMLElement | null)?.style.width).toBe("90%");
		const l3 = $(".jet-row .jet-l3");
		expect(l3?.querySelector(".jet-num")?.textContent).toBe("~20-30%");
		expect(l3?.querySelector("mark.jet-mark")?.textContent).toBe("sales");
		expect(l3?.textContent).toBe("Screens are ~20-30% of the sales");
	});
});
