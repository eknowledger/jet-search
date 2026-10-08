import { describe, expect, it } from "vitest";
import { createDetail, createTarget } from "../src/scopes/create";
import type { Rule, Scope } from "../src/scopes/model";

const scope = (rules: Rule[]): Scope => ({
	id: "x",
	name: "Cobalt",
	aliases: [],
	kind: "",
	rules,
	combine: "any",
	mode: "suggest",
	source: "manual",
});

describe("creating a note in a scope", () => {
	it("the folder and the property from the scope's rules", () => {
		const t = createTarget(
			scope([
				{ kind: "folder", path: "2.Projects/Cobalt" },
				{ kind: "property", key: "project", target: "2.Projects/Cobalt/Cobalt.md" },
				{ kind: "tag", tag: "#cobalt" },
			]),
		);
		expect(t).toEqual({ folder: "2.Projects/Cobalt", prop: ["project", "[[Cobalt]]"], tag: null });
		expect(createDetail(t)).toBe("2.Projects/Cobalt · project: [[Cobalt]] filled in");
	});

	it("a plain value, a tag-only scope, and a scope without a folder", () => {
		expect(createTarget(scope([{ kind: "property", key: "area", value: "home" }]))).toEqual({
			folder: null,
			prop: ["area", "home"],
			tag: null,
		});
		const tagged = createTarget(scope([{ kind: "tag", tag: "#garden" }]));
		expect(tagged).toEqual({ folder: null, prop: null, tag: "#garden" });
		expect(createDetail(tagged)).toBe("Your default folder for new notes · #garden added");
	});
});
