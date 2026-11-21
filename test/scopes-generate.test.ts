// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeVault, SHAPES } from "../bench/fixtures/make-vaults.mjs";
import { readSnapshot } from "../bench/vault-snapshot.spec";
import { type Generated, generate, support } from "../src/scopes/generate";
import type { Rule } from "../src/scopes/model";

type ExpectedRule = { kind: "folder" | "property" | "tag"; key?: string; value: string; count: number };
type Expected = { scopes: Array<{ name: string; rules: ExpectedRule[]; members: number }> };

let root = "";
const runs = new Map<string, { expected: Expected; got: Generated }>();

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "jet-generate-"));
	for (const shape of SHAPES as string[]) {
		const dir = join(root, shape);
		(makeVault as (s: string, d: string) => unknown)(shape, dir);
		const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")) as Expected;
		runs.set(shape, { expected, got: generate(readSnapshot(dir)) });
	}
});

afterAll(() => {
	if (root) rmSync(root, { recursive: true, force: true });
});

/** A rule as the fixtures write it: folder path, property value ([[X]] for a link) or #tag. */
const asExpected = (r: Rule): string =>
	r.kind === "folder"
		? `folder ${r.path}`
		: r.kind === "tag"
			? `tag ${r.tag.toLowerCase()}`
			: `property ${r.key} ${"target" in r ? (r.target.split("/").pop() ?? "").replace(/\.md$/, "").toLowerCase() : r.value.toLowerCase()}`;
const fromExpected = (r: ExpectedRule): string =>
	r.kind === "property"
		? `property ${r.key} ${r.value
				.replace(/^\[\[|\]\]$/g, "")
				.split("|")[0]
				?.split("/")
				.pop()
				?.toLowerCase()}`
		: r.kind === "tag"
			? `tag ${r.value.toLowerCase()}`
			: `folder ${r.value}`;

describe("the scope generator on every fixture shape", () => {
	it("S(N) scales: 10 at 200 notes, 73 at 1,450, 100 at 15k", () => {
		expect([support(200), support(1450), support(15000)]).toEqual([10, 73, 100]);
	});

	it.each(SHAPES as string[])(
		"%s: the ticked proposals are the expected scopes, with their rules and members",
		(shape) => {
			const run = runs.get(shape);
			if (!run) throw new Error(shape);
			const ticked = run.got.proposals.filter((p) => p.ticked);
			const want = run.expected.scopes;
			expect(ticked.map((p) => p.name).sort()).toEqual(want.map((s) => s.name).sort());
			for (const s of want) {
				const p = ticked.find((x) => x.name === s.name);
				expect(p?.members, `${shape}: ${s.name} members`).toBe(s.members);
				expect(p?.rules.map((r) => asExpected(r.rule)).sort(), `${shape}: ${s.name} rules`).toEqual(
					s.rules.map(fromExpected).sort(),
				);
			}
		},
	);
});
