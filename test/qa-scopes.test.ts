/**
 * QA (scopes and typing them in the box): each test reproduces one bug found by reading the code and
 * trying user sequences. They fail until the bug is fixed. The real host and parser are used where the
 * bug is in how they meet the modal; a stand-in host only where a piece of the real one is not needed.
 */
import { afterEach, describe, expect, it } from "vitest";
import { App, type Scope as KeyScope } from "obsidian";
import { normalizeData } from "../src/data";
import { findFix } from "../src/filters/complete";
import { findFilters } from "../src/filters/filter";
import { FilterSets } from "../src/filters/sets";
import { type HostScopes, JetHost, scopedSearch } from "../src/host";
import { JetModal, type ModalHost, type ScopeView } from "../src/modal/jet-modal";
import { type Scope, withModes } from "../src/scopes/model";
import { stripName } from "../src/scopes/names";
import { parseScope } from "../src/scopes/parse";
import type { Search } from "../src/search";
import { addScope, type ScopesHost } from "../src/settings/scopes-page";

const sc = (id: string, name: string, extra: Partial<Scope> = {}): Scope => ({
	id,
	name,
	aliases: [],
	kind: "Projects",
	rules: [{ kind: "folder", path: id }],
	combine: "any",
	mode: "suggest",
	source: "manual",
	...extra,
});

