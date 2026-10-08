import { describe, expect, it } from "vitest";
import { inScope, members, type NoteFacts } from "../src/scopes/members";
import type { Scope } from "../src/scopes/model";

const note = (path: string, extra: Partial<NoteFacts> = {}): NoteFacts => ({
	path,
	props: {},
	links: {},
	tags: [],
	...extra,
});

const scope = (rules: Scope["rules"], combine: Scope["combine"] = "any"): Scope => ({
	id: "s",
	name: "Garden",
	aliases: [],
	kind: "",
	rules,
	combine,
	mode: "suggest",
	source: "manual",
});

describe("scope membership", () => {
	it("a folder rule takes the folder and its subfolders, not a sibling with the same start", () => {
		const s = scope([{ kind: "folder", path: "Projects/Garden" }]);
		expect(inScope(s, note("Projects/Garden/Plan.md"))).toBe(true);
		expect(inScope(s, note("Projects/Garden/2024/Beds.md"))).toBe(true);
		expect(inScope(s, note("Projects/Gardening/Tools.md"))).toBe(false);
		expect(inScope(s, note("Projects/Garden.md"))).toBe(false);
	});

	it("a link property counts every spelling that resolves to the same note", () => {
		const s = scope([{ kind: "property", key: "project", target: "Projects/Garden/Garden.md" }]);
		// The caller resolves links: [[Garden]], [[Projects/Garden/Garden]] and [[Garden|the beds]] are one note.
		const spellings = ["Daily/a.md", "Daily/b.md", "Daily/c.md"].map((p) =>
			note(p, { links: { project: ["Projects/Garden/Garden.md"] } }),
		);
		expect(spellings.every((n) => inScope(s, n))).toBe(true);
		expect(inScope(s, note("Daily/d.md", { links: { project: ["Projects/Lyon/Lyon.md"] } }))).toBe(false);
		// A list of two projects counts for both.
		expect(
			inScope(
				s,
				note("Daily/e.md", { links: { project: ["Projects/Lyon/Lyon.md", "Projects/Garden/Garden.md"] } }),
			),
		).toBe(true);
	});

	it("a value property matches case-insensitively, in lists too; keys match case-insensitively", () => {
		const s = scope([{ kind: "property", key: "category", value: "Recipe" }]);
		expect(inScope(s, note("a.md", { props: { category: "recipe" } }))).toBe(true);
		expect(inScope(s, note("b.md", { props: { Category: ["Book", "Recipe"] } }))).toBe(true);
		expect(inScope(s, note("c.md", { props: { category: "Recipes" } }))).toBe(false);
	});

	it("a tag rule takes the tag and its nested tags, case-insensitively", () => {
		const s = scope([{ kind: "tag", tag: "#project/beta" }]);
		expect(inScope(s, note("a.md", { tags: ["#project/beta"] }))).toBe(true);
		expect(inScope(s, note("b.md", { tags: ["#Project/Beta/design"] }))).toBe(true);
		expect(inScope(s, note("c.md", { tags: ["#project/betamax"] }))).toBe(false);
	});

	it("combines rules with any (union) or all (intersection); no rules, no members", () => {
		const rules: Scope["rules"] = [
			{ kind: "folder", path: "Projects/Garden" },
			{ kind: "tag", tag: "#garden" },
		];
		const inFolder = note("Projects/Garden/Plan.md");
		const both = note("Projects/Garden/Beds.md", { tags: ["#garden"] });
		expect(inScope(scope(rules), inFolder)).toBe(true);
		expect(inScope(scope(rules, "all"), inFolder)).toBe(false);
		expect(inScope(scope(rules, "all"), both)).toBe(true);
		expect(inScope(scope([]), both)).toBe(false);
	});

	it("lists every scope's members in one pass", () => {
		const a = { ...scope([{ kind: "folder", path: "Projects/Garden" }]), id: "a" };
		const b = { ...scope([{ kind: "tag", tag: "#garden" }]), id: "b" };
		const m = members(
			[a, b],
			[note("Projects/Garden/Plan.md"), note("Daily/x.md", { tags: ["#garden"] }), note("Other.md")],
		);
		expect([...(m.get("a") ?? [])]).toEqual(["Projects/Garden/Plan.md"]);
		expect([...(m.get("b") ?? [])]).toEqual(["Daily/x.md"]);
	});
});
