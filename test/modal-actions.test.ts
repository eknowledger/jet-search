import { afterEach, describe, expect, it } from "vitest";
import { App, type Scope } from "obsidian";
import { type Entry, JetModal, type ModalHost, type NoteAction } from "../src/modal/jet-modal";

const ACTIONS: NoteAction[] = [
	{ id: "open", label: "Open", icon: "file", key: "↵", group: 0 },
	{ id: "copy-link", label: "Copy wikilink", icon: "link", key: "⌘L", group: 1 },
	{ id: "reveal", label: "Reveal in file explorer", icon: "folder-open", group: 2 },
	{ id: "backlinks", label: "Show backlinks", icon: "links-coming-in", detail: "14", group: 2 },
];

const fakeHost = () => {
	const ran: Array<[string, string]> = [];
	const host: ModalHost = {
		placeholder: "",
		list: (_t, paint) =>
			paint([
				{
					type: "item",
					path: "Plan.md",
					title: "Plan",
					titleRanges: [],
					crumb: "",
					meta: "",
					icon: "file-text",
				} as Entry,
			]),
		open: () => {},
		hints: () => [],
		closed: () => {},
		previewOn: () => false,
		setPreviewOn: () => {},
		copyLink: () => {},
		insertLink: () => {},
		create: () => {},
		actions: () => ACTIONS,
		act: (id, path) => {
			ran.push([id, path]);
			return id !== "copy-link";
		},
	};
	return { host, ran };
};
const press = (m: JetModal, key: string, mods: Parameters<Scope["register"]>[0] = []) =>
	(m.scope as unknown as { press(k: string, m: unknown[]): boolean }).press(key, mods);
const labels = () => [...document.querySelectorAll(".jet-act .jet-actr .jet-actn")].map((r) => r.textContent);

describe("the ⌘K action panel", () => {
	afterEach(() => document.body.replaceChildren());

	it("lists the selected note's actions with their keys; typing narrows; ↓ ↵ runs one", () => {
		const { host, ran } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		expect(press(m, "k", ["Mod"])).toBe(true);
		expect(document.querySelector(".jet-acth")?.textContent).toBe("Actions for Plan");
		expect(labels()).toEqual(["Open", "Copy wikilink", "Reveal in file explorer", "Show backlinks"]);
		expect(document.querySelectorAll(".jet-actsep").length).toBe(2);
		const q = document.querySelector<HTMLInputElement>(".jet-actq");
		if (!q) throw new Error("no input");
		q.value = "re";
		q.dispatchEvent(new Event("input"));
		expect(labels()).toEqual(["Reveal in file explorer"]);
		press(m, "Enter");
		expect(ran).toEqual([["reveal", "Plan.md"]]);
		expect(m.isOpen).toBe(false);
	});

	it("an action that keeps Jet open; Esc goes back to the results", () => {
		const { host, ran } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		press(m, "k", ["Mod"]);
		press(m, "ArrowDown");
		press(m, "Enter");
		expect(ran).toEqual([["copy-link", "Plan.md"]]);
		expect(m.isOpen).toBe(true);
		expect(document.querySelector(".jet-act")).toBeNull();
		press(m, "k", ["Mod"]);
		press(m, "Escape");
		expect(document.querySelector(".jet-act")).toBeNull();
		expect(m.isOpen).toBe(true);
	});
});
