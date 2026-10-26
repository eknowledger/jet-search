/**
 * QA findings for the search engine, ranking, excerpts, recovery, the hand-off to core Search, in-note
 * search and the worker protocol. Every test here fails on the code as it is: each one is
 * a bug.
 */
import { afterEach, describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";
import { normalizeData } from "../src/data";
import { fieldsFromMarkdown, type NoteInput } from "../src/engine/fields";
import { JetEngine } from "../src/engine/jet-engine";
import { parseQuery } from "../src/engine/query";
import { cutExcerpt } from "../src/excerpt/excerpt";
import { Feeder } from "../src/index/feeder";
import { InNoteHost } from "../src/innote";
import type { Entry } from "../src/modal/jet-modal";
import { filterPhrases } from "../src/rank";
import { Search } from "../src/search";
import { JetClient } from "../src/worker/jet-client";

type Item = Extract<Entry, { type: "item" }>;

const note = (path: string, text: string, mtime = 0): NoteInput => ({ path, mtime, ...fieldsFromMarkdown(path, text) });
const paths = (e: JetEngine, q: string, now = 0): string[] => e.query(parseQuery(q), { now }).hits.map((h) => h.path);
const settle = async (n = 4): Promise<void> => {
	for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
const items = (e: Entry[] | undefined): string[] =>
	(e ?? []).filter((x): x is Item => x.type === "item").map((x) => x.path);

// ── Engine ─────────────────────────────────────────────────────────────────────

describe("QA: save/load round trip keeps deleted notes out of mtimes()", () => {
	it("a note deleted before a sidecar save is not listed as indexed after load", () => {
		const e = new JetEngine();
		e.build([note("A.md", "alpha", 1), note("B.md", "beta", 2)]);
		e.delete("B.md");
		const { base, sidecar } = e.save();
		const back = new JetEngine();
		back.load(base.slice(0), sidecar);
		expect(back.size).toBe(1);
		// The feeder's catch-up trusts mtimes(): a deleted note listed here, restored later with the
		// same mtime (sync, git, file recovery), is taken as indexed and never sent again.
		expect(back.mtimes().map(([p]) => p)).toEqual(["A.md"]);
	});

	it("an edited note is listed once after load, with its new mtime", () => {
		const e = new JetEngine();
		e.build([note("A.md", "alpha", 1)]);
		e.upsert(note("A.md", "alpha again", 5));
		const { base, sidecar } = e.save();
		const back = new JetEngine();
		back.load(base.slice(0), sidecar);
		expect(back.mtimes()).toEqual([["A.md", 5]]);
	});
});

describe("QA: the typo gate (TYPOS_BELOW) counts notes, not postings", () => {
	const vault = (): NoteInput[] => [
		note("c1.md", "colour"),
		note("c2.md", "colour"),
		note("k1.md", "color"),
		note("k2.md", "color"),
		note("k3.md", "color"),
	];

	it("gives the same results before and after notes are saved again unchanged", () => {
		const e = new JetEngine();
		e.build(vault());
		const before = paths(e, "colour ");
		expect(before).toHaveLength(5);
		// Saving the two notes again (no change at all) leaves a dead copy in the base and a live one in
		// the delta: the gate now sees 4 "notes" and turns typos off.
		e.upsert(note("c1.md", "colour"));
		e.upsert(note("c2.md", "colour"));
		expect(paths(e, "colour ").sort()).toEqual([...before].sort());
	});

	it("word forms in one note count as one note", () => {
		const e = new JetEngine();
		e.build([note("c1.md", "colour colours coloured"), note("k1.md", "color")]);
		// "colour" is in one note only, so a typo should rescue "color" (as it does without the forms).
		expect(paths(e, "colour ")).toContain("k1.md");
	});
});

describe("QA: queries of more than 32 words keep AND semantics", () => {
	it("a note missing the 33rd word is not listed when another note has every word", () => {
		// Seven random letters each (seeded): no two words within a typo of each other.
		let seed = 7;
		const letter = () => String.fromCharCode(97 + ((seed = (seed * 48271) % 2147483647) % 26));
		const words = Array.from({ length: 33 }, () => Array.from({ length: 7 }, letter).join(""));
		const e = new JetEngine();
		e.build([note("all.md", words.join(" ")), note("some.md", words.slice(0, 32).join(" "))]);
		expect(paths(e, `${words.join(" ")} `)).toEqual(["all.md"]);
	});
});

describe("QA: a single Chinese/Japanese character is found inside a run", () => {
	it("finds 猫 in 我的猫很可爱 and 茶 at the end of 今天喝茶", () => {
		const e = new JetEngine();
		e.build([note("a.md", "我的猫很可爱"), note("b.md", "今天喝茶")]);
		expect(paths(e, "猫")).toEqual(["a.md"]);
		expect(paths(e, "茶")).toEqual(["b.md"]);
	});
});

describe("QA: the exact-name boost applies to camelCase names", () => {
	it("ranks JavaScript.md above JavaScript tips.md for 'javascript', as Garden.md above Garden tips.md", () => {
		const plain = new JetEngine();
		plain.build([note("Garden.md", "Notes."), note("Garden tips.md", "Garden tips and garden tricks for garden.")]);
		expect(paths(plain, "garden ")[0]).toBe("Garden.md");
		const camel = new JetEngine();
		camel.build([
			note("JavaScript.md", "Notes."),
			note("JavaScript tips.md", "JavaScript tips and JavaScript tricks for javascript."),
		]);
		expect(paths(camel, "javascript ")[0]).toBe("JavaScript.md");
	});
});

describe("QA: spelling suggestions see notes changed since the last merge", () => {
	it("suggests a word that only a newly created note has", () => {
		const e = new JetEngine();
		e.build([note("A.md", "alpha beta")]);
		e.upsert(note("B.md", "kubernetes cluster"));
		expect(paths(e, "kubrnets ")).toEqual([]);
		expect(e.suggest(parseQuery("kubrnets "))).toEqual({ text: "kubernetes", notes: 1 });
	});
});

// ── Query parsing ──────────────────────────────────────────────────────────────

describe("QA: parseQuery", () => {
	it("a hyphen inside a quoted phrase is text, not an exclusion", () => {
		expect(parseQuery('"git push --force"').excluded).toEqual([]);
		const e = new JetEngine();
		e.build([note("git.md", "Use git push --force with care."), note("other.md", "git push origin main")]);
		expect(paths(e, '"git push --force"')).toContain("git.md");
	});

	it("an excluded key:value does not exclude every note with the key's word", () => {
		// `status:draft` searches "draft" (the key is dropped); `-status:draft` also excludes "status".
		expect(parseQuery("meeting status:draft").words).toEqual(["meeting", "draft"]);
		expect(parseQuery("meeting -status:draft").excluded).not.toContain("status");
	});
});

// ── Search (modal side) ────────────────────────────────────────────────────────

describe("QA: Tier 0 titles respect -exclusions", () => {
	it("'meeting -draft' does not list the note named Meeting draft under Titles", () => {
		const app = new App();
		const files = (app.vault as unknown as { files: Map<string, TFile> }).files;
		for (const p of ["Meeting draft.md", "Meeting final.md"]) files.set(p, new TFile(p));
		const feeder = { progress: null, ensure: () => new Promise<void>(() => {}) } as unknown as Feeder;
		const data = normalizeData(null);
		data.indexedAt = 1;
		const s = new Search(app, {} as JetClient, feeder, () => data);
		let shown: Entry[] = [];
		s.list("meeting -draft", (e) => {
			if (!shown.length) shown = e;
		});
		expect(items(shown)).not.toContain("Meeting draft.md");
	});
});

/** A Worker stand-in: records messages; the test answers them, in the order the real worker would. */
class FakeWorker {
	static last: FakeWorker | null = null;
	onmessage: ((e: { data: unknown }) => void) | null = null;
	onerror: ((e: unknown) => void) | null = null;
	readonly sent: Array<{ id: number; req: { op: string; seq?: number; text?: string } }> = [];
	constructor() {
		FakeWorker.last = this;
	}
	postMessage(msg: { id: number; req: { op: string } }): void {
		this.sent.push(msg);
	}
	terminate(): void {}
	reply(id: number, result: unknown): void {
		this.onmessage?.({ data: { id, result } });
	}
}

describe("QA: recovery inside a scope does not cancel a newer query (latest wins)", () => {
	const g = globalThis as unknown as { Worker?: unknown };
	const saved = g.Worker;
	afterEach(() => {
		g.Worker = saved;
	});

	it("the next keystroke's results are painted even if the previous one's recovery asks its count", async () => {
		g.Worker = FakeWorker;
		const app = new App();
		const files = (app.vault as unknown as { files: Map<string, TFile> }).files;
		files.set("Garden/Beds.md", new TFile("Garden/Beds.md"));
		const client = new JetClient();
		const feeder = { progress: null, ensure: () => Promise.resolve() } as unknown as Feeder;
		const data = normalizeData(null);
		data.indexedAt = 1;
		data.settings.excerpts = false;
		const keeper = {
			ensure: () => {},
			membersOf: () => new Set(["Garden/Beds.md"]),
			describe: () => ({ name: "Garden", create: "Garden/" }),
		};
		const s = new Search(app, client, feeder, () => data, keeper);
		// The modal drops paints of an older list() (jet-modal listSeq): keep the newest list's only.
		const latest: Entry[][] = [];
		s.list("zq", () => {}, "garden");
		await settle();
		const w = FakeWorker.last as FakeWorker;
		const q1 = w.sent.find((m) => m.req.op === "query") as { id: number; req: { seq?: number } };
		w.reply(q1.id, { seq: q1.req.seq, hits: [], terms: [], ms: 0 });
		await settle();
		const suggest = w.sent.find((m) => m.req.op === "suggest") as { id: number };
		expect(suggest).toBeDefined();
		// The user types one more letter while the suggestion is on its way.
		s.list("zqx", (e) => latest.push(e), "garden");
		await settle();
		const q2 = w.sent.filter((m) => m.req.op === "query")[1] as { id: number; req: { seq?: number } };
		// The worker answers in order: the suggestion first, then the new query.
		w.reply(suggest.id, { text: null, notes: 0 });
		await settle();
		w.reply(q2.id, {
			seq: q2.req.seq,
			hits: [{ path: "Garden/Beds.md", score: 1, matched: 1, edits: 0 }],
			terms: ["zqx"],
			ms: 0,
		});
		await settle();
		for (const m of w.sent.slice())
			if (m.req.op === "query" && m.id !== q1.id && m.id !== q2.id)
				w.reply(m.id, { seq: m.req.seq, hits: [], terms: [], ms: 0 });
		await settle();
		expect(items(latest.at(-1))).toContain("Garden/Beds.md");
	});
});

describe("a query and a question at once (words and meaning together)", () => {
	const g = globalThis as unknown as { Worker?: unknown };
	const saved = g.Worker;
	afterEach(() => {
		g.Worker = saved;
	});

	it("neither cancels the other; a newer question still drops the older one", async () => {
		g.Worker = FakeWorker;
		const client = new JetClient();
		const q = client.query("ship");
		const n1 = client.nearest("how do we ship");
		const w = FakeWorker.last as FakeWorker;
		const [mq, mn] = w.sent as Array<{ id: number; req: { seq?: number } }>;
		w.reply(mq?.id ?? 0, { seq: mq?.req.seq, hits: [], terms: [], ms: 0 });
		w.reply(mn?.id ?? 0, { seq: mn?.req.seq, near: [], ms: 0 });
		expect(await q).not.toBeNull();
		expect(await n1).not.toBeNull();
		const older = client.nearest("how do we");
		const newer = client.nearest("how do we ship it");
		const [, , mo, mw] = w.sent as Array<{ id: number; req: { seq?: number } }>;
		w.reply(mo?.id ?? 0, { seq: mo?.req.seq, near: [], ms: 0 });
		w.reply(mw?.id ?? 0, { seq: mw?.req.seq, near: [], ms: 0 });
		expect(await older).toBeNull();
		expect(await newer).not.toBeNull();
	});
});

// ── Excerpts and phrases ───────────────────────────────────────────────────────

describe("QA: the excerpt's best line prefers the words as typed", () => {
	it("'cat dog' shows the line with cat and dog, not 'category ... dog'", () => {
		const x = cutExcerpt("The category of dog food.\nMy cat and my dog.", ["cat", "dog"], {
			exact: ["cat", "dog"],
		});
		expect(x?.line).toBe(1);
		expect(x?.text).toBe("My cat and my dog.");
	});

	it("'world' shows the line with world rather than the earlier line with the word form worlds", () => {
		const x = cutExcerpt("Two worlds apart.\nThe world today.", ["world", "worlds"], { exact: ["world"] });
		expect(x?.line).toBe(1);
	});
});

describe("QA: a quoted phrase is checked over all the text the index has", () => {
	it("keeps a note whose phrase is after the first 256 KB (the body is indexed to 2 MB)", async () => {
		const text = `${"filler words here. ".repeat(15000)}\nthe exact phrase here`;
		expect(text.length).toBeGreaterThan(256 * 1024);
		const hits = [{ path: "big.md", score: 1, matched: 2, edits: 0 }];
		const kept = await filterPhrases(hits, ["exact phrase"], () => Promise.resolve(text));
		expect(kept.map((h) => h.path)).toEqual(["big.md"]);
	});
});

// ── In-note search ─────────────────────────────────────────────────────────────

describe("QA: in-note rows never split a character", () => {
	it("a long line cut before the hit does not start inside an emoji's surrogate pair", () => {
		const line = `${"🙂".repeat(30)} word ${"x".repeat(200)}`;
		const h = new InNoteHost(new App() as never, new TFile("n.md"), { editor: { getValue: () => line } } as never);
		let out: Entry[] = [];
		h.list("word", (e) => (out = e));
		const row = out.find((e): e is Item => e.type === "item");
		expect(row).toBeDefined();
		const lone = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
		expect(lone.test(row?.title ?? "")).toBe(false);
	});
});

// ── Feeder ─────────────────────────────────────────────────────────────────────

describe("QA: a rename during the first build reaches the index", () => {
	it("the renamed note is indexed under its new path once the build ends", async () => {
		const app = new App();
		const files = (app.vault as unknown as { files: Map<string, TFile> }).files;
		files.set("Old.md", new TFile("Old.md"));
		const calls: Array<{ op: string; paths?: string[]; to?: string; notes?: Array<{ path: string }> }> = [];
		let finishBatch: (() => void) | null = null;
		const client = {
			running: true,
			call: (req: { op: string }) => {
				calls.push(req as (typeof calls)[number]);
				if (req.op === "open") return Promise.resolve({ loaded: false, notes: 0 });
				if (req.op === "batch") return new Promise((r) => (finishBatch = () => r({ notes: 1 })));
				return Promise.resolve({ notes: 1 });
			},
		} as unknown as JetClient;
		const feeder = new Feeder(app, client, "vault", () => []);
		const ready = feeder.ensure();
		await settle(10);
		expect(finishBatch).not.toBeNull();
		// While the build's batch is in the worker, the user renames the note.
		files.delete("Old.md");
		const renamed = new TFile("New.md");
		files.set("New.md", renamed);
		feeder.rename(renamed, "Old.md");
		(finishBatch as unknown as () => void)();
		await ready;
		await new Promise((r) => setTimeout(r, 700));
		const told = calls.some(
			(c) =>
				(c.op === "rename" && c.to === "New.md") ||
				(c.op === "upsert" && (c.notes ?? []).some((n) => n.path === "New.md")),
		);
		expect(told).toBe(true);
		feeder.stop();
	});
});

describe("QA (stress 15k): many changes at once keep the worker answering", () => {
	it("3,000 notes changed in one call: one delta build, frozen into segments, the right results", () => {
		const e = new JetEngine();
		const n = 3000;
		e.build(Array.from({ length: n }, (_, i) => note(`n${i}.md`, `alpha note ${i}`)));
		const t0 = performance.now();
		e.upsertMany(Array.from({ length: n }, (_, i) => note(`n${i}.md`, `omega note ${i}`)));
		const ms = performance.now() - t0;
		// One note at a time rebuilt the delta of every pending note: minutes at 15,000.
		expect(ms).toBeLessThan(5000);
		expect(e.shape.pending).toBeLessThan(256);
		expect(e.query(parseQuery("omega "), { limit: 5000 }).hits.length).toBe(n);
		expect(e.query(parseQuery("alpha "), { limit: 5000 }).hits.length).toBe(0);
		// Saved and loaded: still every note once.
		const s = e.save();
		const f = new JetEngine();
		f.load(s.base, s.sidecar);
		expect(f.mtimes().length).toBe(n);
		expect(f.query(parseQuery("omega "), { limit: 5000 }).hits.length).toBe(n);
	});
});
