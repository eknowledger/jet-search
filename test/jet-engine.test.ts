import { describe, expect, it } from "vitest";
import { fieldsFromMarkdown, type NoteInput } from "../src/engine/fields";
import { JetEngine } from "../src/engine/jet-engine";
import { parseQuery } from "../src/engine/query";
import { buildSegment, Segment } from "../src/engine/segment";
import { ByteWriter, readVarint } from "../src/engine/varint";

const note = (path: string, text: string, mtime = 0): NoteInput => ({ path, mtime, ...fieldsFromMarkdown(path, text) });
const paths = (e: JetEngine, q: string, now = 0): string[] => e.query(parseQuery(q), { now }).hits.map((h) => h.path);

const corpus = (): NoteInput[] => [
	note("Cobalt.md", "# Cobalt\nThe redesigned runtime with a light frame."),
	note("Pebble.md", "# Pebble\nThe runtime rebuild. Cobalt is related."),
	note("Notes/Lunch.md", "Sandwich and soup."),
	note("NebulaSDK.md", "# NebulaSDK\nThe SDK and its proxy."),
];
const engine = (notes = corpus()): JetEngine => {
	const e = new JetEngine();
	e.build(notes);
	return e;
};

describe("varint", () => {
	it("round-trips numbers of every size", () => {
		const w = new ByteWriter();
		const xs = [0, 1, 127, 128, 300, 16_383, 16_384, 2 ** 21, 2 ** 31 + 5, 2 ** 32 - 1];
		for (const x of xs) w.varint(x);
		const b = w.bytes();
		const at = { pos: 0 };
		expect(xs.map(() => readVarint(b, at))).toEqual(xs);
		expect(at.pos).toBe(b.length);
	});
});

describe("segment (index v4)", () => {
	it("stores sorted terms, postings and docs, and reads them back from one buffer", () => {
		const notes = corpus();
		const seg = new Segment(buildSegment(notes, () => 0));
		expect(seg.docCount).toBe(4);
		expect(seg.terms).toEqual([...seg.terms].sort());
		expect(seg.paths).toEqual(notes.map((n) => n.path));
		const t = seg.terms.indexOf("runtime");
		const docs: number[] = [];
		seg.forBody(t, (d) => docs.push(d));
		expect(docs).toEqual([0, 1]);
		expect(seg.names[3]).toBe("nebulasdk nebula sdk");
	});

	it("refuses a buffer that is not an index", () => {
		expect(() => new Segment(new ArrayBuffer(256))).toThrow();
	});
});

