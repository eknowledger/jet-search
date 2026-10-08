import { afterEach, describe, expect, it } from "vitest";
import { App, type Scope } from "obsidian";
import { findFix, pieceAt, wantOf } from "../src/filters/complete";
import { findFilters } from "../src/filters/filter";
import { type Completion, type Entry, JetModal, type ModalHost } from "../src/modal/jet-modal";

const known = (k: string) => ["status", "type"].includes(k.toLowerCase());
const VALUES: Array<[string, number]> = [
	["draft", 5],
	["in-progress", 3],
	["done", 1],
];

const fakeHost = () => {
	const lists: Array<[string, string[]]> = [];
	const host: ModalHost = {
		placeholder: "Search notes…",
		list: (text, paint, _scope, filters = []) => {
			lists.push([text, filters.map((f) => (f.kind === "prop" ? `${f.key}=${f.value}` : f.kind))]);
			paint([{ type: "notice", title: `No results for “${text}”` }]);
		},
		open: () => {},
		hints: () => [["↵", "Open"]],
		closed: () => {},
		previewOn: () => false,
		setPreviewOn: () => {},
		copyLink: () => {},
		insertLink: () => {},
		create: () => {},
		filters: {
			find: (t) => findFilters(t, known),
			values: () => VALUES,
			tags: () => [],
			keys: () => [
				["status", 173],
				["type", 530],
			],
			scopes: () => [],
			complete: (text, caret): Completion | null => {
				const { from, to, piece } = pieceAt(text, caret);
				const w = wantOf(piece, known);
				if (w?.kind !== "values") return null;
				const items = VALUES.filter(([v]) => v.startsWith(w.prefix)).map(([v, n]) => ({
					label: v,
					count: n,
					insert: `status:${v} `,
				}));
				return items.length ? { from, to, title: "status", items, set: 9, total: 52 } : null;
			},
			fix: (text) => {
				const f = findFix(text, [["status", 173]], known);
				return f ? { ...f, notes: 173 } : null;
			},
			preview: () => [
				{
					type: "item",
					path: "fixed.md",
					title: "fixed",
					titleRanges: [],
					crumb: "",
					meta: "",
					icon: "file-text",
					dim: true,
				},
			],
		},
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
const acRows = () =>
	[...document.querySelectorAll(".jet-ac .jet-acr")].map((r) => r.querySelector(".jet-acl")?.textContent);
const chips = () => [...document.querySelectorAll(".jet-fchip")].map((c) => c.textContent);

describe("autocomplete and fix-it", () => {
	afterEach(() => document.body.replaceChildren());

	it("typing a key and a colon lists its values with counts; ↓ and ⇥ pick one into a chip", () => {
		const { host, lists } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "status:");
		expect(acRows()).toEqual(["draft", "in-progress", "done"]);
		expect($(".jet-ac .jet-ach")?.textContent).toContain("9 of 52 set");
		type(m, "status:d");
		expect(acRows()).toEqual(["draft", "done"]);
		expect(press(m, "ArrowDown")).toBe(true);
		expect($(".jet-acr.is-selected .jet-acl")?.textContent).toBe("done");
		expect(press(m, "Tab")).toBe(true);
		expect(chips()).toEqual(["statusdone"]);
		expect(m.inputEl.value).toBe("");
		expect($(".jet-ac")).toBeNull();
		expect(lists.at(-1)).toEqual(["", ["status=done"]]);
	});

	it("Esc closes the list and keeps the text; ↵ picks too", () => {
		const { host } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "status:");
		press(m, "Escape");
		expect($(".jet-ac")).toBeNull();
		expect(m.inputEl.value).toBe("status:");
		type(m, "status:dr");
		expect(acRows()).toEqual(["draft"]);
		press(m, "Enter");
		expect(chips()).toEqual(["statusdraft"]);
	});

	it("an unknown key near a used one: underline, the banner offers the fix, the fixed results show dimmed; ⇥ fixes", () => {
		const { host, lists } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		type(m, "stauts:draft");
		expect($(".jet-ban")?.textContent).toContain("Did you mean status:? · on 173 notes");
		expect($(".jet-ghostbox.is-fix")?.hasClass("is-hidden")).toBe(false);
		expect(
			$(".jet-h .jet-hl")?.textContent ??
				[...document.querySelectorAll(".jet-h")].map((h) => h.textContent).join("|"),
		).toContain("With the fix — status: draft");
		expect(document.querySelector(".jet-row.is-dim")).not.toBeNull();
		press(m, "Tab");
		expect(chips()).toEqual(["statusdraft"]);
		expect(lists.at(-1)).toEqual(["", ["status=draft"]]);
	});
});

export type { Entry };
