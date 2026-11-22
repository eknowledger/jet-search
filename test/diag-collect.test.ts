import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Notice, TFile } from "obsidian";
import { buttonNamed, goTo, tabOf } from "./settings-ui";
import JetSearchPlugin from "../src/main";
import { diag } from "../src/diag/diag";
import { recorder } from "../src/diag/recorder";
import { keepExplained } from "../src/explain/last";
import { collect } from "../src/diag/collect";
import { formatReport, NO_OPTIONS } from "../src/diag/report";

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
		recorder.reset();
		keepExplained(null);
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

	it("reads the recorded searches when the report is asked for, and wakes nothing to do it", async () => {
		const { plugin } = make();
		await plugin.onload();
		expect(collect(plugin).searches).toBeNull();
		recorder.add(1, 12, 2, 5, 20, 1, 8, 2, 6, 3);
		const m = collect(plugin).searches!;
		expect(m.kept).toBe(1);
		expect(m.max.total).toBe(20);
		expect(formatReport(collect(plugin))).toContain("1 search: median 20 ms");
		expect(workers).toBe(0);
	});

	it("adds the explanation the user kept, with tags unless the names are allowed", async () => {
		const { plugin } = make();
		await plugin.onload();
		expect(collect(plugin).explain).toBeNull();
		keepExplained({
			search: { tone: "ok", head: "", detail: null, tables: [], notes: [], setup: [] },
			note: null,
			lines: (names) => (names ? ['search "walnut kiosk"'] : ["the search", "word#1 word#2"]),
		});
		expect(collect(plugin).explain).toEqual(["the search", "word#1 word#2"]);
		const named = collect(plugin, Date.now(), { ...NO_OPTIONS, explainNames: true });
		expect(named.explain).toEqual(['search "walnut kiosk"']);
		keepExplained(null);
		expect(collect(plugin).explain).toBeNull();
	});

	it("has a command that opens the window with the report", async () => {
		const { plugin } = make();
		await plugin.onload();
		const cmd = plugin.commands.find((c) => c.id === "support-info");
		expect(cmd?.name).toBe("Copy support info");
		cmd?.callback?.();
		const modal = document.querySelector(".jet-support-modal");
		expect(modal).not.toBeNull();
		expect(modal?.querySelector(".jet-support-line")?.textContent).toMatch(/Jet Search: +0\.7\.1/);
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
		const shown = [...document.querySelectorAll(".jet-support-line")].map((l) => l.textContent).join("\n");
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
		expect(text).toMatch(/error save\.failed: RangeError/);
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
		expect(collect(plugin).appearance.missingVars).toHaveLength(6);
		document.body.style.setProperty("--text-muted", "#888");
		document.body.classList.add("theme-light");
		const look = collect(plugin).appearance;
		expect(look.theme).toBe("light");
		expect(look.missingVars).toHaveLength(5);
		expect(look.missingVars).not.toContain("--text-muted");
	});

	it("reads the theme, the snippets, the machine and the vault", async () => {
		const { app, plugin } = make();
		await plugin.onload();
		Object.assign(app, { customCss: { theme: "Minimal", enabledSnippets: new Set(["a", "b"]) } });
		Object.assign(app, { plugins: { plugins: {}, enabledPlugins: new Set(["zeta", "alpha"]) } });
		app.vault.files.set("a.md", new TFile("a.md"));
		app.vault.files.set("b.png", new TFile("b.png"));
		const snap = collect(plugin);
		expect(snap.appearance).toMatchObject({ name: "Minimal", snippets: 2 });
		expect(snap.vault).toMatchObject({ plugins: 2, pluginNames: null });
		expect(snap.vault.files).toBeGreaterThanOrEqual(snap.vault.notes);
		expect(snap.device.window.width).toBeGreaterThan(0);
		expect(snap.device.language).not.toBe("");
		expect(snap.obsidian.platform).toMatch(/desktop|phone|tablet|mobile/);
	});

	it("tells whether the worker runs and since when", async () => {
		const { plugin } = make();
		await plugin.onload();
		expect(collect(plugin).worker).toMatchObject({ running: false, since: null });
		diag.workerStarted();
		expect(collect(plugin).worker.since).not.toBeNull();
	});

	it("captures every setting that shapes a search", async () => {
		const { plugin } = make();
		await plugin.onload();
		const s = plugin.data.settings;
		s.questionShows = "meaning";
		s.answers = false;
		s.meaningLong = true;
		s.persistFilters = true;
		s.stemming = ["en", "fr"];
		const text = formatReport(collect(plugin));
		expect(text).toContain("questions by meaning");
		expect(text).toContain("answers off");
		expect(text).toContain("long searches by meaning on");
		expect(text).toContain("keep last scope and filters on");
		expect(text).toContain("stemming en, fr");
	});

	it("shows the window with a side panel and tick boxes, and no subtitle or Refresh button", async () => {
		const { plugin } = make();
		await plugin.onload();
		plugin.supportInfo();
		const modal = document.querySelector(".jet-support-modal");
		expect(modal?.querySelector(".jet-support-lead")).toBeNull();
		const buttons = [...(modal?.querySelectorAll("button") ?? [])].map((b) => b.textContent);
		expect(buttons).toEqual(["Record", "Copy as plain text", "Copy for GitHub"]);
		expect(modal?.querySelector(".jet-support-side")?.textContent).toContain("Add to the report");
		expect(modal?.querySelectorAll(".jet-support-side input[type=checkbox]")).toHaveLength(4);
		expect(modal?.querySelector(".jet-support-foot")?.textContent).toContain("Nothing leaves this device");
	});

	it("puts the sentence on what happened in its own card across the window, and the trace under the ticks", async () => {
		const { plugin } = make();
		await plugin.onload();
		plugin.supportInfo();
		const modal = document.querySelector(".jet-support-modal");
		const card = modal?.querySelector(".jet-support-what-card");
		expect(card?.textContent).toContain("What happened");
		expect(card?.querySelector("textarea")).not.toBeNull();
		expect(modal?.querySelector(".jet-support-side textarea")).toBeNull();
		expect(card?.nextElementSibling?.className).toContain("jet-support-body");
		const side = modal?.querySelector(".jet-support-side");
		expect(side?.lastElementChild?.className).toContain("jet-trace-box");
		expect(side?.querySelectorAll(":scope > .jet-support-tick")).toHaveLength(3);
		expect(side?.firstElementChild?.textContent).toBe("Add to the report");
	});

	it("says what was added, and marks the explanation's lines, when it is shown after adding one", async () => {
		const { plugin } = make();
		await plugin.onload();
		keepExplained({
			search: { tone: "ok", head: "h", detail: null, tables: [], notes: [], setup: [] },
			note: null,
			lines: () => ["search word#1, by words", "1 note holds it"],
		});
		plugin.supportInfo(true);
		const pre = document.querySelector(".jet-support-report");
		expect(document.querySelector(".jet-support-added")?.textContent).toMatch(/^Added/);
		const marked = [...(pre?.querySelectorAll(".jet-support-line.is-added") ?? [])].map((l) => l.textContent);
		expect(marked.join("\n")).toContain("1 note holds it");
		expect(marked).toHaveLength(2);
		document.body.replaceChildren();
		plugin.supportInfo();
		expect(document.querySelector(".jet-support-added")).toBeNull();
		expect(document.querySelector(".jet-support-line.is-added")).toBeNull();
	});

	it("colours the headings in the window and still copies plain text", async () => {
		const { plugin } = make();
		await plugin.onload();
		diag.problem("note.open", new Error("x"));
		plugin.supportInfo();
		const pre = document.querySelector(".jet-support-report");
		const keys = [...(pre?.querySelectorAll(".jet-support-key") ?? [])].map((k) => k.textContent?.trim());
		expect(keys).toContain("Worker:");
		expect(keys).toContain("Index:");
		expect([...(pre?.querySelectorAll(".jet-support-warn") ?? [])].map((w) => w.textContent).join("\n")).toContain(
			"note.open",
		);
		const drawn = [...(pre?.querySelectorAll(".jet-support-line") ?? [])].map((l) => l.textContent).join("\n");
		expect(drawn).toBe(formatReport(collect(plugin)));
	});

	it("adds scope and plugin names only after their box is ticked, and takes them out again", async () => {
		const { app, plugin } = make();
		await plugin.onload();
		Object.assign(app, { plugins: { plugins: {}, enabledPlugins: new Set(["secret-sauce"]) } });
		plugin.data.scopes.push({
			id: "s1",
			name: "Nebula Payroll",
			aliases: [],
			kind: "",
			rules: [],
			combine: "any",
			mode: "both",
			source: "manual",
		} as never);
		plugin.supportInfo();
		const text = () => [...document.querySelectorAll(".jet-support-line")].map((l) => l.textContent).join("\n");
		expect(text()).not.toContain("secret-sauce");
		expect(text()).not.toContain("Nebula Payroll");
		const [scopes, plugins] = [
			...document.querySelectorAll<HTMLInputElement>(".jet-support-side input[type=checkbox]"),
		];
		scopes!.checked = true;
		scopes!.dispatchEvent(new Event("change"));
		expect(text()).toContain("Nebula Payroll");
		expect(text()).not.toContain("secret-sauce");
		plugins!.checked = true;
		plugins!.dispatchEvent(new Event("change"));
		expect(text()).toContain("secret-sauce");
		scopes!.checked = false;
		scopes!.dispatchEvent(new Event("change"));
		expect(text()).not.toContain("Nebula Payroll");
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
		Object.assign(app, { plugins: { plugins: {}, enabledPlugins: new Set(["q3-secret-plan-plugin"]) } });
		secrets.push("q3-secret-plan-plugin");
		const everything = formatReport(collect(plugin)) + JSON.stringify(collect(plugin));
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

	it("fills in the index's size and age when a running worker answers, without waking a sleeping one", async () => {
		const { plugin } = make();
		await plugin.onload();
		const calls: string[] = [];
		Object.defineProperty(plugin.client, "running", { get: () => true });
		plugin.client.call = ((req: { op: string }) => {
			calls.push(req.op);
			return Promise.resolve({
				notes: 7,
				segments: 2,
				pending: 0,
				savedAt: Date.now() - 60_000,
				bytes: 2_000_000,
			});
		}) as never;
		plugin.supportInfo();
		await new Promise((r) => setTimeout(r, 0));
		const text = [...document.querySelectorAll(".jet-support-line")].map((l) => l.textContent).join("\n");
		expect(calls).toEqual(["stats"]);
		expect(text).toContain("7 of");
		expect(text).toContain("2.0 MB, 2 segments, saved 1 min ago");
	});
});
