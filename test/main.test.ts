import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { buttonNamed, goTo, rowNamed, tabOf, textsOf } from "./settings-ui";
import JetSearchPlugin from "../src/main";

const manifest = { id: "jet-search", name: "Jet Search", version: "0.0.1" };

type Mocked = JetSearchPlugin & {
	commands: { id: string; name: string; callback?: () => unknown }[];
	settingTabs: { containerEl: HTMLElement; display: () => void }[];
};

const make = (): { app: App; plugin: Mocked } => {
	const app = new App();
	const plugin = new JetSearchPlugin(app as never, manifest as never) as Mocked;
	return { app, plugin };
};

describe("plugin start", () => {
	let workers = 0;

	beforeEach(() => {
		workers = 0;
		vi.stubGlobal(
			"Worker",
			class {
				constructor() {
					workers++;
				}
			},
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		document.body.replaceChildren();
	});

	it("registers the two search commands", async () => {
		const { plugin } = make();
		await plugin.onload();
		expect(plugin.commands.map((c) => c.id)).toEqual(["open", "open-in-note"]);
		expect(plugin.commands[0]?.name).toBe("Search notes");
	});

	it("registers one settings tab", async () => {
		const { plugin } = make();
		await plugin.onload();
		expect(plugin.settingTabs).toHaveLength(1);
	});

	it("reads no files, starts no worker and waits for the layout before listening", async () => {
		const { app, plugin } = make();
		await plugin.onload();
		expect(app.vault.calls).toEqual([]);
		expect(app.vault.listenerCount()).toBe(0);
		expect(app.workspace.layoutReadyCallbacks).toHaveLength(1);
		expect(workers).toBe(0);
	});

	it("tells Jade it is on at start and off at unload, so Jade's search steps aside and back", async () => {
		const { app, plugin } = make();
		await plugin.onload();
		expect(app.workspace.triggered).toEqual(["jet-search:on"]);
		plugin.onunload();
		expect(app.workspace.triggered).toEqual(["jet-search:on", "jet-search:off"]);
	});

	it("opens the search modal from the command", async () => {
		const { plugin } = make();
		await plugin.onload();
		plugin.commands[0]?.callback?.();
		expect(document.querySelector(".jet-modal .jet-q")).not.toBeNull();
	});
});

describe("settings tab", () => {
	afterEach(() => document.body.replaceChildren());
	const loaded = async () => {
		const { plugin } = make();
		await plugin.onload();
		return { plugin, tab: tabOf(plugin) };
	};

	it("is Jade's layout: a header with live numbers, a search box, six tabs, cards", async () => {
		const { tab } = await loaded();
		tab.display();
		const el = tab.containerEl;
		expect(el.querySelector(".jet-set-h")?.textContent).toBe("Jet Search");
		expect(textsOf(el, ".jet-set-chip")).toEqual(["Index not built yet", "0 scopes"]);
		expect(el.querySelector("input.jet-set-search")).not.toBeNull();
		expect(textsOf(el, ".jet-set-tab")).toEqual([
			"Open & keys",
			"Results",
			"Scopes",
			"Search by meaning",
			"Index",
			"Advanced",
		]);
		expect(textsOf(el, ".jet-set-name")).toEqual(["Open Jet", "Keys in Jet"]);
		expect(rowNamed(el, "Double tap")).not.toBeNull();
		expect(textsOf(goTo(tab, "results"), ".jet-set-name")).toEqual([
			"Excerpts",
			"Preview",
			"Keep the last scope and filters",
			"Filters",
		]);
		// Off by default: only its switch.
		const meaning = goTo(tab, "meaning");
		expect(textsOf(meaning, ".jet-set-name")).toEqual(["Search by meaning"]);
		expect(meaning.querySelector(".jet-set-opts")).toBeNull();
		expect(textsOf(goTo(tab, "advanced"), ".jet-set-name")).toEqual([
			"Word forms",
			"Folders to leave out",
			"Version",
		]);
	});

	it("shows the version and the build", async () => {
		const { tab } = await loaded();
		const text = goTo(tab, "advanced").textContent ?? "";
		expect(text).toContain("Version");
		expect(text).toContain("0.0.1");
		expect(text).toContain("dev");
	});

	it("draws the index status at once and never changes the tab afterwards", async () => {
		// Obsidian 1.13+ redraws a settings tab whose text changes; a late update looped forever.
		const { tab } = await loaded();
		const el = goTo(tab, "index");
		const before = el.textContent ?? "";
		expect(before).toContain("Not built yet");
		expect(buttonNamed(el, "Rebuild")).not.toBeNull();
		expect(buttonNamed(el, "Clear")).not.toBeNull();
		await new Promise((r) => setTimeout(r, 20));
		expect(el.textContent).toBe(before);
	});

	it("reads and writes Jet's own settings through the control keys", async () => {
		const { tab, plugin } = await loaded();
		tab.setControlValue("shiftInterval", "500");
		expect(plugin.data.settings.shiftInterval).toBe(500);
		expect(tab.getControlValue("shiftInterval")).toBe("500");
		tab.setControlValue("stem:fr", true);
		expect(tab.getControlValue("stem:fr")).toBe(true);
		tab.setControlValue("stem:fr", false);
		expect(plugin.data.settings.stemming).not.toContain("fr");
		tab.setControlValue("exclude", "Archive/\n\n  Templates ");
		expect(plugin.data.settings.exclude).toEqual(["Archive", "Templates"]);
		expect(tab.getControlValue("exclude")).toBe("Archive\nTemplates");
	});

	it("a switch and a dropdown write their setting; the double tap off hides its window", async () => {
		const { tab, plugin } = await loaded();
		const el = goTo(tab, "results");
		el.querySelector<HTMLElement>('.checkbox-container[data-key="excerpts"]')?.click();
		expect(plugin.data.settings.excerpts).toBe(false);
		const open = goTo(tab, "open");
		expect(rowNamed(open, "Double tap window")).not.toBeNull();
		const sel = open.querySelector<HTMLSelectElement>('select[data-key="tapKey"]');
		if (sel) {
			sel.value = "off";
			sel.dispatchEvent(new Event("change"));
		}
		expect(plugin.data.settings.tapKey).toBe("off");
		expect(rowNamed(tab.containerEl, "Double tap window")).toBeNull();
	});

	it("its search box finds a setting on any tab, keeping only the rows that match", async () => {
		const { tab } = await loaded();
		tab.display();
		const box = tab.containerEl.querySelector<HTMLInputElement>("input.jet-set-search");
		if (!box) throw new Error("no search box");
		box.value = "window";
		box.dispatchEvent(new Event("input"));
		const el = tab.containerEl;
		expect(el.querySelector(".jet-set-tab.is-active")).toBeNull();
		expect(textsOf(el, ".jet-set-name")).toContain("Open Jet");
		expect(rowNamed(el, "Double tap window")).not.toBeNull();
		expect(rowNamed(el, "Hotkey")).toBeNull();
		box.value = "zzqx";
		box.dispatchEvent(new Event("input"));
		expect(el.querySelector(".jet-set-lead")?.textContent).toBe("Nothing matches.");
	});
});

describe("the keys in the window, in settings", () => {
	afterEach(() => document.body.replaceChildren());
	const key = (k: string, code: string, mods: Partial<KeyboardEventInit> = {}) =>
		window.dispatchEvent(new KeyboardEvent("keydown", { key: k, code, bubbles: true, ...mods }));

	it("click a key, press another: saved, marked, with ↺ to its default; a taken key is refused, naming why", async () => {
		const { plugin } = make();
		await plugin.onload();
		const tab = tabOf(plugin);
		const cell = () =>
			goTo(tab, "open").querySelector<HTMLElement>('tr[data-action="copyLink"] .jet-set-kbd') as HTMLElement;
		goTo(tab, "open");
		expect(cell().textContent).toBe("⌘L");
		cell().click();
		expect(tab.containerEl.querySelector('tr[data-action="copyLink"] .jet-set-rec')).not.toBeNull();
		key("c", "KeyC", { metaKey: true });
		expect(plugin.data.settings.keys.copyLink).toEqual({ mods: ["Mod"], key: "c" });
		expect(tab.containerEl.querySelector('tr[data-action="copyLink"] .jet-set-kbd.is-changed')?.textContent).toBe(
			"⌘C",
		);
		// Another action's key is refused, and the tab says which.
		tab.containerEl.querySelector<HTMLElement>('tr[data-action="preview"] .jet-set-kbd')?.click();
		key("k", "KeyK", { metaKey: true });
		expect(plugin.data.settings.keys.preview).toBeUndefined();
		expect(tab.containerEl.querySelector(".jet-set-keymsg")?.textContent).toContain("The note's actions");
		// Esc while recording leaves the key as it was.
		tab.containerEl.querySelector<HTMLElement>('tr[data-action="preview"] .jet-set-kbd')?.click();
		key("Escape", "Escape");
		expect(plugin.data.settings.keys.preview).toBeUndefined();
		tab.containerEl.querySelector<HTMLElement>('tr[data-action="copyLink"] .jet-set-reset')?.click();
		expect(plugin.data.settings.keys.copyLink).toBeUndefined();
		expect(tab.getControlValue("key:copyLink")).toBe("⌘L");
		tab.setControlValue("key:sort", { mods: ["Mod"], key: "o" });
		buttonNamed(tab.containerEl, "Reset all")?.click();
		expect(plugin.data.settings.keys).toEqual({});
	});
});
