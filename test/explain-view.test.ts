import { describe, expect, it } from "vitest";
import { fieldsFromMarkdown, type NoteInput } from "../src/engine/fields";
import { JetEngine } from "../src/engine/jet-engine";
import { parseQuery } from "../src/engine/query";
import type { MeaningExplanation } from "../src/meaning/explain";
import {
	type Context,
	noteView,
	realNames,
	searchView,
	tagNames,
	viewLines,
	type NoteContext,
} from "../src/explain/view";

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;
const note = (path: string, text: string, age = 100): NoteInput => ({
	path,
	mtime: NOW - age * DAY,
	...fieldsFromMarkdown(path, text),
});
const engine = (): JetEngine => {
	const e = new JetEngine();
	e.build([
		note(
			"Projects/Walnut kiosk pilot.md",
			"# Walnut kiosk pilot\nThe walnut panels arrive after the kiosk frame.",
			3,
		),
		note("Projects/Kiosk cabinet build.md", "Sand the walnut and oil the kiosk cabinet.", 14),
		note("Projects/Kiosk rollout.md", "The kiosk goes to six shops.", 20),
		note("Journal/Lunch.md", "Sandwich and soup."),
	]);
	return e;
};
const ctx = (over: Partial<Context> = {}): Context => ({
	text: "walnut kiosk",
	mode: "words",
	scoped: false,
	scopeNames: [],
	filters: 0,
	filterItems: [],
	titleOnly: false,
	sort: "Best match",
	byRelevance: true,
	limit: 50,
	building: null,
	...over,
});
const nc = (over: Partial<NoteContext> = {}): NoteContext => ({
	name: "Kiosk rollout",
	excluded: false,
	inScope: null,
	passesFilters: null,
	phrase: null,
	shown: null,
	...over,
});
const words = (text: string, path: string | null, allow?: (p: string) => boolean) =>
	engine().explain(parseQuery(text), path, { limit: 50, now: NOW, allow });

describe("explaining the search", () => {
	it("says the rule: notes with every word are listed, the others are not", () => {
		const v = searchView(ctx(), words("walnut kiosk", null));
		expect(v.head).toBe("2 notes hold every word, so only those are listed.");
		expect(v.detail).toMatch(/only some of the words/);
		expect(v.setup).toEqual([
			["Searched", "by words"],
			["Where", "everywhere"],
			["Filters", "none"],
			["Order", "best match, top 50 listed"],
		]);
		expect(v.tables[0]?.rows).toHaveLength(2);
		expect(v.tables[0]?.rows[1]?.[0]).toEqual({ text: "kiosk", note: "last word" });
		expect(v.tables[0]?.cards).toBe(true);
		// How the search was set is kept apart from the notes.
		expect(v.notes.join(" ")).not.toMatch(/no scope|everywhere/);
	});

	it("says when no note holds every word", () => {
		const v = searchView(ctx({ text: "walnut soup" }), words("walnut soup", null));
		expect(v.head).toBe("No note holds every word, so notes with some of them are listed.");
	});

	it("says when no note holds the words at all", () => {
		const v = searchView(ctx({ text: "qwertyz" }), words("qwertyz", null));
		expect(v.head).toBe("No note holds these words.");
		expect(v.tone).toBe("warn");
		expect(v.detail).toContain('"qwertyz"');
	});

	it("says the exclusions, and what the scope and filters are", () => {
		const v = searchView(
			ctx({ scoped: true, filters: 2, sort: "Newest first", byRelevance: false }),
			words("kiosk -cabinet", null),
		);
		expect(v.notes[0]).toBe("Notes with -cabinet are left out.");
		const set = Object.fromEntries(v.setup);
		expect(set.Where).toBe("in a scope");
		expect(set.Order).toBe("newest first, top 50 listed");
	});
});

