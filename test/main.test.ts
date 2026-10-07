import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Notice } from "obsidian";
import JetSearchPlugin from "../src/main";

const manifest = { id: "jet-search", name: "Jet Search", version: "0.0.1" };

type Mocked = JetSearchPlugin & {
	commands: { id: string; name: string; callback?: () => unknown }[];
	settingTabs: { containerEl: HTMLElement; display: () => void }[];
	pendingCleanups: () => number;
	unload: () => void;
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
	});

	it("registers one command to open search", async () => {
		const { plugin } = make();
		await plugin.onload();
		expect(plugin.commands.map((c) => c.id)).toEqual(["open"]);
		expect(plugin.commands[0]?.name).toBe("Search notes");
	});

	it("registers one settings tab", async () => {
		const { plugin } = make();
		await plugin.onload();
		expect(plugin.settingTabs).toHaveLength(1);
	});

	it("reads no files, starts no worker and listens to nothing at start", async () => {
		const { app, plugin } = make();
		await plugin.onload();
		expect(app.vault.calls).toEqual([]);
		expect(app.vault.listenerCount()).toBe(0);
		expect(app.workspace.layoutReadyCallbacks).toHaveLength(0);
		expect(workers).toBe(0);
		expect(plugin.pendingCleanups()).toBe(0);
	});

	it("says the search is not built yet when the command runs", async () => {
		const { plugin } = make();
		await plugin.onload();
		Notice.shown.length = 0;
		plugin.commands[0]?.callback?.();
		expect(Notice.shown).toEqual(["Search is not built yet."]);
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

	it("draws once per display, not twice", async () => {
		const { plugin } = make();
		await plugin.onload();
		const tab = plugin.settingTabs[0];
		tab?.display();
		tab?.display();
		expect(tab?.containerEl.querySelectorAll(".setting-item")).toHaveLength(1);
	});
});
