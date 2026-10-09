import { afterEach, describe, expect, it } from "vitest";
import { App, type Scope } from "obsidian";
import { type Entry, JetModal, type ModalHost, type ScopeView } from "../src/modal/jet-modal";

const COBALT: ScopeView = { id: "cobalt", name: "Cobalt", kind: "Projects", members: 34 };
const OKR: ScopeView = { id: "okr", name: "OKR", kind: "Areas", members: 92 };

const fakeHost = (restore: ReturnType<NonNullable<ModalHost["restore"]>> = null) => {
	const lists: Array<[string, string | undefined, number]> = [];
	const host: ModalHost = {
		placeholder: "Search notes…",
		list: (text, paint, scope, filters = []) => {
			lists.push([text, scope, filters.length]);
			paint(
				text || scope || filters.length
					? [{ type: "header", label: "Results", count: 0 }]
					: [
							{
								type: "scopes",
								label: "Search in",
								chips: [{ scope: COBALT, here: true }, { scope: OKR }],
								more: 3,
							},
							{ type: "header", label: "Recent searches" },
							{
								type: "search",
								query: "in:Cobalt status:draft world",
								parts: [{ chip: ["", "Cobalt"] }, { chip: ["status", "draft"] }, { text: "world" }],
							},
						],
			);
		},
		open: () => {},
		hints: () => [],
		closed: () => {},
		previewOn: () => false,
		setPreviewOn: () => {},
		copyLink: () => {},
		insertLink: () => {},
		create: () => {},
		restore: () => restore,
		scopes: {
			typed: () => ({}),
			card: () => ({ name: "", kind: "", mode: "", rules: [], total: 0, aliases: [] }),
			edit: () => {},
		},
	};
	return { host, lists };
};
const press = (m: JetModal, key: string, mods: Parameters<Scope["register"]>[0] = []) =>
	(m.scope as unknown as { press(k: string, m: unknown[]): boolean }).press(key, mods);
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);

describe("the empty state with scopes; persisted filters", () => {
	afterEach(() => document.body.replaceChildren());

	it("lists scopes as chips, the open note's first with ⇥; Tab or a click applies one", () => {
		const { host, lists } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		expect([...document.querySelectorAll(".jet-schip")].map((c) => c.textContent)).toEqual([
			"Cobalt34⇥",
			"OKR92",
			"All 5 ▾",
		]);
		expect(press(m, "Tab")).toBe(true);
		expect(lists.at(-1)).toEqual(["", "cobalt", 0]);
		m.close();
		const n = new JetModal(new App() as never, host);
		n.open();
		[...document.querySelectorAll<HTMLElement>(".jet-schip")]
			.find((c) => c.textContent?.startsWith("OKR"))
			?.click();
		expect(lists.at(-1)).toEqual(["", "okr", 0]);
	});

	it("a recent search shows its scope and filters as chips", () => {
		const { host } = fakeHost();
		const m = new JetModal(new App() as never, host);
		m.open();
		const row = document.querySelector(".jet-row-search");
		expect([...(row?.querySelectorAll(".jet-mchip") ?? [])].map((c) => c.textContent)).toEqual([
			"Cobalt",
			"statusdraft",
		]);
		expect(row?.textContent).toContain("world");
	});

	it("restores the last scope and filters, pinned, until you change them", () => {
		const { host, lists } = fakeHost({ scope: COBALT, filters: [{ kind: "edited", days: 7 }] });
		const m = new JetModal(new App() as never, host);
		m.open();
		expect(lists.at(-1)).toEqual(["", "cobalt", 1]);
		expect($(".jet-chip")?.hasClass("is-pinned")).toBe(true);
		expect($(".jet-fchip")?.hasClass("is-pinned")).toBe(true);
		press(m, "Escape");
		expect($(".jet-fchip")).toBeNull();
	});
});

export type { Entry };
