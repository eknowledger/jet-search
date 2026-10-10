/**
 * QA (saved data, migrations, settings pages, robustness against bad input). Each test here fails on
 * the code as it is.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, TFile } from "obsidian";
import JetSearchPlugin from "../src/main";
import { frecency, normalizeData } from "../src/data";
import { Feeder } from "../src/index/feeder";
import { clearIndex } from "../src/index-status";
import { JetModal, type ModalHost } from "../src/modal/jet-modal";
import { normalizeScopes, withModes, type Scope } from "../src/scopes/model";
import type { JetSettingTab } from "../src/settings-tab";
import { addScopeDialog, editScope, goTo, saveDialog, tabOf, typeInto } from "./settings-ui";
import { Router } from "../src/worker/router";
import { memoryStore } from "../src/worker/store";
import type { JetClient } from "../src/worker/jet-client";

const flush = async (n = 20): Promise<void> => {
	for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

/** A plugin with `files` notes and the given raw data.json, loaded. */
const make = async (raw: unknown = null, files: string[] = ["Projects/Garden/Plan.md"]) => {
	const app = new App();
	const map = (app.vault as unknown as { files: Map<string, TFile> }).files;
	for (const p of files) map.set(p, new TFile(p));
	const plugin = new JetSearchPlugin(app as never, { id: "jet-search", name: "Jet", version: "0.0.1" } as never);
	// The mock's loadData returns the plugin's own `data` field: data.json as Obsidian would read it.
	(plugin as unknown as { data: unknown }).data = raw;
	await plugin.onload();
	const tab = tabOf(plugin);
	return { app, plugin, tab, calls: (app.vault as unknown as { calls: string[] }).calls };
};

/** A scope renamed in its Edit dialog, and saved. */
const rename = (tab: JetSettingTab, from: string, to: string): void => {
	const d = editScope(tab, from) as HTMLElement;
	typeInto(d, "Name", to);
	saveDialog(d);
};

/** "Add scope", named in its dialog, saved. */
const addNamed = (tab: JetSettingTab, name?: string): void => {
	const d = addScopeDialog(tab) as HTMLElement;
	if (name) typeInto(d, "Name", name);
	saveDialog(d);
};

const folderScope = (name: string, mode: Scope["mode"] = "default"): Record<string, unknown> => ({
	name,
	rules: [{ kind: "folder", path: name }],
	mode,
});

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.replaceChildren();
});

describe("scopes edited in settings reach typing (withModes cache)", () => {
	it("a scope renamed on its settings page is found by its new name in the modal", async () => {
		const { plugin, tab } = await make({
			settings: { scopeMode: "suggest" },
			scopes: [folderScope("Alpha")],
		});
		const host = (plugin as unknown as { host: { scopes: NonNullable<ModalHost["scopes"]> } }).host;
		// The modal was used once (the resolved list is cached)…
		expect(host.scopes.typed("@Alpha ").applied?.scope.name).toBe("Alpha");
		// …then the scope is renamed in settings.
		rename(tab, "Alpha", "Beta");
		expect(plugin.data.scopes[0]?.name).toBe("Beta");
		expect(host.scopes.typed("@Beta ").applied?.scope.name).toBe("Beta");
	});

	it("deleting one scope and adding another (same count, same modes) does not keep the deleted one", () => {
		const scopes = normalizeScopes([folderScope("Alpha"), folderScope("Gamma")]);
		expect(withModes(scopes, "suggest").map((s) => s.name)).toEqual(["Alpha", "Gamma"]);
		// The Scopes page edits the live list in place: Delete splices, Add scope pushes.
		scopes.splice(0, 1);
		scopes.push(...normalizeScopes([folderScope("Delta")]));
		expect(withModes(scopes, "suggest").map((s) => s.name)).toEqual(["Gamma", "Delta"]);
	});
});

