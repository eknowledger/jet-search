import { afterEach, describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";
import { normalizeData } from "../src/data";
import type { Feeder } from "../src/index/feeder";
import type { Entry } from "../src/modal/jet-modal";
import { Search } from "../src/search";
import { JetClient } from "../src/worker/jet-client";

type Item = Extract<Entry, { type: "item" }>;
const items = (e: Entry[] | undefined): string[] =>
	(e ?? []).filter((x): x is Item => x.type === "item").map((x) => x.path);
const settle = async (n = 6): Promise<void> => {
	for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

class FakeWorker {
	static last: FakeWorker | null = null;
	onmessage: ((e: { data: unknown }) => void) | null = null;
	onerror: ((e: unknown) => void) | null = null;
	readonly sent: Array<{ id: number; req: { op: string; seq?: number; text?: string; limit?: number } }> = [];
	constructor() {
		FakeWorker.last = this;
	}
	postMessage(msg: { id: number; req: { op: string } }): void {
		this.sent.push(msg as never);
	}
	terminate(): void {}
	reply(id: number, result: unknown): void {
		this.onmessage?.({ data: { id, result } });
	}
}

/** A search over notes with the given texts; the worker's answer is whatever hits the test gives. */
const search = async (
	texts: Record<string, string>,
	hits: Array<[path: string, score: number]>,
	typed: string,
): Promise<{ shown: string[]; reads: string[] }> => {
	const app = new App();
	const reads: string[] = [];
	for (const p of Object.keys(texts)) app.vault.files.set(p, new TFile(p));
	(app.vault as unknown as { cachedRead: (f: TFile) => Promise<string> }).cachedRead = (f) => {
		reads.push(f.path);
		return Promise.resolve(texts[f.path] ?? "");
	};
	const feeder = { progress: null, ensure: () => Promise.resolve() } as unknown as Feeder;
	const data = normalizeData(null);
	data.indexedAt = 1;
	data.settings.excerpts = false;
	const s = new Search(app, new JetClient(), feeder, () => data);
	let last: Entry[] = [];
	s.list(typed, (e) => (last = e));
	await settle();
	const w = FakeWorker.last as FakeWorker;
	const q = w.sent.find((m) => m.req.op === "query") as { id: number; req: { seq?: number } };
	w.reply(q.id, {
		seq: q.req.seq,
		hits: hits.map(([path, score]) => ({ path, score, matched: 2, edits: 0 })),
		terms: typed.split(/\s+/),
		ms: 0,
	});
	await settle();
	return { shown: items(last), reads };
};

describe("unquoted words typed in the order they appear", () => {
	const g = globalThis as unknown as { Worker?: unknown };
	const saved = g.Worker;
	afterEach(() => {
		g.Worker = saved;
	});
	const texts = {
		"Alpha.md": "The plan for the garden, and the budget.",
		"Beta.md": "Where the garden plan is kept.",
	};

	it("puts the note that has them in order above a note that only has them", async () => {
		g.Worker = FakeWorker;
		const r = await search(
			texts,
			[
				["Alpha.md", 3],
				["Beta.md", 2.5],
			],
			"garden plan",
		);
		expect(r.shown).toEqual(["Beta.md", "Alpha.md"]);
	});

	it("leaves the order alone for one word, and for words in quotes", async () => {
		g.Worker = FakeWorker;
		const one = await search(
			texts,
			[
				["Alpha.md", 3],
				["Beta.md", 2.5],
			],
			"garden",
		);
		expect(one.shown).toEqual(["Alpha.md", "Beta.md"]);
		expect(one.reads).toEqual([]);
		const quoted = await search(
			texts,
			[
				["Alpha.md", 3],
				["Beta.md", 2.5],
			],
			'"garden plan"',
		);
		expect(quoted.shown).toEqual(["Beta.md"]);
	});
});
