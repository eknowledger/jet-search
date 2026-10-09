import { describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";
import JetSearchPlugin from "../src/main";
import type { Scope } from "../src/scopes/model";
import type { JetSettingTab } from "../src/settings-tab";
import { whenTyped } from "../src/settings/scopes-page";

type Def = {
	type?: string;
	name?: string;
	desc?: string;
	heading?: string;
	items?: Def[];
	displayValue?: () => string;
	emptyState?: string;
	addItem?: { action: (el: HTMLElement) => void };
	onDelete?: (i: number) => void;
};

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
	const tab = (plugin as unknown as { settingTabs: JetSettingTab[] }).settingTabs[0] as JetSettingTab;
	const page = (): Def => {
		const defs = tab.getSettingDefinitions() as unknown as Def[];
		return defs.flatMap((d) => d.items ?? []).find((d) => d.type === "page" && d.name === "Scopes") as Def;
	};
	return { app, plugin, tab, page, calls: (app.vault as unknown as { calls: string[] }).calls };
};

describe("the Scopes page in settings (option C)", () => {
	it("is one row in Jet's tab, saying how many scopes there are", async () => {
		expect((await make()).page().displayValue?.()).toBe("None yet");
		const { page } = await make([{ mode: "auto" }, {}]);
		expect(page().displayValue?.()).toBe("2 scopes · 1 on Auto");
	});

	it("offers Generate first; once scopes were generated, finding new ones", async () => {
		const first = (await make()).page();
		expect(first.items?.[0]?.items?.[0]?.name).toBe("Find scopes in your vault");
		expect(first.items?.[1]?.emptyState).toContain("No scopes yet");
		const later = (await make([{ source: "generated" }])).page();
		expect(later.items?.[0]?.items?.[0]?.name).toBe("Find new scopes");
	});

	it("lists each scope as a page with its rules, and its mode as the row's value", async () => {
		const { page } = await make([{ name: "Garden", mode: "in-only" }]);
		const row = page().items?.[1]?.items?.[0];
		expect(row?.type).toBe("page");
		expect(row?.name).toBe("Garden");
		expect(row?.desc).toContain("folder Projects/Garden");
		expect((row as unknown as { displayValue: string }).displayValue).toBe("in: only");
	});

	it("adds a scope by hand, and removes a rule from its page", async () => {
		const { page, plugin } = await make([{ name: "Garden" }]);
		page().items?.[1]?.addItem?.action(document.createElement("div"));
		expect(plugin.data.scopes.map((s) => s.name)).toEqual(["Garden", "New scope"]);
		const garden = page().items?.[1]?.items?.[0];
		const rules = garden?.items?.find((d) => d.heading === "Matches");
		rules?.onDelete?.(0);
		expect(plugin.data.scopes[0]?.rules).toEqual([]);
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

	it("lists no file while the tab is not on screen (Obsidian asks for the definitions at load)", async () => {
		const { page, calls } = await make([{ name: "Garden" }]);
		calls.length = 0;
		page();
		expect(calls).toEqual([]);
	});
});

describe("folders to leave out as a page", () => {
	it("is a row with the folder count that opens a list; a folder can be removed from it", async () => {
		const { tab, plugin } = await make();
		plugin.data.settings.exclude = ["Archive", "Templates"];
		const find = (): Def =>
			(tab.getSettingDefinitions() as unknown as Def[])
				.flatMap((d) => d.items ?? [])
				.find((d) => d.name === "Folders to leave out") as Def;
		expect(find().type).toBe("page");
		expect(find().displayValue?.()).toBe("2 folders");
		const list = find().items?.[0];
		expect(list?.items?.map((d) => d.name)).toEqual(["Archive", "Templates"]);
		list?.onDelete?.(0);
		expect(plugin.data.settings.exclude).toEqual(["Templates"]);
	});
});

describe("When typed: Auto always offered, with a warning for a common name", () => {
	const s = (name: string, mode: "suggest" | "auto" = "suggest") =>
		({ id: "x", name, aliases: [], kind: "", rules: [], combine: "any", mode, source: "manual" }) as const;
	const host = (m: { value: number; outside: number } | null) => ({ mentions: () => m }) as never;
	const options = (d: ReturnType<typeof whenTyped>) => Object.keys((d.control as { options: object }).options);

	it("a rare name: Auto, and the page says it is safe", () => {
		const d = whenTyped(host({ value: 0.5, outside: 27 }), { ...s("Cobalt"), aliases: [] });
		expect(options(d)).toEqual(["suggest", "auto", "in-only"]);
		expect(d.desc).toContain("“Cobalt” is rare outside it (27 notes): Auto is safe.");
		expect(d.desc).toContain("in any casing");
	});

	it("a common word: Auto still offered, with a warning; not measured yet: checking", () => {
		const team = whenTyped(host({ value: 20.8, outside: 623 }), { ...s("Team"), aliases: [] });
		expect(options(team)).toEqual(["suggest", "auto", "in-only"]);
		expect(team.desc).toContain("Careful with Auto: “Team” is written in 623 notes outside it");
		expect(whenTyped(host(null), { ...s("Cobalt"), aliases: [] }).desc).toContain("Checking how often");
	});
});
