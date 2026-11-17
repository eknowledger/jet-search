import { describe, expect, it } from "vitest";
import type { Hit } from "../src/engine/jet-engine";
import { SEQUENCE_CHECK_LIMIT, SEQUENCE_SCAN, boostSequences, filterPhrases, quotedPhrases } from "../src/rank";

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

	it("reads only the first hits, and leaves the rest as they were", async () => {
		const hits = Array.from({ length: SEQUENCE_CHECK_LIMIT + 5 }, (_, i) => hit(`n${i}.md`, 10 - i * 0.01));
		const asked: string[] = [];
		const out = await boostSequences(hits, "garden plan", (p) => {
			asked.push(p);
			return Promise.resolve(p === `n${SEQUENCE_CHECK_LIMIT + 2}.md` ? "garden plan" : "nothing");
		});
		expect(asked).toHaveLength(SEQUENCE_CHECK_LIMIT);
		// A note past the limit with the words in order is not looked at, so it is not lifted.
		expect(out.map((h) => h.path)).toEqual(hits.map((h) => h.path));
	});

	it("reads nothing for one typed word, even one the index cuts in several parts", async () => {
		const asked: string[] = [];
		const read = (p: string): Promise<string | null> => {
			asked.push(p);
			return Promise.resolve("北京大学");
		};
		await boostSequences([hit("a.md", 1, 1)], "北京大学", read);
		await boostSequences([hit("a.md", 1, 1)], "plan -draft", read);
		expect(asked).toEqual([]);
	});

	it("looks only as far into a long note as the scan limit", async () => {
		const far = `${"filler ".repeat(Math.ceil(SEQUENCE_SCAN / 7) + 10)}garden plan`;
		const hits = [hit("a.md", 3), hit("b.md", 2)];
		const text = (p: string): Promise<string> => Promise.resolve(p === "b.md" ? far : "elsewhere");
		expect((await boostSequences(hits, "garden plan", text)).map((h) => h.path)).toEqual(["a.md", "b.md"]);
	});

	it("never lifts a note above one that matches more words", async () => {
		const hits = [hit("a.md", 1, 3), hit("b.md", 5, 2)];
		expect((await boostSequences(hits, "garden plan", read)).map((h) => h.path)).toEqual(["a.md", "b.md"]);
	});
});
