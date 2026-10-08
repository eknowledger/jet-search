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

describe("searching inside a scope", () => {
	/** Three notes, two in a "Garden" scope; the worker answers with all three. */
	const scoped = () => {
		const app = new App();
		const files = (app.vault as unknown as { files: Map<string, TFile> }).files;
		for (const p of ["Garden/Beds.md", "Garden/Bean poles.md", "Trips/Beaufort.md"]) files.set(p, new TFile(p));
		const queries: Array<{ text: string; scope?: string }> = [];
		const client = {
			query: (text: string, opts: { scope?: string }) => {
				queries.push({ text, scope: opts.scope });
				return Promise.resolve({
					seq: 1,
					terms: ["be"],
					hits: ["Garden/Beds.md", "Trips/Beaufort.md"]
						.filter((p) => !opts.scope || p.startsWith("Garden/"))
						.map((path) => ({ path, score: 1, matched: 1 })),
				});
			},
		} as unknown as JetClient;
		const feeder = { progress: null, ensure: () => Promise.resolve() } as unknown as Feeder;
		const data = normalizeData(null);
		data.indexedAt = 1;
		data.settings.excerpts = false;
		let ensured = 0;
		const members = new Set(["Garden/Beds.md", "Garden/Bean poles.md"]);
		const keeper = {
			ensure: () => {
				ensured++;
			},
			membersOf: (id: string) => (id === "garden" ? members : new Set<string>()),
		};
		const s = new Search(app, client, feeder, () => data, keeper);
		return { s, queries, ensured: () => ensured };
	};
	const settle = () => new Promise((r) => setTimeout(r, 0));

	it("names match only the scope's notes in the first frame; the worker is asked with the scope", async () => {
		const { s, queries, ensured } = scoped();
		const paints: Entry[][] = [];
		s.list("bea", (e) => paints.push(e), "garden");
		const items = (e: Entry[] | undefined) =>
			(e ?? []).filter((x): x is Item => x.type === "item").map((x) => x.path);
		expect(items(paints[0])).toEqual(["Garden/Bean poles.md"]);
		expect(ensured()).toBe(1);
		await settle();
		await settle();
		expect(queries).toEqual([{ text: "bea", scope: "garden" }]);
		expect(items(paints.at(-1))).not.toContain("Trips/Beaufort.md");
	});

	it("without a scope, everything", async () => {
		const { s, queries } = scoped();
		const paints: Entry[][] = [];
		s.list("bea", (e) => paints.push(e));
		await settle();
		await settle();
		expect(queries).toEqual([{ text: "bea", scope: undefined }]);
		expect((paints.at(-1) ?? []).filter((x): x is Item => x.type === "item").map((x) => x.path)).toContain(
			"Trips/Beaufort.md",
		);
	});
});
