import { describe, expect, it } from "vitest";
import { SearchIndex } from "../src/engine/search-index";
import { excerpt, noteFields, normalize, parseQuery, tokens, withinOneEdit } from "../src/engine/text";

describe("search text", () => {
	it("normalizes case and accents, and keeps words and numbers", () => {
		expect(normalize("Café ÉLAN")).toBe("cafe elan");
		expect(tokens("Speech-to-speech, v2 a 7 x")).toEqual(["speech", "to", "speech", "v2", "7"]);
	});

	it("reads a note's fields", () => {
		const f = noteFields(
			"2.Projects/Cobalt/Runtime Notes.md",
			"---\ntags: [book-club, cobalt]\n---\n# Thin frame\n## Sandbox\nBody with #speech tag and [link](http://x.y/z).",
		);
		expect(f.name).toEqual(["runtime", "notes"]);
		expect(f.folder).toEqual(["2", "projects", "cobalt"]);
		expect(f.h1).toEqual(["thin", "frame"]);
		expect(f.h2).toEqual(["sandbox"]);
		expect(f.tags).toEqual(expect.arrayContaining(["book", "club", "cobalt", "speech"]));
		expect(f.body).toContain("link");
		expect(f.body).not.toContain("http");
	});

	it("parses quoted phrases and exclusions", () => {
		expect(parseQuery('cobalt "light frame" -pebble')).toEqual({
			terms: ["cobalt", "light", "frame"],
			excluded: ["pebble"],
			phrases: ["light frame"],
		});
	});

	it("knows one edit from two", () => {
		expect(withinOneEdit("nebula", "nebual")).toBe(false);
		expect(withinOneEdit("nebula", "nebulaa")).toBe(true);
		expect(withinOneEdit("nebula", "nebla")).toBe(true);
		expect(withinOneEdit("nebula", "nebuka")).toBe(true);
		expect(withinOneEdit("abc", "abcde")).toBe(false);
	});

	it("cuts an excerpt around the first match, with marks", () => {
		const e = excerpt("---\nx: 1\n---\nintro\nThe NebulaSDK proxy forwards calls.", ["nebulasdk"]);
		expect(e?.text).toBe("The NebulaSDK proxy forwards calls.");
		expect(e?.marks).toEqual([[4, 13]]);
		expect(e?.line).toBe(4);
		expect(excerpt("nothing here", ["absent"])).toBeNull();
	});
});

const index = () => {
	const i = new SearchIndex();
	const add = (path: string, text: string, mtime = 0) => i.upsert(path, mtime, noteFields(path, text));
	add("Cobalt.md", "# Cobalt\nThe redesigned runtime with a light frame.");
	add("Pebble.md", "# Pebble\nThe runtime rebuild. Cobalt is related.");
	add("Notes/Lunch.md", "Sandwich and soup.");
	add("NebulaSDK.md", "# NebulaSDK\nThe SDK and its proxy.");
	return { i, add };
};

