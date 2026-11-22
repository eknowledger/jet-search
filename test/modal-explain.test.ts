import { afterEach, describe, expect, it } from "vitest";
import { App, type Scope } from "obsidian";
import type { Explained } from "../src/explain/explainer";
import type { View } from "../src/explain/view";
import { type Entry, JetModal, type ModalHost } from "../src/modal/jet-modal";

const item = (path: string, over: Partial<Extract<Entry, { type: "item" }>> = {}): Entry => ({
	type: "item",
	path,
	title: path.replace(/\.md$/, ""),
	titleRanges: [],
	crumb: "",
	meta: "",
	icon: "file-text",
	...over,
});
const view = (head: string): View => ({ tone: "ok", head, detail: null, chips: ["By words"], tables: [], notes: [] });
const wait = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Asked = { text: string; mode: string; path: string | null; name: string; shown: string | null };
const rig = (entries: Entry[], over: Partial<ModalHost> = {}) => {
	const asked: Asked[] = [];
	const kept: Explained[] = [];
	const host: ModalHost = {
		placeholder: "Search notes…",
		list: (_t, paint) => paint(entries),
		open: () => {},
		hints: () => [["↵", "Open"]],
		closed: () => {},
		previewOn: () => true,
		setPreviewOn: () => {},
		explain: {
			run: (r) => {
				asked.push({ text: r.text, mode: r.mode, path: r.path, name: r.name, shown: r.shown });
				return Promise.resolve({
					search: view("2 notes hold every word."),
					note: r.path ? view(`Ranked 1 of 2 (${r.name}).`) : null,
					lines: () => ["line"],
				});
			},
			find: () => [],
			keep: (e) => kept.push(e),
		},
		...over,
	};
	return { host, asked, kept };
};
const press = (m: JetModal, key: string, mods: Parameters<Scope["register"]>[0] = []) =>
	(m.scope as unknown as { press(k: string, m: unknown[]): boolean }).press(key, mods);
const type = (m: JetModal, text: string) => {
	m.inputEl.value = text;
	m.inputEl.setSelectionRange(text.length, text.length);
	m.inputEl.dispatchEvent(new Event("input"));
};
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const hints = () => [...document.querySelectorAll(".jet-ft .jet-ht")].map((h) => h.textContent);
const open = (host: ModalHost): JetModal => {
	const m = new JetModal(new App() as never, host);
	m.open();
	return m;
};

afterEach(() => document.body.replaceChildren());

