/**
 * Fixes for several scopes, the keys and the drawn settings, each the
 * case that went wrong.
 */
import { afterEach, describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";
import JetSearchPlugin from "../src/main";
import { normalizeData } from "../src/data";
import { clashes, comboLabel, keyMap, refusal, setMac } from "../src/keys/keymap";
import { JetModal, type ModalHost } from "../src/modal/jet-modal";
import type { JetHost } from "../src/host";
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

describe("copy keys and key tooltips", () => {
	const item = {
		type: "item" as const,
		path: "A/One.md",
		title: "One",
		titleRanges: [],
		crumb: "",
		meta: "",
		icon: "file-text",
	};

	it("the copy keys: ⌘C a link, ⌘⇧C the URL, ⌘⌃C the path on disk (Ctrl+Alt+C off macOS)", () => {
		const m = keyMap();
		expect([m.copyLink, m.copyUrl, m.copyPath].map(comboLabel)).toEqual(["⌘C", "⌘⇧C", "⌘⌃C"]);
		expect(clashes(m)).toEqual([]);
		setMac(false);
		expect(comboLabel(keyMap().copyPath)).toBe("Ctrl+Alt+C");
		expect(clashes(keyMap())).toEqual([]);
	});

	it("a key saved before it became another action's default is shown as a clash, and not as changed", async () => {
		const { plugin, tab } = await loaded();
		plugin.data.settings.keys = {
			preview: { mods: ["Mod", "Shift"], key: "c" },
			copyLink: { mods: ["Mod"], key: "c" },
		};
		const el = goTo(tab, "open");
		expect(el.querySelector(".jet-set-keymsg")?.textContent).toContain("⌘⇧C is on two actions");
		expect(el.querySelector('tr[data-action="copyLink"] .jet-set-kbd.is-changed')).toBeNull();
	});

	it("⌘C copies a link to the note, but text you selected in the box is copied as usual", async () => {
		const copied: string[] = [];
		const host: ModalHost = {
			placeholder: "",
			list: (_t, paint) => paint([{ type: "header", label: "Results", count: 1 }, item]),
			open: () => {},
			hints: () => [],
			closed: () => {},
			previewOn: () => false,
			setPreviewOn: () => {},
			copyLink: (p) => copied.push(p),
		};
		const m = new JetModal(new App() as never, host);
		m.open();
		const press = (k: string, mods: string[]) =>
			(m.scope as unknown as { press(k: string, m: unknown[]): boolean }).press(k, mods);
		m.inputEl.value = "one two";
		m.inputEl.dispatchEvent(new Event("input"));
		m.inputEl.setSelectionRange(0, 3);
		expect(press("c", ["Mod"])).toBe(false);
		expect(copied).toEqual([]);
		m.inputEl.setSelectionRange(7, 7);
		expect(press("c", ["Mod"])).toBe(true);
		expect(copied).toEqual(["A/One.md"]);
	});

	it("⌘⌃C copies the note's full path on disk; the ⌘K panel lists it with its key", async () => {
		const { plugin } = await loaded();
		(plugin.app.vault as unknown as { adapter: unknown }).adapter = {
			getFullPath: (p: string) => `/Vaults/demo/${p}`,
		};
		const written: string[] = [];
		const clip = navigator.clipboard;
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: (t: string) => (written.push(t), Promise.resolve()) },
		});
		try {
			const host = (plugin as unknown as { host: JetHost }).host;
			expect(host.actions("A/One.md").find((a) => a.id === "copy-path")).toMatchObject({
				label: "Copy file path",
				key: "⌘⌃C",
			});
			host.act("copy-path", "A/One.md");
			expect(written).toEqual(["/Vaults/demo/A/One.md"]);
		} finally {
			Object.defineProperty(navigator, "clipboard", { configurable: true, value: clip });
		}
	});

	it("tooltips follow your keys: words or meaning, sort, filters, the preview's buttons", () => {
		const keys = keyMap({
			meaning: { mods: ["Mod"], key: "m" },
			sort: { mods: ["Mod", "Shift"], key: "o" },
			filters: { mods: ["Mod", "Alt"], key: "f" },
		});
		const host: ModalHost = {
			placeholder: "",
			list: (_t, paint) =>
				paint([
					{ type: "header", label: "Results", count: 2, mode: "words", sort: "Best match" },
					item,
					{ ...item, path: "B.md" },
				]),
			open: () => {},
			hints: () => [],
			closed: () => {},
			previewOn: () => true,
			setPreviewOn: () => {},
			keys: () => ({ map: keys, tap: "⇧⇧" }),
			filters: {
				find: () => [],
				values: () => [],
				tags: () => [],
				keys: () => [],
				scopes: () => [],
				complete: () => null,
				fix: () => null,
				preview: () => [],
			},
		};
		const m = new JetModal(new App() as never, host);
		m.open();
		m.inputEl.value = "x";
		m.inputEl.dispatchEvent(new Event("input"));
		const label = (sel: string) => document.querySelector(sel)?.getAttribute("aria-label");
		expect(label(".jet-h .jet-mode")).toBe("Switch between words and meaning (⌘M)");
		expect(label(".jet-h .jet-sort")).toBe("Sort (⌘⇧O)");
		expect(label(".jet-fbtn")).toBe("Filters (⌘⌥F)");
		expect([...document.querySelectorAll(".jet-pb")].map((b) => b.getAttribute("aria-label"))).toEqual([
			"Copy link (⌘C)",
			"Open to the side (⌘⌥↵)",
			"Open (↵)",
		]);
	});
});