describe("explaining a note", () => {
	it("says where a listed note ranks, and what moved it", () => {
		const v = noteView(
			ctx(),
			words("walnut kiosk", "Projects/Walnut kiosk pilot.md"),
			nc({ name: "Walnut kiosk pilot" }),
		);
		expect(v.tone).toBe("ok");
		expect(v.head).toBe("Ranked 1 of 2.");
		expect(v.detail).toBe("It holds every word.");
		const moved = v.tables.find((t) => t.title === "What moved it");
		expect(moved?.rows.map((r) => r[0]?.text)).toContain("The name starts with the search");
		expect(moved?.rows.map((r) => r[0]?.text)).toContain("Edited 3 days ago");
	});

	it("says a note with only some of the words is left out because others hold them all", () => {
		const v = noteView(ctx(), words("walnut kiosk", "Projects/Kiosk rollout.md"), nc());
		expect(v.tone).toBe("warn");
		expect(v.head).toBe('Left out: it has "kiosk" but not "walnut".');
		expect(v.detail).toBe("2 notes hold every word, so notes with only some are dropped.");
		const rows = v.tables[0]?.rows ?? [];
		expect(rows[0]?.[1]).toEqual({ text: "not found", pill: "no" });
		expect(rows[1]?.[1]?.pill).toBe("ok");
		expect(v.notes).toContain("The note is indexed and not excluded.");
	});

	it("says a note with none of the words holds none", () => {
		const v = noteView(ctx(), words("walnut kiosk", "Journal/Lunch.md"), nc({ name: "Lunch" }));
		expect(v.head).toBe("Left out: it holds none of the words.");
	});

	it("says the first reason, in order: exclude rule, not indexed, scope, filters", () => {
		const r = words("walnut kiosk", "Projects/Kiosk rollout.md");
		expect(noteView(ctx(), r, nc({ excluded: true })).head).toMatch(/exclude rule/);
		const gone = words("walnut kiosk", "Elsewhere/New.md");
		expect(noteView(ctx(), gone, nc()).head).toBe("Left out: Jet has not indexed this note yet.");
		expect(noteView(ctx({ building: { done: 120, total: 1400 } }), gone, nc()).detail).toMatch(/120 of 1,400/);
		expect(noteView(ctx(), r, nc({ inScope: false })).head).toMatch(/outside the scope/);
		expect(noteView(ctx(), r, nc({ inScope: true, passesFilters: false })).head).toMatch(/filters do not keep/);
		const out = words("walnut kiosk", "Projects/Kiosk rollout.md", () => false);
		expect(noteView(ctx(), out, nc()).head).toMatch(/outside the scope or filters/);
	});

	it("says a note with an excluded word is dropped for it", () => {
		const v = noteView(
			ctx({ text: "kiosk -cabinet" }),
			words("kiosk -cabinet", "Projects/Kiosk cabinet build.md"),
			nc(),
		);
		expect(v.head).toBe('Left out: it has "cabinet", which the search excludes.');
	});

	it("says a note without the quoted phrase is left out for it", () => {
		const v = noteView(ctx(), words("walnut kiosk", "Projects/Walnut kiosk pilot.md"), nc({ phrase: false }));
		expect(v.head).toBe("Left out: it does not hold the quoted phrase.");
	});

	it("says the rank is by relevance when the window lists in another order", () => {
		const r = words("walnut kiosk", "Projects/Walnut kiosk pilot.md");
		const v = noteView(ctx({ sort: "Last edited: newest first", byRelevance: false }), r, nc());
		expect(v.notes.join(" ")).toContain("not its place in the list");
		expect(noteView(ctx(), r, nc()).notes.join(" ")).not.toContain("not its place");
	});

	it("says a note listed by its name, which the text search does not list, is listed by its name", () => {
		const r = words("walnut kiosk", "Projects/Kiosk rollout.md");
		const v = noteView(ctx(), r, nc({ shown: "Titles" }));
		expect(v.tone).toBe("ok");
		expect(v.head).toBe('Listed under "Titles", not by the text.');
		expect(noteView(ctx(), r, nc({ shown: "Answers" })).detail).toMatch(/another way/);
		// A note the text search does list is explained by its rank, wherever it is shown.
		const x = noteView(ctx(), words("walnut kiosk", "Projects/Walnut kiosk pilot.md"), nc({ shown: "Titles" }));
		expect(x.head).toMatch(/^Ranked 1 of/);
	});

	it("says a note below the cut is below it", () => {
		const r = words("walnut kiosk", "Projects/Walnut kiosk pilot.md");
		const v = noteView(ctx({ limit: 0 }), { ...r, list: { ...r.list, limit: 0 } }, nc());
		expect(v.head).toMatch(/^Below the cut: ranked 1, and Jet lists the top 0/);
	});
});

