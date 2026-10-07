import { describe, expect, it } from "vitest";
import { MetaIndex, type MetaNote } from "../src/tier0/meta";

const notes: MetaNote[] = [
	{
		path: "Projects/Garden.md",
		fields: [
			{ kind: "heading", text: "Watering schedule" },
			{ kind: "heading", text: "Soil and compost" },
			{ kind: "tag", text: "#outdoors" },
		],
	},
	{
		path: "Trips/Lyon.md",
		fields: [
			{ kind: "heading", text: "Fête des Lumières" },
			{ kind: "property", text: "status: planned" },
		],
	},
	{
		path: "Notes/Reading.md",
		fields: [
			{ kind: "property", text: "status: reading" },
			{ kind: "tag", text: "#books/fiction" },
		],
	},
	{ path: "Japan.md", fields: [{ kind: "heading", text: "京都の紅葉" }] },
];

const paths = (index: MetaIndex, q: string): string[] => index.match(q).map((h) => h.path);

describe("metadata search before the index", () => {
	it("finds a note by a heading, a tag or a property, words starting where typed", () => {
		const index = new MetaIndex(notes);
		expect(paths(index, "watering")).toEqual(["Projects/Garden.md"]);
		expect(paths(index, "outdo")).toEqual(["Projects/Garden.md"]);
		expect(paths(index, "fiction")).toEqual(["Notes/Reading.md"]);
		expect(paths(index, "planned")).toEqual(["Trips/Lyon.md"]);
		// Inside a word is not a word start.
		expect(paths(index, "atering")).toEqual([]);
	});

	it("needs every word in one field, in any order", () => {
		const index = new MetaIndex(notes);
		expect(paths(index, "compost soil")).toEqual(["Projects/Garden.md"]);
		expect(paths(index, "soil watering")).toEqual([]);
		expect(paths(index, "status reading")).toEqual(["Notes/Reading.md"]);
	});

	it("folds case and accents, and matches Chinese and Japanese anywhere", () => {
		const index = new MetaIndex(notes);
		expect(paths(index, "fete lumieres")).toEqual(["Trips/Lyon.md"]);
		expect(paths(index, "FÊTE")).toEqual(["Trips/Lyon.md"]);
		expect(paths(index, "紅葉")).toEqual(["Japan.md"]);
	});

	it("ranks headings above tags and properties, one hit per note, with marks on the words", () => {
		const index = new MetaIndex([
			{ path: "a.md", fields: [{ kind: "property", text: "topic: compost" }] },
			{
				path: "b.md",
				fields: [
					{ kind: "heading", text: "Compost bins" },
					{ kind: "tag", text: "#compost" },
				],
			},
		]);
		const hits = index.match("compost");
		expect(hits.map((h) => h.path)).toEqual(["b.md", "a.md"]);
		expect(hits[0]?.field.text).toBe("Compost bins");
		expect(hits[0]?.marks).toEqual([[0, 7]]);
		expect(hits[1]?.marks).toEqual([[7, 14]]);
	});

	it("answers nothing for an empty query and keeps to the limit", () => {
		const many: MetaNote[] = Array.from({ length: 60 }, (_, i) => ({
			path: `n${i}.md`,
			fields: [{ kind: "heading", text: `Weekly review ${i}` }],
		}));
		const index = new MetaIndex(many);
		expect(index.match("  ")).toEqual([]);
		// One letter is in every note; the names answer it.
		expect(index.match("w")).toEqual([]);
		expect(index.match("weekly", { limit: 20 })).toHaveLength(20);
	});

	it("keeps to the allowed notes", () => {
		const index = new MetaIndex(notes);
		expect(index.match("status", { allow: (p) => p.startsWith("Notes/") }).map((h) => h.path)).toEqual([
			"Notes/Reading.md",
		]);
	});
});
