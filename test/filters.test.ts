import { describe, expect, it } from "vitest";
import { type FilterFacts, filterLabel, filterText, findFilters, passes, withoutPieces } from "../src/filters/filter";

const KNOWN = new Set(["status", "type", "project", "area", "date"]);
const known = (k: string) => KNOWN.has(k.toLowerCase());
const kinds = (t: string) => findFilters(t, known).map((f) => [f.filter.kind, f.complete]);

const NOW = Date.parse("2026-10-08T12:00:00Z");
const note = (over: Partial<FilterFacts> = {}): FilterFacts => ({
	path: "2.Projects/Cobalt/Plan.md",
	props: { status: "draft", type: ["ai note", "plan"], project: "[[Cobalt]]", date: "2026-10-01" },
	links: { project: ["2.Projects/Cobalt/Cobalt.md"] },
	tags: ["#cobalt/expert", "#book-club"],
	mtime: NOW - 2 * 86_400_000,
	ctime: NOW - 40 * 86_400_000,
	outgoing: ["2.Projects/Cobalt/Cobalt.md"],
	...over,
});

describe("filters in the text", () => {
	it("finds each form, finished once a space, bracket or quote ends it", () => {
		expect(kinds("status:draft ")).toEqual([["prop", true]]);
		expect(kinds("status:dra")).toEqual([["prop", false]]);
		expect(kinds("#cobalt world")).toEqual([["tag", true]]);
		expect(kinds("[type:ai note]")).toEqual([["prop", true]]);
		expect(kinds('type:"ai note"')).toEqual([["prop", true]]);
		expect(kinds("path:5.Journal edited:7d ")).toEqual([
			["path", true],
			["edited", true],
		]);
		expect(kinds("links:[[Cobalt]]")).toEqual([["links", true]]);
		expect(kinds("date>2026-01-01 has:link ")).toEqual([
			["date", true],
			["haslink", true],
		]);
	});

	it("an unknown key, a time, a link or a scope form stays text", () => {
		expect(kinds("meeting 10:30 ")).toEqual([]);
		expect(kinds("see https://example.com ")).toEqual([]);
		expect(kinds("colour:blue ")).toEqual([]);
		expect(kinds("in:cobalt ")).toEqual([]);
		expect(kinds("edited:soon ")).toEqual([]);
	});

	it("the text without the filters' pieces", () => {
		const t = "status:draft world #cobalt state";
		expect(withoutPieces(t, findFilters(t, known))).toBe("garden plan");
	});

	it("labels and text for chips", () => {
		const [p] = findFilters("edited:2w ", known);
		expect(p?.filter).toEqual({ kind: "edited", days: 14 });
		expect(p && filterLabel(p.filter)).toEqual(["edited", "past 14 days"]);
		expect(p && filterText(p.filter)).toBe("edited:14d");
		expect(filterText({ kind: "prop", key: "type", value: "ai note" })).toBe('type:"ai note"');
	});
});

describe("which notes a filter keeps", () => {
	it("properties: any list element, case and accents folded; a link by its target or its name", () => {
		expect(passes({ kind: "prop", key: "Status", value: "Draft" }, note(), NOW)).toBe(true);
		expect(passes({ kind: "prop", key: "type", value: "plan" }, note(), NOW)).toBe(true);
		expect(passes({ kind: "prop", key: "status", value: "done" }, note(), NOW)).toBe(false);
		expect(passes({ kind: "prop", key: "project", value: "cobalt" }, note(), NOW)).toBe(true);
		expect(
			passes(
				{ kind: "prop", key: "project", value: "Cobalt Project", target: "2.Projects/Cobalt/Cobalt.md" },
				note(),
				NOW,
			),
		).toBe(true);
	});

	it("tags with nested ones, folders, edit and creation windows, dates, links", () => {
		expect(passes({ kind: "tag", tag: "#cobalt" }, note(), NOW)).toBe(true);
		expect(passes({ kind: "tag", tag: "#cob" }, note(), NOW)).toBe(false);
		expect(passes({ kind: "path", prefix: "2.projects/cobalt" }, note(), NOW)).toBe(true);
		expect(passes({ kind: "edited", days: 7 }, note(), NOW)).toBe(true);
		expect(passes({ kind: "edited", days: 1 }, note(), NOW)).toBe(false);
		expect(passes({ kind: "created", days: 30 }, note(), NOW)).toBe(true);
		expect(passes({ kind: "created", days: 30 }, note({ props: {} }), NOW)).toBe(false);
		expect(passes({ kind: "date", op: ">", date: "2026-09-30" }, note(), NOW)).toBe(true);
		expect(passes({ kind: "date", op: "<", date: "2026-09-30" }, note(), NOW)).toBe(false);
		expect(passes({ kind: "links", name: "Cobalt", target: "2.Projects/Cobalt/Cobalt.md" }, note(), NOW)).toBe(
			true,
		);
		expect(passes({ kind: "haslink" }, note({ outgoing: [] }), NOW)).toBe(false);
	});
});
