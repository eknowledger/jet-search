/**
 * Fixes for several scopes, the keys and the drawn settings, each the
 * case that went wrong.
 */
import { afterEach, describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";
import JetSearchPlugin from "../src/main";
import { normalizeData } from "../src/data";
import { keyMap, refusal, setMac, comboLabel } from "../src/keys/keymap";
import type { Scope } from "../src/scopes/model";
import { Search } from "../src/search";
import { drawScopeEditor } from "../src/settings/scope-editor";
import type { ScopesHost } from "../src/settings/scopes-page";
import { goTo, tabOf } from "./settings-ui";

afterEach(() => {
	setMac(true);
	document.body.replaceChildren();
});

const loaded = async () => {
	const app = new App();
	(app.vault as unknown as { files: Map<string, TFile> }).files.set("A/One.md", new TFile("A/One.md"));
	const plugin = new JetSearchPlugin(app as never, { id: "jet-search", name: "Jet", version: "0.0.1" } as never);
	await plugin.onload();
	return { plugin, tab: tabOf(plugin) };
};

describe("keys in settings", () => {
	it("↺ does not put a default back onto a key another action has taken since", async () => {
		const { plugin, tab } = await loaded();
		tab.display();
		tab.setControlValue("key:actions", { mods: ["Mod"], key: "p" });
		tab.setControlValue("key:copyLink", { mods: ["Mod"], key: "k" });
		expect(plugin.data.settings.keys.copyLink).toEqual({ mods: ["Mod"], key: "k" });
		tab.setControlValue("key:actions", null);
		expect(plugin.data.settings.keys.actions).toEqual({ mods: ["Mod"], key: "p" });
		expect(tab.containerEl.querySelector(".jet-set-keymsg")?.textContent).toContain("Copy a link");
	});

	it("a key waiting for its press is let go when you change tab or search the settings", async () => {
		const { plugin, tab } = await loaded();
		goTo(tab, "open").querySelector<HTMLElement>('tr[data-action="open"] .jet-set-kbd')?.click();
		tab.containerEl.querySelector<HTMLElement>('.jet-set-tab[data-page="results"]')?.click();
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "c", code: "KeyC", metaKey: true }));
		expect(plugin.data.settings.keys.open).toBeUndefined();
		goTo(tab, "open").querySelector<HTMLElement>('tr[data-action="open"] .jet-set-kbd')?.click();
		const box = tab.containerEl.querySelector<HTMLInputElement>("input.jet-set-search");
		if (box) {
			box.value = "x";
			box.dispatchEvent(new Event("input"));
		}
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "c", code: "KeyC", metaKey: true }));
		expect(plugin.data.settings.keys.open).toBeUndefined();
	});

	it("↵ and ⇥ alone stay with Open and Accept (they also run the lists in the window)", () => {
		const m = keyMap({ open: { mods: ["Mod"], key: "o" } });
		expect(refusal(m, "create", { mods: [], key: "Enter" })).toContain("↵ alone");
		expect(refusal(m, "open", { mods: [], key: "Enter" })).toBeNull();
		expect(refusal(m, "filters", { mods: [], key: "Tab" })).toContain("⇥ alone");
	});

	it("off macOS, Ctrl is Mod: Ctrl+N is refused (kept for moving down), and shown once", () => {
		setMac(false);
		const m = keyMap();
		expect(refusal(m, "filters", { mods: ["Mod"], key: "n" })).toContain("kept for");
		expect(refusal(m, "filters", { mods: ["Ctrl"], key: "f" })).toBeNull();
		expect(comboLabel({ mods: ["Mod", "Ctrl"], key: "k" })).toBe("Ctrl+K");
	});

	it("search by meaning's progress redraws the tab only on its own page, keeping your typing in the search box", async () => {
		const { tab } = await loaded();
		document.body.appendChild(tab.containerEl);
		tab.display();
		const box = tab.containerEl.querySelector<HTMLInputElement>("input.jet-set-search");
		if (!box) throw new Error("no search box");
		box.focus();
		box.value = "dou";
		box.dispatchEvent(new Event("input"));
		box.setSelectionRange(3, 3);
		tab.progressChanged();
		expect(tab.containerEl.querySelector("input.jet-set-search")).toBe(box);
		tab.refresh();
		const again = tab.containerEl.querySelector<HTMLInputElement>("input.jet-set-search");
		expect(document.activeElement).toBe(again);
		expect(again?.value).toBe("dou");
		expect(again?.selectionStart).toBe(3);
	});
});

describe("several scopes handed to Obsidian Search", () => {
	it("writes them ORed; when one has no syntax there, writes none and names them all", () => {
		const app = new App();
		const describe = (id: string) =>
			id === "b" ? { name: "B", create: "" } : { name: id.toUpperCase(), create: "", query: `path:"${id}"` };
		const s = new Search(app as never, {} as never, {} as never, () => normalizeData(null), {
			ensure: () => {},
			membersOf: () => new Set(),
			describe,
		});
		const row = (scope: string[]) =>
			(
				s as unknown as { coreRow(c: { text: string; scope: string[] }): { query: string; detail: string } }
			).coreRow({
				text: "plan",
				scope,
			});
		expect(row(["a", "c"]).query).toBe('((path:"a") OR (path:"c")) plan');
		const mixed = row(["a", "b"]);
		expect(mixed.query).toBe("plan");
		expect(mixed.detail).toContain("without A, B");
	});
});

describe("the scope editor", () => {
	it("says what “When typed” means once the name's mentions are counted, without redrawing the rest", async () => {
		let measured: { value: number; outside: number } | null = null;
		const s: Scope = {
			id: "g",
			name: "Garden",
			aliases: [],
			kind: "",
			rules: [],
			combine: "any",
			mode: "default",
			source: "manual",
		};
		const h = {
			app: new App(),
			scopes: () => [s],
			save: () => {},
			count: () => 1,
			ruleCount: () => 1,
			mentions: () => measured,
			changed: () => {},
			generate: () => {},
			canOpenPages: () => false,
			newCount: () => 0,
			everyMode: () => "suggest",
		} as unknown as ScopesHost;
		const el = document.body.createDiv();
		drawScopeEditor(el, h, s, () => {});
		const name = el.querySelector("input");
		expect(el.textContent).toContain("Checking how often");
		measured = { value: 0.2, outside: 3 };
		await new Promise((r) => setTimeout(r, 450));
		expect(el.textContent).toContain("is rare outside it");
		expect(el.querySelector("input")).toBe(name);
	});
});