describe("scopes added by hand get unique ids", () => {
	it("add a scope, rename it, add another: the two have different ids", async () => {
		const { plugin, tab } = await make();
		addNamed(tab, "Work");
		addNamed(tab);
		expect(plugin.data.scopes.map((s) => s.name)).toEqual(["Work", "New scope"]);
		const [a, b] = plugin.data.scopes;
		expect(a?.id).not.toBe(b?.id);
	});

	it("the second scope's own 'When typed' dropdown changes that scope, not the first", async () => {
		const { plugin, tab } = await make();
		addNamed(tab, "Work");
		addNamed(tab);
		const second = plugin.data.scopes[1] as Scope;
		tab.setControlValue(`scope:${second.id}:mode`, "auto");
		expect(plugin.data.scopes.map((s) => s.mode)).toEqual(["default", "auto"]);
	});
});

describe("persisted filters from data.json cannot break the modal", () => {
	const host = (restore: ReturnType<NonNullable<ModalHost["restore"]>>): ModalHost => ({
		placeholder: "Search notes…",
		list: (_t, paint) => paint([]),
		open: () => {},
		hints: () => [],
		closed: () => {},
		previewOn: () => false,
		setPreviewOn: () => {},
		copyLink: () => {},
		insertLink: () => {},
		create: () => {},
		restore: () => restore,
	});

	it("a kept filter of a kind this version does not know is dropped at load, and the modal opens", () => {
		const d = normalizeData({
			settings: { persistFilters: true },
			last: {
				filters: [
					{ kind: "mood", value: "calm" },
					{ kind: "edited", days: 7 },
				],
			},
		});
		const m = new JetModal(new App() as never, host({ filters: d.last?.filters ?? [] }));
		expect(() => m.open()).not.toThrow();
		expect(d.last?.filters).toEqual([{ kind: "edited", days: 7 }]);
	});

	it("a kept filter missing its fields ({kind: 'tag'} with no tag) is dropped at load", () => {
		const d = normalizeData({
			settings: { persistFilters: true },
			last: { filters: [{ kind: "tag" }, { kind: "path" }, { kind: "edited", days: "7" }] },
		});
		expect(d.last?.filters).toEqual([]);
	});
});

describe("the settings tab with many scopes", () => {
	const many = (n: number) =>
		Array.from({ length: n }, (_, i) => ({ id: `s${i}`, ...folderScope(`Scope ${i}`) })) as unknown[];

	it("one draw of the tab does not walk the whole vault once per rule of every scope", async () => {
		const { plugin, tab, calls } = await make({
			settings: { scopeMode: "suggest" },
			scopes: many(200),
		});
		plugin.measure = () => Promise.resolve(); // counted in the next test
		document.body.appendChild(tab.containerEl); // the tab is on screen
		calls.length = 0;
		goTo(tab, "scopes");
		// 200 scopes · 1 rule: once for the header's note count, once for the members, not once per rule.
		expect(calls.filter((c) => c === "getMarkdownFiles").length).toBeLessThanOrEqual(3);
	});

	it("opening the Scopes tab measures no name and draws the tab a few times at most", async () => {
		const { plugin, tab } = await make({ settings: { scopeMode: "suggest" }, scopes: many(200) });
		document.body.appendChild(tab.containerEl);
		plugin.feeder.ensure = () => Promise.resolve();
		const ops: string[] = [];
		(plugin.client as unknown as { call: (r: { op: string }) => Promise<unknown> }).call = (r) => {
			ops.push(r.op);
			return Promise.resolve(r.op === "mentions" ? { notes: 3, inside: 1 } : { notes: 0 });
		};
		const display = tab.display.bind(tab);
		let draws = 0;
		tab.display = () => {
			draws++;
			display();
		};
		goTo(tab, "scopes");
		await flush(50);
		expect(ops.filter((o) => o === "mentions")).toEqual([]);
		expect(draws).toBeLessThanOrEqual(5);
	});
});

