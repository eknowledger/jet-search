import { describe, expect, it } from "vitest";
import { editDistance, findFix, pieceAt, wantOf } from "../src/filters/complete";

const known = (k: string) => ["status", "type", "project"].includes(k.toLowerCase());
const KEYS: Array<[string, number]> = [
	["status", 173],
	["type", 530],
	["project", 400],
	["stats", 3],
];

describe("completing filters", () => {
	it("the piece at the caret", () => {
		expect(pieceAt("world status:dr more", 15)).toEqual({ from: 6, to: 15, piece: "status:dr" });
		expect(pieceAt("#ca", 3).piece).toBe("#ca");
	});

	it("what each piece lists", () => {
		expect(wantOf("#cob", known)).toEqual({ kind: "tags", prefix: "cob" });
		expect(wantOf("tag:ai", known)).toEqual({ kind: "tags", prefix: "ai" });
		expect(wantOf("status:", known)).toEqual({ kind: "values", key: "status", prefix: "" });
		expect(wantOf('type:"ai n', known)).toEqual({ kind: "values", key: "type", prefix: "ai n" });
		expect(wantOf("sta:", known)).toEqual({ kind: "keys", prefix: "sta" });
		expect(wantOf("edited:", known)).toEqual({ kind: "windows" });
		expect(wantOf("path:2.Pro", known)).toEqual({ kind: "folders", prefix: "2.Pro" });
		expect(wantOf("world", known)).toBeNull();
		expect(wantOf("in:cob", known)).toEqual({ kind: "scopes", prefix: "cob" });
		expect(wantOf("@ca", known)).toEqual({ kind: "scopes", prefix: "ca" });
		expect(wantOf("10:30", known)).toBeNull();
	});
});

describe("fix-it for an unknown key", () => {
	it("edit distance with swaps", () => {
		expect(editDistance("stauts", "status")).toBe(1);
		expect(editDistance("stat", "status")).toBe(2);
		expect(editDistance("colour", "status")).toBe(3);
	});

	it("offers the nearest used key, then the most used; never for a known, built-in or short key", () => {
		expect(findFix("in cobalt stauts:draft", KEYS, known)).toEqual({
			from: 10,
			to: 22,
			wrong: "stauts",
			key: "status",
			value: "draft",
		});
		expect(findFix("projetc:Cobalt", KEYS, known)?.key).toBe("project");
		expect(findFix("status:draft", KEYS, known)).toBeNull();
		// Obsidian Search's own operators are never "fixed" (task:review offered tags:).
		for (const op of [
			"task:review",
			"task-todo:x",
			"line:foo",
			"section:bar",
			"block:baz",
			"file:x",
			"content:y",
			"match-case:z",
		])
			expect(findFix(op, [...KEYS, ["tags", 829]], known)).toBeNull();
		expect(findFix("tpye:x", KEYS, known)?.key).toBe("type");
		expect(findFix("typ:x", KEYS, known)).toBeNull();
		expect(findFix("https://example.com", KEYS, known)).toBeNull();
		expect(findFix("colour:blue", KEYS, known)).toBeNull();
	});
});
