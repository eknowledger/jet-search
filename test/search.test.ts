import { describe, expect, it, vi } from "vitest";
import { App, TFile } from "obsidian";
import { normalizeData } from "../src/data";
import type { Feeder } from "../src/index/feeder";
import type { Entry } from "../src/modal/jet-modal";
import { Search } from "../src/search";
import type { JetClient } from "../src/worker/jet-client";

type Item = Extract<Entry, { type: "item" }>;

/** A vault of two notes; the index never answers (the worker is still building, or asleep). */
const setup = (building: boolean): Search => {
	const app = new App();
	const files = (app.vault as unknown as { files: Map<string, TFile> }).files;
	const caches = (app.metadataCache as unknown as { caches: Map<string, unknown> }).caches;
	for (const p of ["Projects/Garden.md", "Trips/Lyon.md"]) files.set(p, new TFile(p));
	caches.set("Projects/Garden.md", {
		headings: [{ level: 2, heading: "Watering schedule" }],
		tags: [{ tag: "#outdoors" }],
	});
	caches.set("Trips/Lyon.md", { frontmatter: { status: "planned", aliases: ["Lugdunum"], tags: ["travel"] } });
	const feeder = {
		progress: building ? { done: 100, total: 1400 } : null,
		ensure: () => new Promise<void>(() => {}),
	} as unknown as Feeder;
	const data = normalizeData(null);
	data.indexedAt = building ? null : 1;
	return new Search(app, {} as JetClient, feeder, () => data);
};

const vaultOf = (s: Search): { calls: string[] } => (s as unknown as { app: { vault: { calls: string[] } } }).app.vault;

const first = (s: Search, text: string): Item[] => {
	let shown: Entry[] = [];
	s.list(text, (entries) => {
		if (!shown.length) shown = entries;
	});
	return shown.filter((e): e is Item => e.type === "item");
};

describe("search before the index is ready", () => {
	it("finds notes by heading, tag and property in the same frame while the first build runs", () => {
		const s = setup(true);
		const byHeading = first(s, "watering");
		expect(byHeading.map((e) => e.path)).toEqual(["Projects/Garden.md"]);
		expect(byHeading[0]?.excerpt?.text).toBe("Watering schedule");
		expect(byHeading[0]?.excerpt?.marks).toEqual([[0, 8]]);
		expect(first(s, "outdoors").map((e) => e.path)).toEqual(["Projects/Garden.md"]);
		expect(first(s, "status planned")[0]?.excerpt?.text).toBe("status: planned");
		expect(first(s, "travel")[0]?.excerpt?.text).toBe("#travel");
	});

	it("leaves headings, tags and properties to the index once it is ready", () => {
		const s = setup(false);
		expect(first(s, "watering")).toEqual([]);
	});

	it("shows a note once, under its name when the name matches", () => {
		const s = setup(true);
		const rows = first(s, "garden");
		expect(rows.map((e) => e.path)).toEqual(["Projects/Garden.md"]);
		expect(rows[0]?.excerpt).toBeUndefined();
	});
});

describe("warming up when the modal opens", () => {
	it("builds Tier 0 just after the modal's first paint, so the first letter only matches", () => {
		vi.useFakeTimers();
		try {
			const s = setup(true);
			s.warm();
			expect(vaultOf(s).calls).toEqual([]);
			vi.runAllTimers();
			const built = vaultOf(s).calls.length;
			expect(built).toBeGreaterThan(0);
			expect(first(s, "watering").map((e) => e.path)).toEqual(["Projects/Garden.md"]);
			expect(vaultOf(s).calls.length).toBe(built);
		} finally {
			vi.useRealTimers();
		}
	});
});