describe("explaining from the dialog", () => {
	it("shows the key in the footer once there is a search, and not before", () => {
		const { host } = rig([item("A.md")]);
		const m = open(host);
		expect(hints().join(" ")).not.toContain("Explain");
		type(m, "walnut");
		expect(hints().some((h) => h?.endsWith("Explain"))).toBe(true);
	});

	it("opens in the preview's place on the selected note, with the search as it ran", async () => {
		const { host, asked } = rig([
			{ type: "header", label: "In text", count: 2 },
			item("Pilot.md"),
			item("Other.md"),
		]);
		const m = open(host);
		type(m, "walnut kiosk");
		press(m, "e", ["Mod", "Shift"]);
		await wait();
		expect($(".jet-modal")?.classList.contains("is-explaining")).toBe(true);
		expect($(".jet-ex-tab.is-on")?.textContent).toBe("This note");
		expect(asked).toEqual([
			{ text: "walnut kiosk", mode: "words", path: "Pilot.md", name: "Pilot", shown: "In text" },
		]);
		expect($(".jet-ex-v1")?.textContent).toBe("Ranked 1 of 2 (Pilot).");
	});

	it("follows the selection with the arrows", async () => {
		const { host, asked } = rig([item("Pilot.md"), item("Other.md")]);
		const m = open(host);
		type(m, "walnut");
		press(m, "e", ["Mod", "Shift"]);
		await wait();
		press(m, "ArrowDown");
		await wait(200);
		expect(asked.map((a) => a.name)).toEqual(["Pilot", "Other"]);
	});

	it("⌘⇧E again, or Esc, goes back to the preview and the footer; Esc does not close the window", async () => {
		const { host } = rig([item("Pilot.md")]);
		const m = open(host);
		type(m, "walnut");
		press(m, "e", ["Mod", "Shift"]);
		await wait();
		expect(hints().join(" ")).toContain("Back to preview");
		press(m, "e", ["Mod", "Shift"]);
		expect($(".jet-modal")?.classList.contains("is-explaining")).toBe(false);
		press(m, "e", ["Mod", "Shift"]);
		press(m, "Escape");
		expect($(".jet-modal")?.classList.contains("is-explaining")).toBe(false);
		expect(m.inputEl.value).toBe("walnut");
	});

	it("Tab changes the tab while the pane is open", async () => {
		const { host } = rig([item("Pilot.md")]);
		const m = open(host);
		type(m, "walnut");
		press(m, "e", ["Mod", "Shift"]);
		await wait();
		press(m, "Tab");
		await wait();
		expect($(".jet-ex-tab.is-on")?.textContent).toBe("The search");
		press(m, "Tab", ["Shift"]);
		expect($(".jet-ex-tab.is-on")?.textContent).toBe("This note");
	});

	it("opens on the search when no note is listed, and asks for nothing when nothing is typed", async () => {
		const { host, asked } = rig([{ type: "notice", title: "No results for “zzz”" }]);
		const m = open(host);
		press(m, "e", ["Mod", "Shift"]);
		await wait();
		expect(asked).toHaveLength(0);
		expect($(".jet-modal")?.classList.contains("is-explaining")).toBe(false);
		type(m, "zzz");
		press(m, "e", ["Mod", "Shift"]);
		await wait();
		expect($(".jet-ex-tab.is-on")?.textContent).toBe("The search");
		expect(asked[0]?.path).toBeNull();
	});

	it("puts a quiet 'Why?' on the nothing-found screen, and it opens the explanation", async () => {
		const { host, asked } = rig([{ type: "notice", title: "No results for “zzz”" }]);
		const m = open(host);
		type(m, "zzz");
		const why = $(".jet-nwhy");
		expect(why?.textContent).toMatch(/^Why\?/);
		why?.click();
		await wait();
		expect(asked).toHaveLength(1);
	});

	it("explains a note picked from the ⌘K actions", async () => {
		const { host, asked } = rig([item("Pilot.md")], {
			actions: () => [{ id: "explain", label: "Explain this result", icon: "circle-help" }],
		});
		const m = open(host);
		type(m, "walnut");
		press(m, "k", ["Mod"]);
		const input = $(".jet-actq") as HTMLInputElement;
		input.dispatchEvent(new Event("input"));
		press(m, "Enter");
		await wait();
		expect($(".jet-modal")?.classList.contains("is-explaining")).toBe(true);
		expect(asked[0]?.path).toBe("Pilot.md");
	});

	it("leaves the arrows and Enter to the box that finds a note, so Enter does not open the selected row", async () => {
		const opened: string[] = [];
		const { host } = rig([item("Pilot.md")], { open: (p) => opened.push(p) });
		const m = open(host);
		type(m, "walnut");
		press(m, "e", ["Mod", "Shift"]);
		await wait();
		(document.querySelector(".jet-ex-tab:last-child") as HTMLElement).click();
		const box = $(".jet-ex-in") as HTMLElement;
		const pressIn = (k: string) =>
			(m.scope as unknown as { press(k: string, m: unknown[], t: unknown): boolean }).press(k, [], box);
		expect(pressIn("Enter")).toBe(false);
		expect(pressIn("ArrowDown")).toBe(false);
		expect(opened).toEqual([]);
		// In the search box, Enter still opens.
		press(m, "Enter");
		expect(opened).toEqual(["Pilot.md"]);
	});

	it("explains a search by meaning as meaning, and offers both when both are shown", async () => {
		const rows = [item("Words.md"), item("Near.md", { meaning: true })];
		const { host, asked } = rig(rows, {
			meaning: { available: () => true, questions: () => "both", long: () => false },
		});
		const m = open(host);
		type(m, "how do I water the walnut");
		press(m, "ArrowDown");
		press(m, "e", ["Mod", "Shift"]);
		await wait(40);
		expect(document.querySelectorAll(".jet-ex-mode")).toHaveLength(2);
		expect(asked.at(-1)?.mode).toMatch(/words|meaning/);
	});

	it("a host with no explanation has no key, no hint and no link", () => {
		const { host } = rig([{ type: "notice", title: "No results" }], { explain: undefined });
		const m = open(host);
		type(m, "zzz");
		expect(hints().join(" ")).not.toContain("Explain");
		expect($(".jet-nwhy")).toBeNull();
		press(m, "e", ["Mod", "Shift"]);
		expect($(".jet-ex")).toBeNull();
	});
});
