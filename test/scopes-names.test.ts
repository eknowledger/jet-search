import { describe, expect, it } from "vitest";
import {
	compact,
	fold,
	isIdName,
	isPeriod,
	jdArea,
	jdCategory,
	jdId,
	sequenceSiblings,
	sharesScheme,
	stripName,
} from "../src/scopes/names";

describe("fold: the comparison form of a name", () => {
	it("folds case, accents, emoji, separators and a trailing Notion id", () => {
		expect(fold("Café Crème")).toBe("cafe creme");
		expect(fold("Übersetzung")).toBe("ubersetzung");
		expect(fold("STRASSE")).toBe(fold("Straße"));
		expect(fold("📁 Projects")).toBe("projects");
		expect(fold("orchard-rewrite")).toBe("orchard rewrite");
		expect(fold("Roadmap 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d")).toBe("roadmap");
		expect(compact("#orchard_rewrite".replace("#", ""))).toBe(compact("Orchard Rewrite"));
	});
});

describe("numbering stripped into an alias", () => {
	it("strips an order index when the siblings share the scheme, and keeps it as an alias", () => {
		const siblings = ["1.Inbox", "2.Projects", "3.Areas", "Clippings"];
		expect(sharesScheme(siblings)).toBe(true);
		expect(stripName("2.Projects", true)).toEqual({ name: "Projects", alias: "2" });
		expect(stripName("01 Projets", true)).toEqual({ name: "Projets", alias: "01" });
		expect(stripName("1_Areas", true)).toEqual({ name: "Areas", alias: "1" });
	});

	it("keeps a number that belongs to the name, or when nothing would be left", () => {
		expect(sharesScheme(["100 Days of Code", "Cooking", "Garden"])).toBe(false);
		expect(stripName("100 Days of Code", false)).toEqual({ name: "100 Days of Code", alias: null });
		expect(stripName("1984", true)).toEqual({ name: "1984", alias: null });
		expect(stripName("Project 2024", true)).toEqual({ name: "Project 2024", alias: null });
	});

	it("always strips Johnny.Decimal codes, emoji, stamps and Notion ids", () => {
		expect(stripName("10-19 Admin", false)).toEqual({ name: "Admin", alias: "10-19" });
		expect(stripName("11 Finance", false, true)).toEqual({ name: "Finance", alias: "11" });
		expect(stripName("🗂 Projects", false)).toEqual({ name: "Projects", alias: null });
		expect(stripName("202301151230 Habits compound", false)).toEqual({ name: "Habits compound", alias: null });
		expect(stripName("Roadmap 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d", false)).toEqual({ name: "Roadmap", alias: null });
	});
});

describe("guards: periods, sequences, ids, Johnny.Decimal", () => {
	it("knows periods: years, months, quarters, weeks, dates and month names", () => {
		for (const p of ["2024", "2024-03", "2024-03-05", "Q3", "2026-Q1", "W12", "2025-W07", "March", "mars", "03"])
			expect(isPeriod(p, { inYear: true, locales: ["en", "fr"] }), p).toBe(true);
		for (const p of ["Projects", "1984 notes", "Q5", "13", "Admin"])
			expect(isPeriod(p, { inYear: true, locales: ["en"] }), p).toBe(false);
		expect(isPeriod("03", { inYear: false, locales: ["en"] })).toBe(false);
	});

	it("finds siblings that differ only by a number or a letter", () => {
		expect([...sequenceSiblings(["Week 1", "Week 2", "Week 3", "Readings"])].sort()).toEqual([
			"Week 1",
			"Week 2",
			"Week 3",
		]);
		expect([...sequenceSiblings(["A", "B", "C"])].sort()).toEqual(["A", "B", "C"]);
		expect([...sequenceSiblings(["11 Finance", "12 Legal", "13 Insurance"])]).toEqual([]);
		expect([...sequenceSiblings(["1.Inbox", "2.Projects"])]).toEqual([]);
	});

	it("knows ids and Johnny.Decimal levels", () => {
		expect(isIdName("202301151230")).toBe(true);
		expect(isIdName("2026-10-07")).toBe(true);
		expect(isIdName("Habits compound")).toBe(false);
		expect(jdArea("10-19 Admin")).toEqual({ from: 10, to: 19 });
		expect(jdArea("10–19 Life admin")).toEqual({ from: 10, to: 19 });
		expect(jdArea("2020-2029 Decade")).toBeNull();
		expect(jdCategory("11 Finance")).toBe(11);
		expect(jdId("11.01 Annual budget")).toBe(true);
		expect(jdId("11 Finance")).toBe(false);
	});
});
