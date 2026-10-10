import { afterEach, describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";
import JetSearchPlugin from "../src/main";
import type { Scope } from "../src/scopes/model";
import {
	addScopeDialog,
	buttonNamed,
	editScope,
	goTo,
	rowNamed,
	saveDialog,
	tabOf,
	textsOf,
	typeInto,
} from "./settings-ui";
import { whenTyped } from "../src/settings/scopes-page";

const make = async (scopes: Partial<Scope>[] = []) => {
	const app = new App();
	const files = (app.vault as unknown as { files: Map<string, TFile> }).files;
	files.set("Projects/Garden/Plan.md", new TFile("Projects/Garden/Plan.md"));
	const plugin = new JetSearchPlugin(app as never, { id: "jet-search", name: "Jet", version: "0.0.1" } as never);
	await plugin.onload();
	plugin.data.scopes = scopes.map((s, i) => ({
		id: `s${i}`,
		name: `Scope ${i}`,
		aliases: [],
		kind: "",
		rules: [{ kind: "folder", path: "Projects/Garden" }],
		combine: "any",
		mode: "suggest",
		source: "manual",
		...s,
	})) as Scope[];
	const tab = tabOf(plugin);
	return { app, plugin, tab, calls: (app.vault as unknown as { calls: string[] }).calls };
};

describe("the Scopes tab in settings", () => {
	afterEach(() => document.body.replaceChildren());

	it("says how many scopes there are, in the header and above the list", async () => {
		const { tab } = await make([{ mode: "auto" }, {}]);
		const el = goTo(tab, "scopes");
		expect(textsOf(el, ".jet-set-chip")).toContain("2 scopes");
		expect(el.querySelector(".jet-set-count")?.textContent).toBe("2 scopes");
		const empty = goTo((await make()).tab, "scopes");
		expect(empty.querySelector(".jet-set-count")?.textContent).toBe("No scopes yet");
	});

	it("offers Generate first; once scopes were generated, finding new ones; the three choices under it", async () => {
		const first = goTo((await make()).tab, "scopes");
		expect(buttonNamed(first, "Generate…")?.classList.contains("mod-cta")).toBe(true);
		expect(textsOf(first.querySelector(".jet-set-opts") as HTMLElement, ".setting-item-name")).toEqual([
			"When typed, for every scope",
			"Another scope while one is on",
			"When new ones appear",
		]);
		const later = goTo((await make([{ source: "generated" }])).tab, "scopes");
		expect(buttonNamed(later, "Find new scopes")).not.toBeNull();
	});

	it("lists each scope with its kind and mode, and Edit", async () => {
		const { tab } = await make([
			{ name: "Garden", kind: "Projects", mode: "in-only" },
			{ name: "Home", mode: "default" },
		]);
		const el = goTo(tab, "scopes");
		const rows = [...el.querySelectorAll(".jet-set-scope")];
		expect(rows.map((r) => r.querySelector("b")?.textContent)).toEqual(["Garden", "Home"]);
		expect(rows.map((r) => r.querySelector(".jet-set-m")?.textContent)).toEqual([
			"in: only",
			"Suggest · every scope",
		]);
		expect(rows[0]?.querySelector(".jet-set-k")?.textContent).toBe("Projects");
		expect(rows.every((r) => r.querySelector("button")?.textContent === "Edit")).toBe(true);
	});

	it("adds a scope by hand in its dialog; a rule removed and Save change the scope; Cancel leaves it", async () => {
		const { tab, plugin } = await make([{ name: "Garden" }]);
		const add = addScopeDialog(tab);
		expect(plugin.data.scopes.map((s) => s.name)).toEqual(["Garden", "New scope"]);
		expect(add?.querySelector(".modal-title")?.textContent).toBe("Edit scope · New scope");
		buttonNamed(add as HTMLElement, "Cancel")?.click();
		const garden = editScope(tab, "Garden") as HTMLElement;
		expect(rowNamed(garden, "folder Projects/Garden")).not.toBeNull();
		rowNamed(garden, "folder Projects/Garden")?.querySelector("button")?.click();
		// Not yet: the dialog edits a copy.
		expect(plugin.data.scopes[0]?.rules.length).toBe(1);
		typeInto(garden, "Name", "Allotment");
		saveDialog(garden);
		expect(plugin.data.scopes[0]?.rules).toEqual([]);
		expect(plugin.data.scopes[0]?.name).toBe("Allotment");
		const again = editScope(tab, "Allotment") as HTMLElement;
		typeInto(again, "Name", "Never");
		buttonNamed(again, "Cancel")?.click();
		expect(plugin.data.scopes[0]?.name).toBe("Allotment");
		const del = editScope(tab, "Allotment") as HTMLElement;
		buttonNamed(del, "Delete scope")?.click();
		expect(plugin.data.scopes.map((s) => s.name)).toEqual(["New scope"]);
	});

	it("reads and writes a scope's mode and combine through the control keys", async () => {
		const { tab, plugin } = await make([{ name: "Garden" }]);
		tab.setControlValue("scope:s0:mode", "auto");
		tab.setControlValue("scope:s0:combine", "all");
		expect(plugin.data.scopes[0]?.mode).toBe("auto");
		expect(tab.getControlValue("scope:s0:combine")).toBe("all");
		tab.setControlValue("scopesWhenNew", "add");
		expect(plugin.data.settings.scopesWhenNew).toBe("add");
	});

	it("draws nothing until you open it, and counts no scope's notes while it is off screen", async () => {
		const { tab, calls } = await make([{ name: "Garden" }]);
		// Loaded: the tab has read nothing (it draws only when Obsidian shows it).
		expect(calls).toEqual([]);
		const el = goTo(tab, "scopes");
		// Not on screen (detached): the rows have no counts, so no members pass ran.
		expect(el.querySelector(".jet-set-scope .jet-set-n")?.textContent).toBe("");
	});
});

describe("folders to leave out, under Advanced", () => {
	afterEach(() => document.body.replaceChildren());

	it("lists the folders, each with × to search it again", async () => {
		const { tab, plugin } = await make();
		plugin.data.settings.exclude = ["Archive", "Templates"];
		const el = goTo(tab, "advanced");
		expect(rowNamed(el, "Archive")).not.toBeNull();
		rowNamed(el, "Archive")?.querySelector("button")?.click();
		expect(plugin.data.settings.exclude).toEqual(["Templates"]);
		expect(rowNamed(tab.containerEl, "Archive")).toBeNull();
	});
});

describe("When typed: Auto always offered, with a warning for a common name", () => {
	const s = (name: string, mode: "suggest" | "auto" = "suggest") =>
		({ id: "x", name, aliases: [], kind: "", rules: [], combine: "any", mode, source: "manual" }) as const;
	const host = (m: { value: number; outside: number } | null) =>
		({ mentions: () => m, everyMode: () => "suggest" }) as never;
	const options = (d: ReturnType<typeof whenTyped>) => Object.keys((d.control as { options: object }).options);

	it("a rare name: Auto, and the page says it is safe", () => {
		const d = whenTyped(host({ value: 0.5, outside: 27 }), { ...s("Cobalt"), aliases: [] });
		expect(options(d)).toEqual(["default", "suggest", "auto", "in-only"]);
		expect(d.desc).toContain("“Cobalt” is rare outside it (27 notes): Auto is safe.");
		expect(d.desc).toContain("in any casing");
	});

	it("a common word: Auto still offered, with a warning; not measured yet: checking", () => {
		const team = whenTyped(host({ value: 20.8, outside: 623 }), { ...s("Team"), aliases: [] });
		expect(options(team)).toEqual(["default", "suggest", "auto", "in-only"]);
		expect(team.desc).toContain("Careful with Auto: “Team” is written in 623 notes outside it");
		expect(whenTyped(host(null), { ...s("Cobalt"), aliases: [] }).desc).toContain("Checking how often");
	});
});

describe("on Obsidian 1.13+: a scope's page, saved as you edit", () => {
	afterEach(() => document.body.replaceChildren());

	it("Edit opens the scope's settings page; each change is saved at once; Delete goes back", async () => {
		const { tab, plugin, app } = await make([{ name: "Garden" }]);
		const pages: Array<{ display(): void; containerEl: HTMLElement; title: string }> = [];
		let closed = 0;
		(app as unknown as { setting: unknown }).setting = {
			openPage: (p: (typeof pages)[number]) => {
				pages.push(p);
				p.display();
			},
			closePage: () => closed++,
		};
		const el = goTo(tab, "scopes");
		el.querySelector<HTMLElement>(".jet-set-scope button")?.click();
		const page = pages[0];
		if (!page) throw new Error("no page opened");
		expect(page.title).toBe("Garden");
		expect(document.querySelector(".jet-sed-modal")).toBeNull();
		typeInto(page.containerEl, "Name", "Allotment");
		expect(plugin.data.scopes[0]?.name).toBe("Allotment");
		expect(page.title).toBe("Allotment");
		buttonNamed(page.containerEl, "Delete")?.click();
		expect(plugin.data.scopes).toEqual([]);
		expect(closed).toBe(1);
	});
});