/** The real host and parser over these scopes (members per id from `counts`), with the modal open. */
const real = (scopes: Scope[], counts: Record<string, number> = {}) => {
	const app = new App();
	const data = normalizeData(null);
	const searched: Array<[string, string | undefined]> = [];
	const access: HostScopes = {
		all: () => scopes,
		ensure: () => {},
		count: (id) => counts[id] ?? 1,
		membersOf: () => new Set(),
		ruleCount: () => 0,
		edit: () => {},
		ambiguity: () => null,
		measure: () => {},
	};
	const search = {
		list: (t: string, _p: unknown, s?: string) => searched.push([t, s]),
		warm: () => {},
		idle: () => {},
		refresh: () => {},
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
	const open = () => {
		const m = new JetModal(app as never, host);
		m.open();
		return m;
	};
	return { m: open(), open, host, data, searched };
};

const press = (m: JetModal, key: string, mods: Parameters<KeyScope["register"]>[0] = []) =>
	(m.scope as unknown as { press(k: string, m: unknown[]): boolean }).press(key, mods);
const type = (m: JetModal, text: string) => {
	m.inputEl.value = text;
	m.inputEl.setSelectionRange(text.length, text.length);
	m.inputEl.dispatchEvent(new Event("input"));
};
const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
/** The last chip (the one ⌫ and ⇥ act on); chips added before it are `.is-kept`. */
const chip = () => $(".jet-chip:not(.is-kept):not(.is-hidden) .jet-chl")?.textContent ?? null;
const kept = () => [...document.querySelectorAll(".jet-chip.is-kept .jet-chl")].map((e) => e.textContent);
const banner = () => $(".jet-ban")?.textContent ?? "";

describe("QA: scopes typed in the search box", () => {
	afterEach(() => document.body.replaceChildren());

	// withModes keeps stale copies after an in-place edit on the settings page.
	it("a scope renamed on its settings page (edited in place) is typed by its new name", () => {
		const scopes = [sc("c", "Cobalt", { mode: "default" })];
		expect(withModes(scopes, "suggest")[0]?.name).toBe("Cobalt");
		// What the Name and Aliases fields do (scopes-page.ts: `s.name = name`, `s.aliases = aliases`).
		const s = scopes[0] as Scope;
		s.name = "Roe";
		s.aliases = ["sturgeon"];
		const now = withModes(scopes, "suggest");
		expect(now[0]?.name).toBe("Roe");
		expect(parseScope("roe", now).hint?.id).toBe("c");
		expect(parseScope("cobalt", now).hint).toBeUndefined();
	});

	// applying a scope from typed text drops the space the user just typed.
	it("`meeting @cobalt ` then `notes`: the words stay apart", () => {
		const { m, searched } = real([sc("cobalt", "Cobalt")]);
		type(m, "meeting @cobalt ");
		expect(chip()).toBe("Cobalt");
		type(m, `${m.inputEl.value}notes`);
		expect(searched.at(-1)).toEqual(["meeting notes", "cobalt"]);
	});

	it("Auto, `roe cobalt ` then `prices`: the words stay apart", () => {
		const { m, searched } = real([sc("cobalt", "Cobalt", { mode: "auto" })]);
		type(m, "roe cobalt ");
		expect(chip()).toBe("Cobalt");
		type(m, `${m.inputEl.value}prices`);
		expect(searched.at(-1)).toEqual(["roe prices", "cobalt"]);
	});

	// a shared name typed alone loses the other scope of that name.
	it("a name two scopes share, typed alone and a space, never applies by itself (Auto)", () => {
		const { m } = real([sc("g1", "Garden", { mode: "auto" }), sc("g2", "Garden", { kind: "Areas", mode: "auto" })]);
		type(m, "garden ");
		expect(chip()).toBeNull();
	});

	it("a name two scopes share, typed alone then ⇥: both offered, the biggest first", () => {
		const { m } = real([sc("g1", "Garden"), sc("g2", "Garden", { kind: "Areas" })], { g1: 2, g2: 9 });
		type(m, "garden");
		expect(press(m, "Tab")).toBe(true);
		expect(banner()).toContain("Two scopes are named “Garden”");
		expect(chip()).toBe("Garden · Areas");
	});

	// `@Name` / `in:Name` apply the first scope of a name, whichever one was picked.
	it("the @ list's first row (Garden · Areas, the biggest) applies that scope, not the other Garden", () => {
		const { m, searched } = real([sc("g1", "Garden"), sc("g2", "Garden", { kind: "Areas" })], { g1: 2, g2: 9 });
		type(m, "@gar");
		const rows = [...document.querySelectorAll(".jet-ac .jet-acr")].map((r) => r.textContent ?? "");
		expect(rows[0]).toContain("Areas");
		expect(press(m, "Tab")).toBe(true);
		type(m, "roses");
		expect(searched.at(-1)).toEqual(["roses", "g2"]);
	});

	it("a recent search made in the second “Garden” applies that one again", () => {
		const { m, open, host, searched } = real([sc("g1", "Garden"), sc("g2", "Garden", { kind: "Areas" })]);
		m.close();
		host.closed("roses", true, { id: "g2", name: "Garden", kind: "Areas", members: 1 });
		const again = open();
		// Nothing typed: the first selectable row is the recent search "in:Garden roses".
		expect(press(again, "Enter")).toBe(true);
		expect(searched.at(-1)).toEqual(["roses", "g2"]);
	});

	// the banner offers ⇥ Fix while a scope chip is on, but ⇥ does nothing then.
	it("with a scope chip on, ⇥ applies the fix the banner offers", () => {
		const COB: ScopeView = { id: "cobalt", name: "Cobalt", kind: "Projects", members: 3 };
		const known = (k: string) => k.toLowerCase() === "status";
		const host: ModalHost = {
			placeholder: "Search notes…",
			list: (_t, paint) => paint([]),
			open: () => {},
			hints: () => [["↵", "Open"]],
			closed: () => {},
			previewOn: () => false,
			setPreviewOn: () => {},
			copyLink: () => {},
			insertLink: () => {},
			create: () => {},
			restore: () => ({ scope: COB, filters: [] }),
			scopes: {
				typed: () => ({}),
				card: () => ({ name: "", kind: "", mode: "", rules: [], total: 0, aliases: [] }),
				edit: () => {},
			},
			filters: {
				find: (t) => findFilters(t, known),
				values: () => [],
				tags: () => [],
				keys: () => [["status", 9]],
				scopes: () => [COB],
				complete: () => null,
				fix: (t) => {
					const f = findFix(t, [["status", 9]], known);
					return f ? { ...f, notes: 9 } : null;
				},
				preview: () => [],
			},
		};
		const m = new JetModal(new App() as never, host);
		m.open();
		expect(chip()).toBe("Cobalt");
		type(m, "stauts:draft");
		expect(banner()).toContain("Did you mean status:?");
		expect(press(m, "Tab")).toBe(true);
		expect([...document.querySelectorAll(".jet-fchip")].map((c) => c.textContent)).toEqual(["statusdraft"]);
	});

	// Esc / × (a new search) keep the widened state from ⇧⇧.
	it("after ⇧⇧ widen, Esc clears to a new search: no “was in Cobalt”, ⇧⇧ does not bring it back", () => {
		const { m } = real([sc("cobalt", "Cobalt")]);
		type(m, "@cobalt ");
		type(m, "world");
		expect(m.widen()).toBe(true);
		expect(banner()).toContain("was in Cobalt");
		press(m, "Escape");
		expect(m.inputEl.value).toBe("");
		expect(banner()).not.toContain("was in Cobalt");
		expect(m.widen()).toBe(false);
		expect(chip()).toBeNull();
	});

	// `@Two Words` without quotes leaves the second word as search text.
	it("`@Amber Studio plugin` applies Amber Studio and searches for “plugin”", () => {
		const p = parseScope("@Amber Studio plugin", [sc("amb", "Amber Studio")]);
		expect(p.applied?.id).toBe("amb");
		expect(p.text).toBe("plugin");
	});

	// only the first `@word` / `in:word` is looked at.
	it("`@ann @cobalt notes`: a non-scope @word first does not hide the scope after it", () => {
		const p = parseScope("@ann @cobalt notes", [sc("cobalt", "Cobalt")]);
		expect(p.applied?.id).toBe("cobalt");
		expect(p.text).toBe("@ann notes");
	});

	// a generated order-index alias ("2" from "2.Projects") matches every bare number typed.
	it("the alias “2” of “2.Projects” does not turn “week 2 review” into a scope suggestion", () => {
		const s = stripName("2.Projects", true);
		expect(s).toEqual({ name: "Projects", alias: "2" });
		const projects = sc("p", s.name, { aliases: [s.alias as string] });
		expect(parseScope("week 2 review", [projects]).suggest).toBeUndefined();
	});

	it("every scope on Auto: typing “top 2 ideas” is not scoped to Projects", () => {
		const { m, searched } = real([sc("p", "Projects", { aliases: ["2"], mode: "auto" })]);
		type(m, "top 2 ideas");
		expect(chip()).toBeNull();
		expect(searched.at(-1)).toEqual(["top 2 ideas", undefined]);
	});

	// an Auto scope that is already the chip eats its own name from the text.
	it("in Cobalt (Auto), typing “cobalt grading” keeps the word: the chip's own name is just a word", () => {
		const { m, searched } = real([sc("cobalt", "Cobalt", { mode: "auto" })]);
		type(m, "@cobalt ");
		expect(chip()).toBe("Cobalt");
		type(m, "cobalt grading");
		expect(m.inputEl.value).toBe("cobalt grading");
		expect(searched.at(-1)).toEqual(["cobalt grading", "cobalt"]);
	});

	// the two-scopes banner says ⇥ next, but ⇥ switches to a scope suggested in the text.
	it("chip with two of its name, text naming another scope: the banner says what ⇥ does", () => {
		const { m } = real(
			[sc("a1", "Amber Studio"), sc("a2", "Amber Studio", { kind: "Areas" }), sc("cobalt", "Cobalt")],
			{
				a1: 9,
				a2: 2,
			},
		);
		type(m, "Amber Studio plugin");
		press(m, "Tab");
		expect(chip()).toBe("Amber Studio · Projects");
		type(m, "cobalt roe");
		const said = banner();
		press(m, "Tab");
		// ⇥ went to Cobalt, so the banner should have offered Cobalt, not "⇥ next": added (the default).
		expect(chip()).toBe("Cobalt");
		expect(kept()).toEqual(["Amber Studio"]);
		expect(said).toContain("Add Cobalt to this search");
	});

	it("Switch to it: the banner offers Cobalt instead, and ⇥ switches", () => {
		const { m, data } = real(
			[sc("a1", "Amber Studio"), sc("a2", "Amber Studio", { kind: "Areas" }), sc("cobalt", "Cobalt")],
			{
				a1: 9,
				a2: 2,
			},
		);
		data.settings.scopeAnother = "switch";
		type(m, "Amber Studio plugin");
		press(m, "Tab");
		type(m, "cobalt roe");
		expect(banner()).toContain("Search in Cobalt instead of Amber Studio");
		press(m, "Tab");
		expect(chip()).toBe("Cobalt");
		expect(kept()).toEqual([]);
	});

	// an Auto name that starts a longer scope name hides the longer one.
	it("Cobalt on Auto, “Cobalt Research” on Suggest: typing “cobalt research notes” suggests Cobalt Research", () => {
		const { m } = real([sc("c", "Cobalt", { mode: "auto" }), sc("cr", "Cobalt Research")]);
		type(m, "cobalt");
		type(m, "cobalt ");
		// Typing goes on after the space: whatever the box holds now, then the rest of the name.
		type(m, `${m.inputEl.value}research notes`);
		// Either Auto waited (a suggestion for Cobalt Research) or it moved to it; not Cobalt + "research notes".
		expect(chip()).not.toBe("Cobalt");
	});

	// a name with a double quote is never applied again from its recent search.
	it("a scope named with a double quote is applied again by its recent search", () => {
		const s = sc("q", 'The "Big" Plan');
		const q = scopedSearch(s.name, "budget");
		expect(parseScope(q, [s]).applied?.id).toBe("q");
	});

	// the @ list matches prefixes with spaces kept; the parser matches them without.
	it("`@ambst` lists Amber Studio, the scope the space after it applies", () => {
		expect(parseScope("@ambst plugin", [sc("amb", "Amber Studio")]).applied?.id).toBe("amb");
		const { m } = real([sc("amb", "Amber Studio"), sc("cobalt", "Cobalt")]);
		type(m, "@ambst");
		const rows = [...document.querySelectorAll(".jet-ac .jet-acr")].map((r) => r.textContent ?? "");
		expect(rows.join(" | ")).toContain("Amber Studio");
	});
});

// the settings page's + Add scope reuses the id of a scope that was renamed from "New scope".
describe("QA: the Scopes settings page", () => {
	it("Add scope, rename it, Add scope again: two scopes with two ids", () => {
		const all: Scope[] = [];
		const h = { scopes: () => all, save: () => {}, changed: () => {} } as unknown as ScopesHost;
		addScope(h);
		// What the Name field does (scope-editor.ts: `s.name = name`).
		(all[0] as Scope).name = "Cobalt";
		addScope(h);
		expect(all.map((s) => s.name)).toEqual(["Cobalt", "New scope"]);
		expect(new Set(all.map((s) => s.id)).size).toBe(2);
	});
});
