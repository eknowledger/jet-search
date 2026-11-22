import { describe, expect, it } from "vitest";
import { frecency, groupRecents, movePath, normalizeData, recordOpen, rememberSearch } from "../src/data";

const DAY = 86_400_000;

describe("Jet data", () => {
	it("fills defaults and drops bad values", () => {
		const d = normalizeData({
			settings: { shiftInterval: 5, newTab: "yes" },
			opened: { a: [1, 2], b: "x" },
			searches: [1, "q"],
		});
		expect(d.settings.shiftInterval).toBe(350);
		expect(d.settings.newTab).toBe(false);
		expect(d.settings.stemming).toEqual(["en"]);
		expect(d.opened).toEqual({ a: [1, 2] });
		expect(d.searches).toEqual(["q"]);
	});

	it("keeps the trace's length to the ones offered, and its next-start switch off unless it was saved on", () => {
		expect(normalizeData(null).settings).toMatchObject({ traceMinutes: 15, traceNextStart: false });
		const a = normalizeData({ settings: { traceMinutes: 30, traceNextStart: true } }).settings;
		expect([a.traceMinutes, a.traceNextStart]).toEqual([30, true]);
		const b = normalizeData({ settings: { traceMinutes: 7, traceNextStart: "yes" } }).settings;
		expect([b.traceMinutes, b.traceNextStart]).toEqual([15, false]);
	});

	it("decays opens with a 30-day half-life and boosts by frecency", () => {
		const d = normalizeData(null);
		recordOpen(d, "a.md", 0);
		recordOpen(d, "a.md", 0);
		expect(d.opened["a.md"]?.[0]).toBe(2);
		recordOpen(d, "a.md", 30 * DAY);
		expect(d.opened["a.md"]?.[0]).toBeCloseTo(2, 5);
		expect(frecency(d, "a.md", 30 * DAY)).toBeCloseTo(1 + 0.15 * Math.log2(3), 5);
		expect(frecency(d, "never.md", 0)).toBe(1);
	});

	it("keeps recent searches unique, newest first, ten at most", () => {
		const d = normalizeData(null);
		for (let i = 0; i < 12; i++) rememberSearch(d, `q${i}`);
		rememberSearch(d, "q5");
		rememberSearch(d, "x");
		expect(d.searches[0]).toBe("q5");
		expect(d.searches).toHaveLength(10);
		expect(new Set(d.searches).size).toBe(10);
	});

	it("groups recents by Today, Past week and Past 30 days", () => {
		const now = new Date(2026, 9, 7, 15).getTime();
		const d = normalizeData(null);
		recordOpen(d, "today.md", now - 3600_000);
		recordOpen(d, "week.md", now - 3 * DAY);
		recordOpen(d, "month.md", now - 20 * DAY);
		recordOpen(d, "old.md", now - 90 * DAY);
		recordOpen(d, "gone.md", now - 60_000);
		const groups = groupRecents(
			d,
			["fallback.md", "today.md"],
			() => now - 2 * DAY,
			(p) => p !== "gone.md",
			now,
		);
		expect(groups.map((g) => [g.label, g.items.map((i) => i.path)])).toEqual([
			["Today", ["today.md"]],
			["Past week", ["fallback.md", "week.md"]],
			["Past 30 days", ["month.md"]],
		]);
	});

	it("follows renames and deletions", () => {
		const d = normalizeData(null);
		recordOpen(d, "a.md", 0);
		movePath(d, "a.md", "b.md");
		expect(Object.keys(d.opened)).toEqual(["b.md"]);
		movePath(d, "b.md", null);
		expect(d.opened).toEqual({});
	});
});

describe("scopes in data.json", () => {
	it("loads none by default and keeps well-formed ones", () => {
		expect(normalizeData(null).scopes).toEqual([]);
		const d = normalizeData({
			scopes: [{ name: "Garden", rules: [{ kind: "tag", tag: "garden" }] }, { name: "" }],
		});
		expect(d.scopes.map((s) => [s.name, s.rules])).toEqual([["Garden", [{ kind: "tag", tag: "#garden" }]]]);
	});
});