describe("search index", () => {
	it("ranks the note named by the query first", () => {
		const { i } = index();
		const hits = i.search(parseQuery("cobalt"));
		expect(hits.map((h) => h.path)).toEqual(["Cobalt.md", "Pebble.md"]);
	});

	it("needs every word when some note has them all, else any", () => {
		const { i } = index();
		expect(i.search(parseQuery("runtime frame")).map((h) => h.path)).toEqual(["Cobalt.md"]);
		expect(
			i
				.search(parseQuery("soup frame"))
				.map((h) => h.path)
				.sort(),
		).toEqual(["Cobalt.md", "Notes/Lunch.md"]);
	});

	it("excludes words after a minus", () => {
		const { i } = index();
		expect(i.search(parseQuery("runtime -pebble")).map((h) => h.path)).toEqual(["Cobalt.md"]);
	});

	it("finds prefixes and one-letter typos", () => {
		const { i } = index();
		expect(i.search(parseQuery("nebu"))[0]?.path).toBe("NebulaSDK.md");
		expect(i.search(parseQuery("nebulasdj"))[0]?.path).toBe("NebulaSDK.md");
		expect(i.search(parseQuery("sandwhich"))[0]?.path).toBe("Notes/Lunch.md");
	});

	it("follows replaced, removed and renamed notes", () => {
		const { i, add } = index();
		add("Notes/Lunch.md", "Pasta today.");
		expect(i.search(parseQuery("sandwich"))).toEqual([]);
		expect(i.search(parseQuery("pasta"))[0]?.path).toBe("Notes/Lunch.md");
		i.rename("Notes/Lunch.md", "Notes/Dinner.md");
		expect(i.search(parseQuery("pasta"))[0]?.path).toBe("Notes/Dinner.md");
		i.remove("Notes/Dinner.md");
		expect(i.search(parseQuery("pasta"))).toEqual([]);
		expect(i.size).toBe(3);
	});

	it("boosts recent notes over equal older ones", () => {
		const i = new SearchIndex();
		const now = 100 * 86_400_000;
		i.upsert("old.md", 0, noteFields("old.md", "topic"));
		i.upsert("new.md", now, noteFields("new.md", "topic"));
		expect(i.search(parseQuery("topic"), { now }).map((h) => h.path)).toEqual(["new.md", "old.md"]);
	});

	it("survives compaction and a save / load round trip", () => {
		const { i, add } = index();
		for (let n = 0; n < 100; n++) add(`tmp/${n}.md`, `filler ${n}`);
		for (let n = 0; n < 100; n++) i.remove(`tmp/${n}.md`);
		expect(i.size).toBe(4);
		const back = SearchIndex.deserialize(i.serialize());
		expect(back?.size).toBe(4);
		expect(back?.search(parseQuery("cobalt")).map((h) => h.path)).toEqual(["Cobalt.md", "Pebble.md"]);
		expect(back?.mtimeOf("Cobalt.md")).toBe(0);
	});

	it("refuses a buffer of another format", () => {
		expect(SearchIndex.deserialize(new ArrayBuffer(8))).toBeNull();
	});
});

describe("search ranking by field", () => {
	it("puts a note named for the words above one that only mentions them often", () => {
		const i = new SearchIndex();
		i.upsert("Cobalt.md", 0, noteFields("Cobalt.md", "# Cobalt\nThe runtime."));
		const chatty = Array.from({ length: 40 }, () => "cobalt runtime cobalt runtime").join("\n");
		i.upsert("Daily.md", 0, noteFields("Daily.md", chatty));
		expect(i.search(parseQuery("cobalt runtime")).map((h) => h.path)).toEqual(["Cobalt.md", "Daily.md"]);
	});
});

describe("search ranking by title length", () => {
	it("puts the note titled just the word above a longer title with it", () => {
		const i = new SearchIndex();
		i.upsert("Willow.md", 0, noteFields("Willow.md", "The Willow program."));
		i.upsert(
			"Part 2 — Atlas Willow Runtime Before and Around Lantern.md",
			0,
			noteFields(
				"Part 2 — Atlas Willow Runtime Before and Around Lantern.md",
				"Willow willow willow, runtime notes.",
			),
		);
		expect(i.search(parseQuery("willow"))[0]?.path).toBe("Willow.md");
	});
});

describe("search title boosts", () => {
	it("ranks a title starting with the query above one that only contains it", () => {
		const i = new SearchIndex();
		i.upsert(
			"Alfred to Launcher Migration.md",
			0,
			noteFields("Alfred to Launcher Migration.md", "launcher launcher launcher"),
		);
		i.upsert("Launcher Setup Plan.md", 0, noteFields("Launcher Setup Plan.md", "setup"));
		expect(i.search(parseQuery("launcher"))[0]?.path).toBe("Launcher Setup Plan.md");
	});
});

describe("search index memory forms", () => {
	it("searches the same after freezing, loading, and changes on top", () => {
		const { i, add } = index();
		i.freeze();
		expect(i.search(parseQuery("cobalt")).map((h) => h.path)).toEqual(["Cobalt.md", "Pebble.md"]);
		const back = SearchIndex.deserialize(i.serialize()) as SearchIndex;
		back.upsert("Late.md", 0, noteFields("Late.md", "cobalt arrives late"));
		expect(back.search(parseQuery("cobalt")).map((h) => h.path)).toContain("Late.md");
		back.freeze();
		expect(back.search(parseQuery("late"))[0]?.path).toBe("Late.md");
		void add;
	});
});

describe("search typos as prefixes", () => {
	it("corrects a swapped pair and extends it as a prefix", () => {
		const i = new SearchIndex();
		i.upsert("NebulaSDK — Setup.md", 0, noteFields("NebulaSDK — Setup.md", "The SDK."));
		i.upsert("Other.md", 0, noteFields("Other.md", "nebula colours"));
		const top = i.search(parseQuery("nebual")).map((h) => h.path);
		expect(top).toContain("NebulaSDK — Setup.md");
	});
});
