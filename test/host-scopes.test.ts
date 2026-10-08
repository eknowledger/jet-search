import { describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";
import { normalizeData } from "../src/data";
import { FilterSets } from "../src/filters/sets";
import { type HostScopes, JetHost } from "../src/host";
import type { Entry } from "../src/modal/jet-modal";
import type { Rule, Scope } from "../src/scopes/model";
import type { Search } from "../src/search";

const COBALT: Scope = {
	id: "cobalt",
	name: "Cobalt",
	aliases: ["cob"],
	kind: "Projects",
	rules: [
		{ kind: "folder", path: "2.Projects/Cobalt" },
		{ kind: "property", key: "project", target: "2.Projects/Cobalt/Cobalt.md" },
		{ kind: "tag", tag: "#cobalt" },
	],
	combine: "any",
	mode: "suggest",
	source: "generated",
};
const STUDIO: Scope = { ...COBALT, id: "amb", name: "Amber Studio", aliases: [], kind: "Areas" };

const setup = (scopes: Scope[] = [COBALT, STUDIO]) => {
	const app = new App();
	const files = (app.vault as unknown as { files: Map<string, TFile> }).files;
	const paths = ["2.Projects/Cobalt/Plan.md", "2.Projects/Cobalt/Notes.md", "2.Projects/Cobalt/Old.md"];
	paths.forEach((p, i) => {
		const f = new TFile(p);
		f.stat.mtime = 1000 * (i + 1);
		files.set(p, f);
	});
	const data = normalizeData(null);
	data.opened["2.Projects/Cobalt/Old.md"] = [1, 5000];
	const searched: Array<[string, string | undefined]> = [];
	const edited: string[] = [];
	const measured: string[] = [];
	const amb = new Map<string, number>();
	let ensured = 0;
	const access: HostScopes = {
		all: () => scopes,
		ensure: () => {
			ensured++;
		},
		count: (id) => (id === "cobalt" ? 3 : 0),
		membersOf: (id) => new Set(id === "cobalt" ? paths : []),
		ruleCount: (r: Rule) => (r.kind === "folder" ? 3 : r.kind === "tag" ? 2 : 1),
		edit: (id) => edited.push(id),
		ambiguity: (id) => amb.get(id) ?? null,
		measure: (id) => measured.push(id),
	};
	const search = {
		list: (t: string, _p: unknown, s?: string) => searched.push([t, s]),
		warm: () => {},
		idle: () => {},
	} as unknown as Search;
	const host = new JetHost(
		app as never,
		() => data,
		() => {},
		() => false,
		() => search,
		undefined,
		access,
		new FilterSets(app as never),
	);
	return { host, app, data, searched, edited, measured, amb, ensured: () => ensured };
};

describe("the host's scopes", () => {
	it("no scopes, no scope typing", () => {
		expect(setup([]).host.scopes).toBeUndefined();
	});

	it("tells the modal what the text says, with the scope's size known for the banner", () => {
		const { host, ensured } = setup();
		const t = host.scopes?.typed("  Cobalt world");
		expect(t?.suggest).toMatchObject({ scope: { id: "cobalt", name: "Cobalt", members: 3 }, rest: "world", at: 2 });
		expect(ensured()).toBe(1);
		expect(host.scopes?.typed("Cobalt")?.hint?.id).toBe("cobalt");
		expect(host.scopes?.typed("@cob world")?.applied).toMatchObject({ text: "world", complete: true });
		expect(host.scopes?.typed("garden")).toEqual({});
	});

	it("the card: each rule in words with its count, the total and the aliases", () => {
		const c = setup().host.scopes?.card("cobalt");
		expect(c).toEqual({
			name: "Cobalt",
			kind: "Projects",
			mode: "Suggest",
			all: false,
			rules: [
				{ icon: "folder", text: "2.Projects/Cobalt/ and below", count: 3 },
				{ icon: "link", text: "project → [[Cobalt]]", count: 1 },
				{ icon: "hash", text: "#cobalt and nested tags", count: 2 },
			],
			total: 3,
			aliases: ["cob"],
		});
	});

	it("searches inside the chip's scope; no text lists its notes, opened first, then by change", () => {
		const { host, searched } = setup();
		host.list("world", () => {}, "cobalt");
		expect(searched).toEqual([["world", "cobalt"]]);
		let shown: Entry[] = [];
		host.list("", (e) => (shown = e), "cobalt");
		expect(shown[0]).toMatchObject({ type: "header", label: "Recent" });
		expect(shown.filter((e) => e.type === "item").map((e) => (e as { path: string }).path)).toEqual([
			"2.Projects/Cobalt/Old.md",
			"2.Projects/Cobalt/Notes.md",
			"2.Projects/Cobalt/Plan.md",
		]);
	});

	it("hints follow the scope state", () => {
		const { host } = setup();
		expect(host.hints("Cobalt world", { suggest: "Cobalt" })[0]).toEqual(["⇥", "Search in Cobalt"]);
		expect(host.hints("Cobalt", { hint: "Cobalt" })[0]).toEqual(["⇥", "Search in Cobalt"]);
		expect(host.hints("world", { chip: "Cobalt" }).map((h) => h[0])).toContain("⌫");
		expect(host.hints("", { chip: "Cobalt" })).toContainEqual(["Esc", "Clear"]);
		expect(host.hints("world", { chip: "Cobalt", selected: true })[0]).toEqual([
			"⌫",
			"Remove Cobalt (it returns as text)",
		]);
	});

	it("remembers a search with its scope, in the form that applies it again", () => {
		const { host, data } = setup();
		const view = (s: Scope) => ({ id: s.id, name: s.name, kind: s.kind, members: 3 });
		host.closed("garden plan", true, view(COBALT));
		host.closed("plugin", true, view(STUDIO));
		host.closed("", true, view(COBALT));
		expect(data.searches).toEqual(["in:Cobalt", 'in:"Amber Studio" plugin', "in:Cobalt garden plan"]);
	});

	it("Edit scope opens the scope's settings", () => {
		const { host, edited } = setup();
		host.scopes?.edit("cobalt");
		expect(edited).toEqual(["cobalt"]);
	});

	it("Auto applies at once for a rare name in any casing; unmeasured, only as written (and it gets measured)", () => {
		const bridge: Scope = { ...COBALT, id: "bridge", name: "Moonbridge", aliases: [], mode: "auto" };
		const { host, measured, amb } = setup([bridge, STUDIO]);
		expect(host.scopes?.typed("moonbridge invoices")?.auto).toBeUndefined();
		expect(host.scopes?.typed("Moonbridge invoices")?.auto).toBe(true);
		expect(measured).toContain("bridge");
		amb.set("bridge", 0.4);
		expect(host.scopes?.typed("moonbridge invoices")?.auto).toBe(true);
		expect(host.scopes?.typed("moonbridge")?.auto).toBe(true);
	});

	it("scopes of one name are listed biggest first, and never apply by themselves", () => {
		const small: Scope = { ...COBALT, id: "c2", kind: "Areas", mode: "auto" };
		const { host, amb } = setup([small, { ...COBALT, mode: "auto" }]);
		amb.set("cobalt", 0);
		amb.set("c2", 0);
		const t = host.scopes?.typed("Cobalt world");
		expect(t?.suggest?.scope.id).toBe("cobalt");
		expect(t?.suggest?.others.map((o) => o.id)).toEqual(["c2"]);
		expect(t?.auto).toBeUndefined();
	});

	it("creates a note in the chip's scope: its folder, its property filled in", async () => {
		const { host, app } = setup();
		(app.vault as unknown as { folders: Set<string> }).folders.add("2.Projects/Cobalt");
		host.create("New idea", "cobalt");
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));
		const fm = (app as unknown as { frontmatter: Map<string, Record<string, unknown>> }).frontmatter;
		expect(fm.get("2.Projects/Cobalt/New idea.md")).toEqual({ project: "[[Cobalt]]" });
		host.create("Loose", undefined);
		await new Promise((r) => setTimeout(r, 0));
		expect(app.vault.getFileByPath("Inbox/Loose.md")).not.toBeNull();
	});
});

