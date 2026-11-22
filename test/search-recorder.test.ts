import { beforeEach, describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";
import { normalizeData } from "../src/data";
import { FLAG, recorder, wordCount } from "../src/diag/recorder";
import type { Feeder } from "../src/index/feeder";
import type { Entry } from "../src/modal/jet-modal";
import { Search } from "../src/search";
import type { JetClient } from "../src/worker/jet-client";
import type { QueryReply } from "../src/worker/protocol";

const settle = async (n = 8): Promise<void> => {
	for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

type Fake = {
	running: boolean;
	query: (text: string) => Promise<QueryReply | null>;
	nearest: (text: string) => Promise<{
		seq: number;
		near: Array<{ path: string; score: number }>;
		ms: number;
	} | null>;
};

const hit = (path: string) => ({ path, score: 1, matched: 1, edits: 0 });

const rig = (
	over: Partial<Fake> = {},
	opts: {
		excerpts?: boolean;
		progress?: { done: number; total: number } | null;
	} = {},
): Search => {
	const app = new App();
	// Every note holds the phrase the tests quote.
	(app.vault as unknown as { cachedRead: () => Promise<string> }).cachedRead = () =>
		Promise.resolve("water plants daily");
	for (const p of ["Garden.md", "Lyon.md", "Notes/Trip.md"]) app.vault.files.set(p, new TFile(p));
	const client: Fake = {
		running: true,
		query: () =>
			Promise.resolve({
				seq: 1,
				hits: [hit("Garden.md"), hit("Lyon.md")],
				terms: ["water"],
				ms: 3.5,
			} as QueryReply),
		nearest: () =>
			Promise.resolve({
				seq: 1,
				near: [{ path: "Garden.md", score: 0.9 }],
				ms: 6,
			}),
		...over,
	};
	const feeder = {
		progress: opts.progress ?? null,
		ensure: () => Promise.resolve(),
		ensureMeaning: () => Promise.resolve(),
	} as unknown as Feeder;
	const data = normalizeData(null);
	data.indexedAt = opts.progress ? null : 1;
	data.settings.excerpts = opts.excerpts ?? false;
	return new Search(app, client as unknown as JetClient, feeder, () => data);
};

const run = async (s: Search, text: string, meaning?: { on: boolean; offered: boolean; both?: boolean }) => {
	const painted: Entry[][] = [];
	s.list(text, (e) => painted.push(e), undefined, [], meaning);
	await settle();
	return painted;
};

beforeEach(() => recorder.reset());

describe("a full-text search is recorded when it shows results", () => {
	it("makes one row of durations, counts and flags, and never keeps the words", async () => {
		await run(rig(), "water plants");
		const s = recorder.summary()!;
		expect(s.total).toBe(1);
		expect(s.kinds).toEqual({ words: 1, meaning: 0 });
		expect(s.max.hits).toBe(2);
		expect(s.max.chars).toBe(12);
		expect(s.max.words).toBe(2);
		// The worker's own time is carried over as it was reported.
		expect(s.max.worker).toBeCloseTo(3.5, 1);
		expect(s.max.total).toBeGreaterThanOrEqual(0);
		expect(JSON.stringify(s)).not.toMatch(/water|plants/);
	});

	it("splits the time: the wait for the index, the worker's own time, and the rest of the round trip", async () => {
		const slow = rig({
			query: () =>
				new Promise((r) =>
					setTimeout(
						() => r({ seq: 1, hits: [hit("Garden.md")], terms: ["water"], ms: 5 } as QueryReply),
						30,
					),
				),
		});
		await run(slow, "water");
		await new Promise((r) => setTimeout(r, 80));
		await settle();
		const m = recorder.summary()!.max;
		expect(m.worker).toBeCloseTo(5, 1);
		expect(m.transit).toBeGreaterThan(15);
		expect(m.total).toBeGreaterThanOrEqual(m.transit + m.worker - 1);
	});

	it("flags a worker that had to start, and an index still being built", async () => {
		await run(rig({ running: false }), "water");
		expect(recorder.summary()!.flags.cold).toBe(1);
		recorder.reset();
		await run(rig({}, { progress: { done: 1, total: 9 } }), "water");
		expect(recorder.summary()!.flags.building).toBe(1);
	});

	it("flags a quoted phrase, a rare word and a scope", async () => {
		await run(
			rig({
				query: () =>
					Promise.resolve({
						seq: 1,
						hits: [hit("Garden.md")],
						terms: ["a"],
						ms: 1,
						rare: true,
					}),
			}),
			'"water plants"',
		);
		let s = recorder.summary()!;
		expect(s.flags.phrase).toBe(1);
		expect(s.flags.rare).toBe(1);
		recorder.reset();
		const sc = rig();
		sc.list("water", () => {}, "some-scope");
		await settle();
		s = recorder.summary()!;
		expect(s.flags.scoped).toBe(1);
	});

	it("times the excerpts pass when it runs", async () => {
		await run(rig({}, { excerpts: true }), "water");
		expect(recorder.summary()!.total).toBe(1);
	});

	it("records nothing when the search shows no results", async () => {
		await run(
			rig({
				query: () =>
					Promise.resolve({
						seq: 1,
						hits: [],
						terms: ["zzz"],
						ms: 1,
					} as QueryReply),
			}),
			"zzz",
		);
		expect(recorder.summary()).toBeNull();
	});

	it("counts a search a newer one replaced, and records no row for it", async () => {
		const s = rig();
		s.list("wat", () => {});
		s.list("water", () => {});
		await settle();
		const sum = recorder.summary()!;
		expect(sum.superseded).toBeGreaterThanOrEqual(1);
		expect(sum.total).toBe(1);
	});

	it("does not record names-only searches, or searches that show nothing yet", async () => {
		const s = rig();
		s.list("   ", () => {});
		s.list("garden", () => {}, undefined, [{ kind: "title" } as never]);
		await settle();
		expect(recorder.summary()).toBeNull();
	});
});

describe("a search by meaning is recorded too", () => {
	it("makes a row flagged meaning with the worker's time", async () => {
		await run(rig(), "how do I water plants", { on: true, offered: false });
		const s = recorder.summary()!;
		expect(s.kinds.meaning).toBe(1);
		expect(s.max.worker).toBeCloseTo(6, 1);
		expect(s.max.hits).toBe(1);
		expect(s.max.flags & FLAG.words).toBe(0);
	});

	it("records both searches when words and meaning run together", async () => {
		await run(rig(), "water", { on: true, offered: false, both: true });
		expect(recorder.summary()!.total).toBe(2);
		expect(recorder.summary()!.kinds).toEqual({ words: 1, meaning: 1 });
	});
});

describe("counting words without making a list", () => {
	it("counts the runs of non-space characters", () => {
		expect(wordCount("")).toBe(0);
		expect(wordCount("   ")).toBe(0);
		expect(wordCount("water")).toBe(1);
		expect(wordCount("  water   my  plants ")).toBe(3);
	});
});
