import "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Explained } from "../src/explain/explainer";
import type { View } from "../src/explain/view";
import { type Candidate, ExplainPane, type PaneIo, type Pick } from "../src/modal/explain-pane";

const view = (head: string, over: Partial<View> = {}): View => ({
	tone: "ok",
	head,
	detail: null,
	tables: [],
	notes: [],
	setup: [
		["Searched", "by words"],
		["Where", "in Cobalt"],
	],
	...over,
});
const explained = (note: string | null): Explained => ({
	search: view("2 notes hold every word, so only those are listed.", {}),
	note: note
		? view(note, {
				tables: [
					{
						title: "Where each word is in this note",
						head: ["Word", "In this note"],
						rows: [[{ text: "walnut" }, { text: "not found", pill: "no" }]],
					},
				],
			})
		: null,
	lines: () => ["line"],
});

const wait = (ms = 160): Promise<void> => new Promise((r) => setTimeout(r, ms));

const rig = (over: Partial<PaneIo> = {}) => {
	const asked: Array<[Pick | null, string]> = [];
	const kept: Explained[] = [];
	const shown: number[] = [];
	const backs: number[] = [];
	const io: PaneIo = {
		explain: (n, m) => {
			asked.push([n, m]);
			return Promise.resolve(explained(n ? `Ranked 1 of 2 (${n.name}).` : null));
		},
		find: (t) =>
			[
				{ path: "A/Kiosk rollout.md", name: "Kiosk rollout", folder: "A" },
				{ path: "B/Kiosk.md", name: "Kiosk", folder: "B" },
			].filter((c) => c.name.toLowerCase().includes(t.toLowerCase())) as Candidate[],
		keep: (e) => kept.push(e),
		support: () => void shown.push(1),
		back: () => void backs.push(1),
		...over,
	};
	const parent = document.createElement("div");
	document.body.append(parent);
	const pane = new ExplainPane(parent, io);
	return { pane, asked, kept, shown, backs, el: pane.el };
};
const sel: Pick = { path: "Projects/Pilot.md", name: "Pilot" };

afterEach(() => document.body.replaceChildren());