describe("the host's filters", () => {
	it("remembers a search with its filters and scope, typed so they apply again", () => {
		const app = new App();
		const data = normalizeData(null);
		const search = { list: () => {}, warm: () => {}, idle: () => {} } as unknown as Search;
		const host = new JetHost(
			app as never,
			() => data,
			() => {},
			() => false,
			() => search,
		);
		host.closed("world", true, { id: "c", name: "Cobalt", kind: "", members: 1 }, [
			{ kind: "prop", key: "status", value: "draft" },
			{ kind: "edited", days: 7 },
			{ kind: "title" },
		]);
		expect(data.searches[0]).toBe("in:Cobalt status:draft edited:7d world");
	});
});

describe("the empty state and persisted filters", () => {
	it("lists the open note's scope first, then the most used; remembers and restores scope and filters", () => {
		const { host, app, data } = setup();
		(app.workspace as unknown as { getActiveFile: () => TFile }).getActiveFile = () =>
			new TFile("2.Projects/Cobalt/Plan.md");
		data.scopeUses.amb = 5;
		data.searches = ["in:Cobalt edited:7d world"];
		const rec = host.recents();
		const row = rec[0];
		expect(row?.type).toBe("scopes");
		expect(row?.type === "scopes" && row.chips.map((c) => [c.scope.id, !!c.here])).toEqual([
			["cobalt", true],
			["amb", false],
		]);
		const search = rec.find((e) => e.type === "search");
		expect(search?.type === "search" && search.parts).toEqual([
			{ chip: ["", "Cobalt"] },
			{ chip: ["edited", "past 7 days"] },
			{ text: "world" },
		]);
		const view = { id: "cobalt", name: "Cobalt", kind: "Projects", members: 3 };
		host.closed("x", true, view, [{ kind: "edited", days: 7 }]);
		expect(data.scopeUses.cobalt).toBe(1);
		expect(host.restore()).toBeNull();
		data.settings.persistFilters = true;
		host.closed("x", false, view, [{ kind: "edited", days: 7 }]);
		expect(host.restore()).toEqual({ scope: view, filters: [{ kind: "edited", days: 7 }] });
	});
});
