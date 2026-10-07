import { describe, expect, it } from "vitest";
import type { Hit } from "../src/engine/jet-engine";
import { boostSequences, filterPhrases, quotedPhrases } from "../src/rank";

const hit = (path: string, score: number, matched = 2): Hit => ({ path, score, matched, edits: 0 });
const texts: Record<string, string> = {
	"a.md": "The world model and the state of play.",
	"b.md": "Where the garden plan is kept, by scenario.",
	"c.md": "state of the world, said differently",
};
const read = (p: string) => Promise.resolve(texts[p] ?? null);

describe("phrases", () => {
	it("reads the quoted phrases of a query", () => {
		expect(quotedPhrases('"garden plan" scenario "x"')).toEqual(["garden plan"]);
		expect(quotedPhrases('nothing "" here')).toEqual([]);
	});

	it("keeps the hits whose text has every quoted phrase, in rank order", async () => {
		const hits = [hit("a.md", 3), hit("b.md", 2), hit("c.md", 1)];
		expect((await filterPhrases(hits, ["garden plan"], read)).map((h) => h.path)).toEqual(["b.md"]);
		expect((await filterPhrases(hits, [], read)).map((h) => h.path)).toEqual(["a.md", "b.md", "c.md"]);
	});

	it("ranks notes with the words in order above notes that only contain them", async () => {
		const hits = [hit("a.md", 3), hit("b.md", 2.5), hit("c.md", 1)];
		expect((await boostSequences(hits, "garden plan", read)).map((h) => h.path)).toEqual(["b.md", "a.md", "c.md"]);
		expect((await boostSequences(hits, "world", read)).map((h) => h.path)).toEqual(["a.md", "b.md", "c.md"]);
		expect((await boostSequences(hits, '"garden plan"', read)).map((h) => h.path)).toEqual([
			"a.md",
			"b.md",
			"c.md",
		]);
	});

	it("never lifts a note above one that matches more words", async () => {
		const hits = [hit("a.md", 1, 3), hit("b.md", 5, 2)];
		expect((await boostSequences(hits, "garden plan", read)).map((h) => h.path)).toEqual(["a.md", "b.md"]);
	});
});
