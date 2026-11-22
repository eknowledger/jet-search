import "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Explained } from "../src/explain/explainer";
import type { View } from "../src/explain/view";
import { type Candidate, ExplainPane, type PaneIo, type Pick } from "../src/modal/explain-pane";

const view = (head: string, over: Partial<View> = {}): View => ({
	tone: "ok",
	head,
	detail: null,
	chips: [],
	tables: [],
	notes: [],
	...over,
});
const explained = (note: string | null): Explained => ({
	search: view("2 notes hold every word, so only those are listed.", { chips: ["By words", "Everywhere"] }),
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
		...over,
	};
	const parent = document.createElement("div");
	document.body.append(parent);
	const pane = new ExplainPane(parent, io, { toggle: "⌘⇧E" });
	return { pane, asked, kept, el: pane.el };
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
		expect([...el.querySelectorAll(".jet-ex-chip")].map((c) => c.textContent)).toEqual(["By words", "Everywhere"]);
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

	it("keeps the explanation for the support info, once", async () => {
		const { pane, kept, el } = rig();
		pane.open(sel, "words", false);
		await wait(20);
		(el.querySelector(".jet-ex-add") as HTMLButtonElement).click();
		expect(kept).toHaveLength(1);
		expect((el.querySelector(".jet-ex-add") as HTMLButtonElement).textContent).toBe("Added to the support info");
		expect((el.querySelector(".jet-ex-add") as HTMLButtonElement).disabled).toBe(true);
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