describe("a bad meaning model file never takes the word index down", () => {
	it("the index still opens and builds when the saved model cannot be read", async () => {
		const app = new App();
		const router = new Router(() => memoryStore(), { set: () => 0, clear: () => {} });
		const client = {
			running: true,
			call: (req: Parameters<Router["handle"]>[0]) => router.handle(req),
		} as unknown as JetClient;
		const feeder = new Feeder(app as never, client, "v", () => []);
		// data.json says a model is installed; the file is from an older pack format (or truncated).
		feeder.meaningModel = () => Promise.resolve(new ArrayBuffer(32));
		await expect(feeder.ensure()).resolves.toBeUndefined();
		expect(feeder.live).toBe(true);
	});
});

describe("Clear the index while it builds", () => {
	it("after Clear, the worker stays stopped and the index is 'not built'", async () => {
		let workers = 0;
		vi.stubGlobal(
			"Worker",
			class {
				onmessage: ((e: { data: unknown }) => void) | null = null;
				onerror: unknown = null;
				private dead = false;
				private readonly router = new Router(() => memoryStore(), { set: () => 0, clear: () => {} });
				constructor() {
					workers++;
				}
				postMessage(msg: { id: number; req: Parameters<Router["handle"]>[0] }): void {
					void this.router.handle(msg.req).then(
						(result) => !this.dead && this.onmessage?.({ data: { id: msg.id, result } }),
						(e: unknown) => !this.dead && this.onmessage?.({ data: { id: msg.id, error: String(e) } }),
					);
				}
				terminate(): void {
					this.dead = true;
				}
			},
		);
		const files = Array.from({ length: 250 }, (_, i) => `Notes/n${i}.md`);
		const { app, plugin } = await make(null, files);
		let reads = 0;
		let cleared: Promise<void> | null = null;
		// You press Clear while the build reads the second batch's notes.
		(app.vault as unknown as { cachedRead: (f: TFile) => Promise<string> }).cachedRead = async () => {
			reads++;
			if (reads === 101) {
				cleared = clearIndex(plugin);
				await cleared;
			}
			return "text";
		};
		const building = plugin.feeder.ensure().catch(() => {});
		await building;
		await cleared;
		await flush();
		expect(workers).toBe(1);
		expect(plugin.client.running).toBe(false);
		expect(plugin.data.indexedAt).toBeNull();
		expect(plugin.feeder.progress).toBeNull();
	});
});

describe("settings controls given unexpected values", () => {
	it("the double tap window never becomes NaN", async () => {
		const { plugin, tab } = await make();
		tab.setControlValue("shiftInterval", "fast");
		expect(Number.isFinite(plugin.data.settings.shiftInterval)).toBe(true);
	});
});

describe("frecency from a bad 'opened' entry", () => {
	it("a negative score or a time in the future gives a finite, bounded boost", () => {
		const now = Date.UTC(2026, 9, 9);
		const d = normalizeData({ opened: { "neg.md": [-5, now], "future.md": [1, now + 3650 * 86_400_000] } });
		expect(Number.isNaN(frecency(d, "neg.md", now))).toBe(false);
		// One open, however its time was saved, is never worth more than ~100 opens today.
		expect(frecency(d, "future.md", now)).toBeLessThan(1 + 0.15 * Math.log2(101));
	});
});

describe("saved data for several scopes", () => {
	it("keeps the scopes added beside the first, drops them without a first, and reads the Add/Switch setting", () => {
		const d = normalizeData({
			last: { scope: "a", also: ["b", 3, "c"], filters: [] },
			settings: { scopeAnother: "switch" },
		});
		expect(d.last).toEqual({ scope: "a", also: ["b", "c"], filters: [] });
		expect(d.settings.scopeAnother).toBe("switch");
		expect(normalizeData({ last: { also: ["b"], filters: [] } }).last).toEqual({ scope: undefined, filters: [] });
		expect(normalizeData({ settings: { scopeAnother: "both" } }).settings.scopeAnother).toBe("add");
	});
});
