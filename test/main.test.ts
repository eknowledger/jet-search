import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
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
});
