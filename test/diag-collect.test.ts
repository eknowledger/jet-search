import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Notice, TFile } from "obsidian";
import { buttonNamed, goTo, tabOf } from "./settings-ui";
import JetSearchPlugin from "../src/main";
import { diag } from "../src/diag/diag";
import { collect } from "../src/diag/collect";
import { formatReport } from "../src/diag/report";

const manifest = { id: "jet-search", name: "Jet Search", version: "0.7.1" };

type Mocked = JetSearchPlugin & { commands: { id: string; name: string; callback?: () => unknown }[] };

const make = (): { app: App; plugin: Mocked } => {
	const app = new App();
	const plugin = new JetSearchPlugin(app as never, manifest as never) as Mocked;
	return { app, plugin };
};

describe("the support info", () => {
	let workers = 0;

	beforeEach(() => {
		diag.reset();
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
		document.body.className = "";
	});

	it("has a command that opens the window with the report", async () => {
		const { plugin } = make();
		await plugin.onload();
		const cmd = plugin.commands.find((c) => c.id === "support-info");
		expect(cmd?.name).toBe("Copy support info");
		cmd?.callback?.();
		const modal = document.querySelector(".jet-support-modal");
		expect(modal).not.toBeNull();
		expect(modal?.querySelector(".jet-support-report")?.textContent).toContain("Jet Search 0.7.1");
	});

	it("opens from the Support card on the Advanced page", async () => {
		const { plugin } = make();
		await plugin.onload();
		const el = goTo(tabOf(plugin), "advanced");
		buttonNamed(el, "Preview and copy")?.click();
		expect(document.querySelector(".jet-support-modal")).not.toBeNull();
	});

	it("copies exactly what the window shows, and the GitHub copy adds the sentence", async () => {
		const { plugin } = make();
		await plugin.onload();
		const written: string[] = [];
		vi.stubGlobal("navigator", { clipboard: { writeText: (t: string) => (written.push(t), Promise.resolve()) } });
		plugin.supportInfo();
		const shown = document.querySelector(".jet-support-report")?.textContent ?? "";
		const buttons = [...document.querySelectorAll<HTMLButtonElement>(".jet-support-modal button")];
		const named = (t: string) => buttons.find((b) => b.textContent === t);
		named("Copy as plain text")?.click();
		await Promise.resolve();
		expect(written[0]).toBe(shown);
		const what = document.querySelector<HTMLTextAreaElement>(".jet-support-what");
		if (what) what.value = "Double Shift does nothing";
		named("Copy for GitHub")?.click();
		await Promise.resolve();
		expect(written[1]).toContain("**What happened**\nDouble Shift does nothing");
		expect(written[1]).toContain(shown);
		expect(Notice.shown).toContain("Support info copied");
	});

	it("selects the text and says so when the clipboard is not allowed", async () => {
		const { plugin } = make();
		await plugin.onload();
		vi.stubGlobal("navigator", { clipboard: { writeText: () => Promise.reject(new Error("denied")) } });
		plugin.supportInfo();
		const copy = [...document.querySelectorAll<HTMLButtonElement>(".jet-support-modal button")].find(
			(b) => b.textContent === "Copy as plain text",
		);
		copy?.click();
		await new Promise((r) => setTimeout(r, 0));
		expect(Notice.shown.at(-1)).toContain("could not copy by itself");
	});

	it("says what the worker and the errors did since Obsidian started", async () => {
		const { plugin } = make();
		await plugin.onload();
		diag.workerStarted();
		diag.workerStarted();
		diag.workerCrashed();
		diag.slept();
		diag.problem("save.failed", new RangeError("x"));
		const text = formatReport(collect(plugin));
		expect(text).toContain("started 2x, crashed 1x, slept 1x");
		expect(text).toContain("save.failed: RangeError");
	});

	it("tells who handles the double tap, as the double tap itself decides", async () => {
		const { app, plugin } = make();
		await plugin.onload();
		expect(collect(plugin).open.tapOwner).toBeNull();
		Object.assign(app, { plugins: { plugins: {}, enabledPlugins: new Set(["obsidian-doubleshift"]) } });
		expect(collect(plugin).open.tapOwner).toBe("obsidian-doubleshift");
		plugin.data.settings.tapKey = "off";
		expect(collect(plugin).open.tapOwner).toBeNull();
	});

	it("lists the Obsidian internals that are missing", async () => {
		const { app, plugin } = make();
		await plugin.onload();
		expect(collect(plugin).internals.missing).toContain("setting.openPage");
		Object.assign(app, { setting: { openPage() {}, closePage() {}, open() {}, openTabById() {} } });
		const after = collect(plugin).internals;
		expect(after.missing).not.toContain("setting.openPage");
		expect(after.found + after.missing.length).toBe(after.of);
	});

	it("reads the theme variables, and names the ones a theme leaves out", async () => {
		const { plugin } = make();
		await plugin.onload();
		expect(collect(plugin).screen.vars.missing).toHaveLength(6);
		document.body.style.setProperty("--text-muted", "#888");
		document.body.classList.add("theme-light");
		const screen = collect(plugin).screen;
		expect(screen.theme).toBe("light");
		expect(screen.vars.set).toBe(1);
		expect(screen.vars.missing).not.toContain("--text-muted");
	});

	it("never wakes the worker and never reads a note", async () => {
		const { app, plugin } = make();
		await plugin.onload();
		app.vault.files.set("a.md", new TFile("a.md"));
		const calls = app.vault.calls.length;
		formatReport(collect(plugin));
		plugin.supportInfo();
		expect(workers).toBe(0);
		expect(app.vault.calls.slice(calls).filter((c) => c === "read" || c === "cachedRead")).toEqual([]);
	});

	it("names no note, folder or scope, and no text from an error", async () => {
		const { app, plugin } = make();
		await plugin.onload();
		// Invented, but shaped like private names.
		const secrets = ["Acme Merger", "Salary Review", "Nebula Payroll", "Quarterly Layoffs", "q3-secret-plan"];
		app.vault.files.set("Acme Merger/Salary Review.md", new TFile("Acme Merger/Salary Review.md"));
		app.vault.folders.add("Acme Merger");
		plugin.data.settings.exclude = ["Acme Merger", "Quarterly Layoffs"];
		plugin.data.scopes.push({
			id: "s1",
			name: "Nebula Payroll",
			aliases: ["q3-secret-plan"],
			kind: "",
			rules: [],
			combine: "any",
			mode: "both",
			source: "manual",
		} as never);
		diag.problem("search.words", new Error("ENOENT: Acme Merger/Salary Review.md q3-secret-plan"));
		diag.problem("note.open", "Nebula Payroll/Quarterly Layoffs.md");
		const snap = collect(plugin);
		const everything = formatReport(snap) + JSON.stringify(snap);
		for (const s of secrets) expect(everything).not.toContain(s);
		// What it does say: counts.
		expect(snap.settings.excludeRules).toBe(2);
		expect(snap.scopes.count).toBe(1);
	});

	it("counts only the commands Jet still holds for other plugins, not ones another plugin took over", async () => {
		const app = new App();
		Object.assign(app.workspace, { on: () => ({ off: () => {} }) });
		Object.assign(app.metadataCache, { on: () => ({ off: () => {} }) });
		const commands: Record<string, { id: string; name: string }> = {};
		Object.assign(app, {
			commands: {
				commands,
				addCommand: (c: { id: string; name: string }) => (commands[c.id] = c),
				removeCommand: (id: string) => delete commands[id],
			},
			plugins: { plugins: {}, enabledPlugins: new Set<string>() },
		});
		const plugin = new JetSearchPlugin(app as never, manifest as never);
		Object.assign(plugin, { loadData: async () => ({ indexedAt: 1 }), saveData: async () => {} });
		await plugin.onload();
		for (const cb of app.workspace.layoutReadyCallbacks.splice(0)) cb();
		await new Promise((r) => setTimeout(r, 5));
		expect(collect(plugin).open.standIns).toBe(2);
		// Another plugin registers the same ids after Jet did (it loaded later): they are no longer Jet's.
		commands["omnisearch:show-modal"] = { id: "omnisearch:show-modal", name: "Omnisearch: Vault search" };
		expect(collect(plugin).open.standIns).toBe(1);
		delete commands["omnisearch:show-modal-infile"];
		expect(collect(plugin).open.standIns).toBe(0);
		plugin.unload();
	});
});
