import { describe, expect, it } from "vitest";
import { normalizeScopes, scopeId } from "../src/scopes/model";

describe("stored scopes", () => {
	it("keeps a well-formed scope as it is", () => {
		const s = {
			id: "s1",
			name: "Garden",
			aliases: ["gdn"],
			kind: "Projects",
			rules: [
				{ kind: "folder", path: "Projects/Garden" },
				{ kind: "property", key: "project", target: "Projects/Garden/Garden.md" },
				{ kind: "property", key: "category", value: "Recipe" },
				{ kind: "tag", tag: "#garden" },
			],
			combine: "any",
			mode: "suggest",
			source: "generated",
			origins: [{ signal: "container-folder", at: "Projects", key: "Projects/Garden", v: 1 }],
			generated: [{ kind: "folder", path: "Projects/Garden" }],
		};
		expect(normalizeScopes([s])).toEqual([s]);
	});

	it("drops what is not a scope, bad rules and unknown fields, and fills defaults", () => {
		const out = normalizeScopes([
			null,
			"Garden",
			{ name: "" },
			{
				name: "  Lyon  ",
				aliases: ["ly", 3, ""],
				rules: [
					{ kind: "folder", path: "Trips/Lyon/" },
					{ kind: "folder" },
					{ kind: "tag", tag: "lyon" },
					{ kind: "property", key: "trip" },
					{ kind: "teleport", to: "Mars" },
				],
				mode: "sometimes",
				combine: "most",
				extra: true,
			},
		]);
		expect(out).toHaveLength(1);
		expect(out[0]).toEqual({
			id: scopeId("Lyon", [{ kind: "folder", path: "Trips/Lyon" }]),
			name: "Lyon",
			aliases: ["ly"],
			kind: "",
			rules: [
				{ kind: "folder", path: "Trips/Lyon" },
				{ kind: "tag", tag: "#lyon" },
			],
			combine: "any",
			mode: "suggest",
			source: "manual",
		});
	});

	it("makes ids unique when two scopes share one", () => {
		const a = { id: "x", name: "Amber Studio", rules: [{ kind: "folder", path: "Projects/Amber Studio" }] };
		const b = { id: "x", name: "Amber Studio", rules: [{ kind: "folder", path: "Areas/Amber Studio" }] };
		const [s1, s2] = normalizeScopes([a, b]);
		expect(s1?.id).toBe("x");
		expect(s2?.id).not.toBe("x");
		expect(s2?.name).toBe("Amber Studio");
	});

	it("gives a new scope an id from its name and first rule, stable across runs", () => {
		const rules = [{ kind: "folder" as const, path: "Projects/Garden" }];
		expect(scopeId("Garden", rules)).toBe(scopeId("Garden", rules));
		expect(scopeId("Garden", rules)).not.toBe(scopeId("Garden", [{ kind: "folder", path: "Areas/Garden" }]));
	});
});
