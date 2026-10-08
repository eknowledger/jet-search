import { describe, expect, it } from "vitest";
import { normalizeData } from "../src/data";
import { importJadeSearch } from "../src/migrate";

const jade = (settings: Record<string, unknown>) => ({ modules: { search: { enabled: true, settings } } });

describe("importing Jade's search settings once", () => {
	it("on the first run: open in a new tab, and the last query becomes the first recent search", () => {
		const d = normalizeData({});
		expect(importJadeSearch(d, jade({ newTab: true, keepQuery: true, lastQuery: "thin frame" }))).toBe(true);
		expect(d.settings.newTab).toBe(true);
		expect(d.searches[0]).toBe("thin frame");
		expect(d.imported).toEqual(["jade-search"]);
	});

	it("only once, and never after Jet has been used (its own choices win)", () => {
		const d = normalizeData({});
		importJadeSearch(d, jade({ newTab: false }));
		d.settings.newTab = false;
		expect(importJadeSearch(d, jade({ newTab: true }))).toBe(false);
		expect(d.settings.newTab).toBe(false);
		const used = normalizeData({ indexedAt: 1 });
		expect(importJadeSearch(used, jade({ newTab: true }))).toBe(false);
		expect(used.settings.newTab).toBe(false);
	});

	it("no Jade, or Jade's search never set up: marked done, nothing changed", () => {
		const d = normalizeData({});
		expect(importJadeSearch(d, null)).toBe(true);
		expect(d.settings.newTab).toBe(false);
		expect(d.imported).toEqual(["jade-search"]);
		const e = normalizeData({});
		importJadeSearch(e, { modules: {} });
		expect(e.searches).toEqual([]);
	});

	it("a kept query only when Jade kept it; not twice in the recents", () => {
		const d = normalizeData({ searches: ["thin frame"] });
		importJadeSearch(d, jade({ keepQuery: true, lastQuery: "thin frame" }));
		expect(d.searches).toEqual(["thin frame"]);
		const e = normalizeData({});
		importJadeSearch(e, jade({ keepQuery: false, lastQuery: "x" }));
		expect(e.searches).toEqual([]);
	});

	it("the imported mark survives a save and load", () => {
		const d = normalizeData({});
		importJadeSearch(d, null);
		expect(normalizeData(JSON.parse(JSON.stringify(d))).imported).toEqual(["jade-search"]);
	});
});