describe("explaining by meaning", () => {
	const base = (over: Partial<MeaningExplanation> = {}): MeaningExplanation => ({
		kind: "meaning",
		on: true,
		model: "tiny",
		vectors: { have: 98, indexed: 100 },
		understood: true,
		list: { scored: 98, k: 50, best: 0.78, cut: 0.52 },
		note: { indexed: true, allowed: true, vector: "yes", rank: 2, score: 0.71 },
		...over,
	});
	const c = ctx({ mode: "meaning", text: "how do I finish the cabinet" });

	it("says where a note is, and how close", () => {
		const v = noteView(c, base(), nc());
		expect(v.tone).toBe("ok");
		expect(v.head).toBe("Ranked 2 of 50, close in meaning.");
		expect(v.detail).toBe("Its closeness is 0.71; the last listed is at 0.52.");
	});

	it("says a far note is too far, and a note without its meaning is waiting", () => {
		const far = noteView(
			c,
			base({ note: { indexed: true, allowed: true, vector: "yes", rank: 212, score: 0.31 } }),
			nc(),
		);
		expect(far.head).toBe("Not listed: it is too far from the question.");
		expect(far.detail).toContain("Ranked 212");
		const wait = noteView(
			c,
			base({ note: { indexed: true, allowed: true, vector: "waiting", rank: null, score: null } }),
			nc(),
		);
		expect(wait.head).toBe("Not listed: its meaning has not been read yet.");
		expect(wait.detail).toBe("2 notes still wait for it. Jet reads them in the background.");
		const none = noteView(
			c,
			base({ note: { indexed: true, allowed: true, vector: "none", rank: null, score: null } }),
			nc(),
		);
		expect(none.head).toBe("Not listed: the model knows no word of this note.");
	});

	it("says meaning is not ready, or that the question is not understood", () => {
		expect(noteView(c, base({ on: false }), nc()).head).toBe("Search by meaning is not ready.");
		expect(searchView(c, base({ on: false })).head).toBe("Search by meaning is not ready.");
		const v = searchView(c, base({ understood: false }));
		expect(v.head).toBe("The model knows none of the words of this search.");
	});

	it("says what the search lists, and the model", () => {
		const v = searchView(c, base());
		expect(v.head).toBe("50 notes listed, the closest first.");
		expect(v.tables[0]?.rows[1]?.[1]?.text).toBe("98 of 100");
	});
});

describe("what a report may hold", () => {
	it("shows tags instead of the words and the note's name", () => {
		const n = tagNames();
		const r = words("walnut kiosk", "Projects/Kiosk rollout.md");
		const lines = viewLines(noteView(ctx(), r, nc(), n)).join("\n");
		expect(lines).not.toMatch(/walnut|kiosk|rollout/i);
		expect(lines).toContain('Left out: it has "word#2" but not "word#1".');
	});

	it("shows the words when the names are allowed", () => {
		const r = words("walnut kiosk", "Projects/Kiosk rollout.md");
		expect(viewLines(noteView(ctx(), r, nc(), realNames)).join("\n")).toContain('"walnut"');
	});

	it("keeps the last-word mark and how the search was set in the report's lines", () => {
		const r = words("walnut kiosk", null);
		const lines = viewLines(searchView(ctx(), r));
		expect(lines.some((l) => l.includes("kiosk (last word)"))).toBe(true);
		expect(lines.slice(-4)).toEqual([
			"Searched: by words",
			"Where: everywhere",
			"Filters: none",
			"Order: best match, top 50 listed",
		]);
	});

	it("never uses a dash as punctuation in what it says", () => {
		const r = words("walnut kiosk", "Projects/Kiosk rollout.md");
		const all = [searchView(ctx(), r), noteView(ctx(), r, nc())].flatMap(viewLines).join("\n");
		expect(all).not.toMatch(/—| – /);
	});
});
