import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Setting } from "obsidian";
import type { JetSettingTab } from "../src/settings-tab";
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

	it("opens the search modal from the command", async () => {
		const { plugin } = make();
		await plugin.onload();
		plugin.commands[0]?.callback?.();
		expect(document.querySelector(".jet-modal .jet-q")).not.toBeNull();
	});
});

describe("settings tab", () => {
	it("shows the version and the build", async () => {
		const { plugin } = make();
		await plugin.onload();
		const tab = plugin.settingTabs[0];
		tab?.display();
		const text = tab?.containerEl.textContent ?? "";
		expect(text).toContain("Version");
		expect(text).toContain("0.0.1");
		expect(text).toContain("dev");
	});

	it("draws the index status at once and never changes the tab afterwards", async () => {
		// Obsidian 1.13+ redraws a settings tab whose text changes; a late update looped forever.
		const { plugin } = make();
		await plugin.onload();
		const tab = plugin.settingTabs[0];
		tab?.display();
		const before = tab?.containerEl.textContent ?? "";
		expect(before).toContain("Not built yet");
		await new Promise((r) => setTimeout(r, 20));
		expect(tab?.containerEl.textContent).toBe(before);
	});

	type Def = { type?: string; heading?: string; name?: string; items?: Def[]; render?: (s: Setting) => void };
	const defsOf = async (): Promise<{ tab: JetSettingTab; defs: Def[]; plugin: Mocked }> => {
		const { plugin } = make();
		await plugin.onload();
		const tab = plugin.settingTabs[0] as unknown as JetSettingTab;
		return { tab, defs: tab.getSettingDefinitions() as unknown as Def[], plugin };
	};
	const flat = (defs: Def[]): Def[] => defs.flatMap((d) => (d.type === "group" ? (d.items ?? []) : [d]));

	it("declares every setting, so Obsidian 1.13+ draws them and finds them in its settings search", async () => {
		const { defs } = await defsOf();
		expect(defs.filter((d) => d.type === "group").map((d) => d.heading)).toEqual([
			"Open",
			undefined,
			"Results",
			"Word forms",
			"Index",
		]);
		const names = flat(defs).map((d) => d.name);
		expect(names).toContain("Open with a double tap of ⇧");
		expect(flat(defs).some((d) => d.name === "Folders to leave out" && d.type === "page")).toBe(true);
		expect(names).toContain("English");
		expect(names.at(-1)).toBe("Version");
	});

	it("reads and writes Jet's own settings through the control keys", async () => {
		const { tab, plugin } = await defsOf();
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

	it("draws the declared index row at once and never changes it afterwards", async () => {
		const { defs } = await defsOf();
		const row = flat(defs).find((d) => d.name === "Index");
		const el = document.createElement("div");
		row?.render?.(new Setting(el));
		const before = el.textContent ?? "";
		expect(before).toContain("Not built yet");
		expect(before).toContain("Rebuild");
		await new Promise((r) => setTimeout(r, 20));
		expect(el.textContent).toBe(before);
	});
});
