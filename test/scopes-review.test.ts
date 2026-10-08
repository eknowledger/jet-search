import { describe, expect, it } from "vitest";
import type { Proposal } from "../src/scopes/generate";
import type { Rule, Scope } from "../src/scopes/model";
import { applyReview, review } from "../src/scopes/review";

const proposal = (name: string, key: string, rules: Rule[], extra: Partial<Proposal> = {}): Proposal => ({
	id: `p-${name}`,
	name,
	aliases: [],
	kind: "Projects",
	group: "Subfolders of Projects",
	rules: rules.map((rule) => ({ rule, count: 9 })),
	members: 9,
	ticked: true,
	untick: [],
	origins: [{ signal: "container-folder", at: "Projects", key, v: 1 }],
	...extra,
});
const folder = (path: string): Rule => ({ kind: "folder", path });
const tag = (t: string): Rule => ({ kind: "tag", tag: t });

const accepted = (p: Proposal): Scope => ({
	id: p.id,
	name: p.name,
	aliases: [],
	kind: p.kind,
	rules: p.rules.map((r) => r.rule),
	combine: "any",
	mode: "suggest",
	source: "generated",
	origins: p.origins,
	generated: p.rules.map((r) => r.rule),
});

describe("generating again: new, changed, gone", () => {
	it("the first time, every proposal is new, ticked as proposed", () => {
		const items = review(
			[
				proposal("Garden", "Projects/Garden", [folder("Projects/Garden")]),
				proposal("Lyon", "Projects/Lyon", [folder("Projects/Lyon")], { ticked: false }),
			],
			[],
		);
		expect(items.map((i) => [i.state, i.ticked])).toEqual([
			["new", true],
			["new", false],
		]);
		const scopes = applyReview(items, []);
		expect(scopes.map((s) => [s.name, s.source, s.origins?.[0]?.key])).toEqual([
			["Garden", "generated", "Projects/Garden"],
		]);
	});

	it("later: a new folder is new, a gained rule is a change, a vanished source is gone, the rest is counted", () => {
		const garden = proposal("Garden", "Projects/Garden", [folder("Projects/Garden")]);
		const kept = proposal("Kept", "Projects/Kept", [folder("Projects/Kept")]);
		const old = proposal("Old", "Projects/Old", [folder("Projects/Old")]);
		const mine = { ...accepted(garden), name: "My garden", mode: "auto" as const };
		const scopes = [mine, accepted(kept), accepted(old)];
		const items = review(
			[
				proposal("Garden", "Projects/Garden", [folder("Projects/Garden"), tag("#garden")]),
				kept,
				proposal("Orion", "Projects/Orion", [folder("Projects/Orion")]),
			],
			scopes,
		);
		const by = (state: string) => items.filter((i) => i.state === state);
		expect(by("new").map((i) => i.proposal?.name)).toEqual(["Orion"]);
		expect(by("changed").map((i) => [i.scope?.name, i.addRules])).toEqual([["My garden", [tag("#garden")]]]);
		expect(by("gone").map((i) => [i.scope?.name, i.ticked])).toEqual([["Old", false]]);
		expect(by("unchanged").map((i) => i.scope?.name)).toEqual(["Kept"]);
		const after = applyReview(items, scopes);
		// Your edits (name, mode) stay; the new rule joins; the gone scope stays until you tick it.
		expect(after.find((s) => s.id === mine.id)).toMatchObject({
			name: "My garden",
			mode: "auto",
			rules: [folder("Projects/Garden"), tag("#garden")],
		});
		expect(after.map((s) => s.name)).toEqual(["My garden", "Kept", "Old", "Orion"]);
	});

	it("never undoes a rule you removed, and does not propose what a scope of yours already covers", () => {
		const garden = proposal("Garden", "Projects/Garden", [folder("Projects/Garden"), tag("#garden")]);
		const edited = { ...accepted(garden), rules: [folder("Projects/Garden")] };
		const manual: Scope = {
			id: "m",
			name: "Lyon",
			aliases: ["ly"],
			kind: "",
			rules: [tag("#lyon")],
			combine: "any",
			mode: "suggest",
			source: "manual",
		};
		const items = review([garden, proposal("Lyon", "Projects/Lyon", [folder("Projects/Lyon")])], [edited, manual]);
		expect(items.find((i) => i.scope?.id === edited.id)?.state).toBe("unchanged");
		expect(items.find((i) => i.proposal?.name === "Lyon")?.state).toBe("covered");
	});

	it("ticking a gone scope removes it", () => {
		const old = proposal("Old", "Projects/Old", [folder("Projects/Old")]);
		const items = review([], [accepted(old)]);
		const gone = items.find((i) => i.state === "gone");
		if (gone) gone.ticked = true;
		expect(applyReview(items, [accepted(old)])).toEqual([]);
	});
});
