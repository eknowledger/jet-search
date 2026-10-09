import { describe, expect, it } from "vitest";
import { normalizeData } from "../src/data";
import { modeOf, normalizeScopes, type Scope, withModes } from "../src/scopes/model";
import { MODE_LABEL, scopesPage, type ScopesHost, whenTyped } from "../src/settings/scopes-page";

const scope = (id: string, mode: Scope["mode"]): Scope => ({
	id,
	name: id,
	aliases: [],
	kind: "Projects",
	rules: [{ kind: "folder", path: id }],
	combine: "any",
	mode,
	source: "generated",
});

describe("one mode for every scope, each can choose its own", () => {
	it("a scope on the default follows every scope's mode; one that chose keeps it", () => {
		expect(modeOf(scope("a", "default"), "auto")).toBe("auto");
		expect(modeOf(scope("b", "in-only"), "auto")).toBe("in-only");
		const all = [scope("a", "default"), scope("b", "suggest")];
		expect(withModes(all, "auto").map((s) => s.mode)).toEqual(["auto", "suggest"]);
		expect(all[0]?.mode).toBe("default");
	});

	it("stored data: an unknown mode is the default", () => {
		expect(normalizeScopes([{ name: "X", rules: [], mode: "weird" }])[0]?.mode).toBe("default");
	});

	it("data from before: Suggest (the old default) becomes the default; Auto and in: only stay chosen", () => {
		const d = normalizeData({
			settings: {},
			scopes: [
				{ name: "A", mode: "suggest", rules: [] },
				{ name: "B", mode: "auto", rules: [] },
				{ name: "C", mode: "in-only", rules: [] },
			],
		});
		expect(d.settings.scopeMode).toBe("suggest");
		expect(d.scopes.map((s) => s.mode)).toEqual(["default", "auto", "in-only"]);
		// Saved since: a Suggest you chose stays Suggest.
		const again = normalizeData({
			settings: { scopeMode: "auto" },
			scopes: [{ name: "A", mode: "suggest", rules: [] }],
		});
		expect(again.settings.scopeMode).toBe("auto");
		expect(again.scopes[0]?.mode).toBe("suggest");
	});

	it("the Scopes page: a first row for every scope; each row says whose mode it shows", () => {
		const all = [scope("Cobalt", "default"), scope("Moonbridge", "auto")];
		const h = {
			app: {},
			scopes: () => all,
			save: () => {},
			count: () => 3,
			ruleCount: () => 3,
			mentions: () => ({ value: 0.2, outside: 4 }),
			changed: () => {},
			generate: () => true,
			generatePage: () => ({}),
			canOpenPages: () => true,
			newCount: () => 0,
			everyMode: () => "suggest",
		} as unknown as ScopesHost;
		const page = scopesPage(h) as unknown as {
			items: Array<{
				type: string;
				items: Array<{ name: string; control?: { key: string }; displayValue?: unknown }>;
			}>;
		};
		const first = page.items[0]?.items[0];
		expect(first?.name).toBe("When typed, for every scope");
		expect(first?.control?.key).toBe("scopeMode");
		const rows = page.items[1]?.items ?? [];
		expect(rows.map((r) => r.displayValue)).toEqual(["Suggest · every scope", "Auto"]);
		const d = whenTyped(h, all[0] as Scope);
		expect((d.control as { options: Record<string, string> }).options.default).toBe("Like every scope (Suggest)");
		expect(MODE_LABEL.default).toBe("Like every scope");
	});
});