describe("Jet engine ranking", () => {
	it("ranks the note named by the query first", () => {
		expect(paths(engine(), "cobalt")).toEqual(["Cobalt.md", "Pebble.md"]);
	});

	it("needs every word when some note has them all, else any", () => {
		expect(paths(engine(), "runtime frame ")).toEqual(["Cobalt.md"]);
		expect(paths(engine(), "soup frame ").sort()).toEqual(["Cobalt.md", "Notes/Lunch.md"]);
	});

	it("excludes words after a minus", () => {
		expect(paths(engine(), "runtime -pebble")).toEqual(["Cobalt.md"]);
	});

	it("finds prefixes, one-letter typos and swapped letters", () => {
		const e = engine();
		expect(paths(e, "nebu")[0]).toBe("NebulaSDK.md");
		expect(paths(e, "nebulasdj ")[0]).toBe("NebulaSDK.md");
		expect(paths(e, "sandwhich ")[0]).toBe("Notes/Lunch.md");
		expect(paths(e, "nebual ")[0]).toBe("NebulaSDK.md");
	});

	it("puts exact matches above typo matches", () => {
		const e = engine([note("a.md", "the speech model"), note("b.md", "the speach model")]);
		const hits = e.query(parseQuery("speech ")).hits;
		expect(hits.map((h) => [h.path, h.edits])).toEqual([
			["a.md", 0],
			["b.md", 1],
		]);
	});

	it("lets a strong name match one typo away beat a weak exact match", () => {
		const e = engine([
			note("Lantern Atlas.md", "# Lantern Atlas\nThe lantern atlas reference."),
			note("Daily.md", "Someone wrote lanern once in a long daily note about other things entirely."),
		]);
		expect(paths(e, "lanern ")[0]).toBe("Lantern Atlas.md");
		const old = e.query(parseQuery("lanern "), { editsFirst: true }).hits.map((h) => h.path);
		expect(old[0]).toBe("Daily.md");
	});

	it("puts a note named for the words above one that only mentions them often", () => {
		const chatty = Array.from({ length: 40 }, () => "cobalt runtime cobalt runtime").join("\n");
		const e = engine([note("Cobalt.md", "# Cobalt\nThe runtime."), note("Daily.md", chatty)]);
		expect(paths(e, "cobalt runtime")).toEqual(["Cobalt.md", "Daily.md"]);
	});

	it("puts the note titled just the word above a longer title with it", () => {
		const e = engine([
			note("Willow.md", "The Willow program."),
			note("Part 2 — Atlas Willow Runtime Before and Around Lantern.md", "Willow willow willow, runtime notes."),
		]);
		expect(paths(e, "willow")[0]).toBe("Willow.md");
	});

	it("ranks a title starting with the query above one that only contains it", () => {
		const e = engine([
			note("Alfred to Launcher Migration.md", "launcher launcher launcher"),
			note("Launcher Setup Plan.md", "setup"),
		]);
		expect(paths(e, "launcher")[0]).toBe("Launcher Setup Plan.md");
	});

	it("boosts recent notes over equal older ones", () => {
		const now = 100 * 86_400_000;
		const e = engine([note("old.md", "topic", 0), note("new.md", "topic", now)]);
		expect(paths(e, "topic", now)).toEqual(["new.md", "old.md"]);
	});

	it("finds a word's compound part: nebula finds NebulaSDK", () => {
		expect(paths(engine(), "nebula ")).toContain("NebulaSDK.md");
	});

	it("keeps results to the allowed notes", () => {
		const hits = engine().query(parseQuery("runtime"), { allow: (p) => p.startsWith("P") }).hits;
		expect(hits.map((h) => h.path)).toEqual(["Pebble.md"]);
	});
});

describe("Jet engine updates (base, delta, tombstones)", () => {
	it("follows replaced, deleted and renamed notes", () => {
		const e = engine();
		e.upsert(note("Notes/Lunch.md", "Pasta today."));
		expect(paths(e, "sandwich ")).toEqual([]);
		expect(paths(e, "pasta ")).toEqual(["Notes/Lunch.md"]);
		e.rename("Notes/Lunch.md", "Notes/Dinner.md");
		expect(paths(e, "pasta ")).toEqual(["Notes/Dinner.md"]);
		e.rename("Cobalt.md", "Projects/Cobalt.md");
		expect(paths(e, "frame ")).toEqual(["Projects/Cobalt.md"]);
		e.delete("Notes/Dinner.md");
		expect(paths(e, "pasta ")).toEqual([]);
		expect(e.size).toBe(3);
	});

	it("adds new notes and finds them with the others", () => {
		const e = engine();
		e.upsert(note("Late.md", "cobalt arrives late"));
		expect(paths(e, "cobalt")).toEqual(expect.arrayContaining(["Cobalt.md", "Pebble.md", "Late.md"]));
		expect(paths(e, "late ")).toEqual(["Late.md"]);
	});

	it("saves and loads, base and changes", () => {
		const e = engine();
		e.upsert(note("Late.md", "cobalt arrives late"));
		e.delete("Notes/Lunch.md");
		const { base, sidecar } = e.save();
		const back = new JetEngine();
		back.load(base.slice(0), sidecar);
		expect(back.size).toBe(4);
		expect(paths(back, "late ")).toEqual(["Late.md"]);
		expect(paths(back, "sandwich ")).toEqual([]);
		expect(paths(back, "cobalt")[0]).toBe("Cobalt.md");
	});
});

describe("query parsing", () => {
	it("splits words, exclusions and phrases, and knows when the last word is still being typed", () => {
		expect(parseQuery('cobalt "light frame" -pebble')).toEqual({
			words: ["cobalt", "light", "frame"],
			excluded: ["pebble"],
			phrases: ["light frame"],
			lastIsPrefix: true,
		});
		expect(parseQuery("cobalt ").lastIsPrefix).toBe(false);
		expect(parseQuery("tag:followup #important").words).toEqual(["followup", "important"]);
	});
});