describe("the explanation pane", () => {
	it("opens on the selected note and asks once", async () => {
		const { pane, asked, el } = rig();
		pane.open(sel, "words", false);
		await wait(20);
		expect(asked).toEqual([[sel, "words"]]);
		expect(el.querySelector(".jet-ex-tab.is-on")?.textContent).toBe("This note");
		expect(el.querySelector(".jet-ex-v1")?.textContent).toBe("Ranked 1 of 2 (Pilot).");
		expect(el.querySelectorAll(".jet-ex-pill.is-no")).toHaveLength(1);
	});

	it("opens on the search when no note is selected, and has no tab for a note then", async () => {
		const { pane, asked, el } = rig();
		pane.open(null, "words", false);
		await wait(20);
		expect(asked).toEqual([[null, "words"]]);
		expect([...el.querySelectorAll(".jet-ex-tab")].map((t) => t.textContent)).toEqual([
			"The search",
			"A note I expected",
		]);
		expect(el.querySelector(".jet-ex-v1")?.textContent).toMatch(/hold every word/);
		expect(el.querySelector(".jet-ex-chip")).toBeNull();
	});

	it("cycles the tabs, and asks for the search or the note as the tab needs", async () => {
		const { pane, asked, el } = rig();
		pane.open(sel, "words", false);
		await wait(20);
		pane.cycle(1);
		await wait(20);
		expect(el.querySelector(".jet-ex-tab.is-on")?.textContent).toBe("The search");
		expect(asked.at(-1)).toEqual([null, "words"]);
		pane.cycle(1);
		expect(el.querySelector(".jet-ex-tab.is-on")?.textContent).toBe("A note I expected");
		pane.cycle(1);
		expect(el.querySelector(".jet-ex-tab.is-on")?.textContent).toBe("This note");
		pane.cycle(-1);
		expect(el.querySelector(".jet-ex-tab.is-on")?.textContent).toBe("A note I expected");
	});

	it("follows the selection: a new row is explained once it rests", async () => {
		const { pane, asked } = rig();
		pane.open(sel, "words", false);
		await wait(20);
		pane.select({ path: "X.md", name: "X" });
		pane.select({ path: "Y.md", name: "Y" });
		await wait();
		expect(asked.map((a) => a[0]?.name)).toEqual(["Pilot", "Y"]);
	});

	it("drops an answer that comes after a newer question", async () => {
		let release: (e: Explained) => void = () => {};
		const slow = new Promise<Explained>((r) => (release = r));
		let n = 0;
		const { pane, el } = rig({ explain: () => (++n === 1 ? slow : Promise.resolve(explained("Newer."))) });
		pane.open(sel, "words", false);
		await wait(20);
		pane.select({ path: "Y.md", name: "Y" });
		await wait();
		release(explained("Older."));
		await wait(20);
		expect(el.querySelector(".jet-ex-v1")?.textContent).toBe("Newer.");
	});

	it("finds a note you expected: suggestions as you type, Enter takes one", async () => {
		const { pane, asked, el } = rig();
		pane.open(null, "words", false);
		await wait(20);
		pane.cycle(1);
		const input = el.querySelector<HTMLInputElement>(".jet-ex-in") as HTMLInputElement;
		input.value = "kio";
		input.dispatchEvent(new Event("input"));
		expect([...el.querySelectorAll(".jet-ex-oname")].map((o) => o.textContent)).toEqual(["Kiosk rollout", "Kiosk"]);
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		await wait(20);
		expect(asked.at(-1)?.[0]).toEqual({ path: "B/Kiosk.md", name: "Kiosk" });
		expect(el.querySelector(".jet-ex-v1")?.textContent).toBe("Ranked 1 of 2 (Kiosk).");
	});

	it("Esc clears a typed name first, then leaves the pane to the window", async () => {
		const { pane, el } = rig();
		pane.open(null, "words", false);
		await wait(20);
		pane.cycle(1);
		const input = el.querySelector<HTMLInputElement>(".jet-ex-in") as HTMLInputElement;
		input.value = "kio";
		input.dispatchEvent(new Event("input"));
		expect(pane.escape()).toBe(true);
		expect((el.querySelector(".jet-ex-in") as HTMLInputElement).value).toBe("");
		expect(pane.escape()).toBe(false);
	});

	it("adds the explanation to the report and shows it, from a button in its own bar", async () => {
		const { pane, kept, shown, el } = rig();
		pane.open(sel, "words", false);
		await wait(20);
		const btn = el.querySelector(".jet-ex-bar .jet-ex-add") as HTMLButtonElement;
		expect(btn.textContent).toBe("Report issue");
		expect(btn.getAttribute("aria-label")).toMatch(/Report issue/);
		btn.click();
		expect(kept).toHaveLength(1);
		expect(shown).toHaveLength(1);
		// Nothing greys out: it can be pressed again for another note.
		expect(btn.disabled).toBe(false);
		expect(el.querySelector(".jet-ex-body .jet-ex-add")).toBeNull();
	});

	it("has no bar until there is something to add", () => {
		const { pane, el } = rig({ explain: () => new Promise(() => undefined) });
		pane.open(sel, "words", false);
		expect(el.querySelector(".jet-ex-add")).toBeNull();
	});

	it("has a way back to the list that a touch screen can reach", () => {
		const { pane, backs, el } = rig();
		pane.open(sel, "words", false);
		(el.querySelector(".jet-ex-up") as HTMLElement).click();
		expect(backs).toHaveLength(1);
	});

	it("draws each word as a card with its figures under their labels", async () => {
		const table = {
			title: "How each word was read",
			head: ["Word", "Exact", "As a prefix", "Other forms", "Typos"],
			cards: true,
			rows: [
				[
					{ text: "kitchen" },
					{ text: "89 notes" },
					{ text: "not a prefix" },
					{ text: "3" },
					{ text: "not tried, found" },
				],
				[
					{ text: "tracker", note: "last word" },
					{ text: "12 notes" },
					{ text: "1" },
					{ text: "0" },
					{ text: "not tried, found" },
				],
			],
		};
		const { pane, el } = rig({
			explain: () => Promise.resolve({ ...explained(null), search: view("x", { tables: [table] }) }),
		});
		pane.open(null, "words", false);
		await wait(20);
		const cards = [...el.querySelectorAll(".jet-ex-wc")];
		expect(cards).toHaveLength(2);
		expect(cards[1]?.querySelector(".jet-ex-wn")?.textContent).toBe("tracker" + "last word");
		expect([...(cards[0]?.querySelectorAll(".jet-ex-fl") ?? [])].map((x) => x.textContent)).toEqual([
			"Exact",
			"As a prefix",
			"Other forms",
			"Typos",
		]);
		expect([...(cards[0]?.querySelectorAll(".jet-ex-fv") ?? [])].map((x) => x.textContent)).toEqual([
			"89 notes",
			"not a prefix",
			"3",
			"not tried, found",
		]);
	});

	it("says how the search was set, in plain lines under the answer, on every tab", async () => {
		const { pane, el } = rig();
		pane.open(sel, "words", false);
		await wait(20);
		const lines = () => [...el.querySelectorAll(".jet-ex-dl dt, .jet-ex-dl dd")].map((n) => n.textContent);
		expect(el.querySelector(".jet-ex-sl h4")?.textContent).toBe("How this search was set");
		expect(lines()).toEqual(["Searched", "by words", "Where", "in Cobalt"]);
		pane.cycle(1);
		await wait(20);
		expect(lines()).toEqual(["Searched", "by words", "Where", "in Cobalt"]);
	});

	it("says so when it cannot explain, and notes the problem", async () => {
		const { pane, el } = rig({ explain: () => Promise.reject(new Error("boom")) });
		pane.open(sel, "words", false);
		await wait(20);
		expect(el.querySelector(".jet-ex-hint")?.textContent).toMatch(/could not explain/);
	});

	it("offers words and meaning when both are shown, and asks again for the other", async () => {
		const { pane, asked, el } = rig();
		pane.open(sel, "words", true);
		await wait(20);
		const meaning = [...el.querySelectorAll<HTMLElement>(".jet-ex-mode")].find(
			(m) => m.textContent === "By meaning",
		);
		meaning?.click();
		await wait(20);
		expect(asked.at(-1)?.[1]).toBe("meaning");
	});

	it("asks for nothing until it is opened, and no more once closed", async () => {
		const { pane, asked } = rig();
		pane.select(sel);
		pane.refresh();
		await wait();
		expect(asked).toHaveLength(0);
		pane.open(sel, "words", false);
		pane.close();
		await wait();
		expect(asked.length).toBeLessThanOrEqual(1);
		void vi;
	});
});
