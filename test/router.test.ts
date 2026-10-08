import { describe, expect, it } from "vitest";
import type { RawNote } from "../src/engine/fields";
import type { QueryReply } from "../src/worker/protocol";
import { INDEX_VERSION, Router } from "../src/worker/router";
import { memoryStore } from "../src/worker/store";

const timers = {
	set: (fn: () => void, ms: number) => setTimeout(fn, ms),
	clear: (h: unknown) => clearTimeout(h as number),
};

const raw = (path: string, text: string, extra: Partial<RawNote> = {}): RawNote => ({
	path,
	mtime: 1000,
	text,
	bodyStart: 0,
	aliases: [],
	headings: [],
	tags: [],
	links: [],
	inLinks: 0,
	...extra,
});

/** Timers the test fires by hand. */
const manualTimers = () => {
	let fn: (() => void) | null = null;
	return {
		set: (f: () => void) => {
			fn = f;
			return 1;
		},
		clear: () => {
			fn = null;
		},
		fire: () => {
			const f = fn;
			fn = null;
			f?.();
		},
	};
};

const ask = async (r: Router, text: string): Promise<string[]> =>
	((await r.handle({ op: "query", seq: 1, text, limit: 50, now: 0 })) as QueryReply).hits.map((h) => h.path);

const settle = () => new Promise((res) => setTimeout(res, 0));

describe("worker router", () => {
	it("builds in batches, saves on the last one, and loads it next time", async () => {
		const store = memoryStore();
		const r = new Router(() => store, timers);
		expect(await r.handle({ op: "open", vaultId: "v1", stemming: ["en"] })).toEqual({ loaded: false, notes: 0 });
		await r.handle({ op: "batch", notes: [raw("a.md", "orchid garden")], last: false });
		expect(await ask(r, "orchid ")).toEqual(["a.md"]);
		expect(store.saved).toBeNull();
		await r.handle({ op: "batch", notes: [raw("b.md", "orchid lantern")], last: true });
		expect(store.saved?.version).toBe(INDEX_VERSION);
		const next = new Router(() => store, timers);
		expect(await next.handle({ op: "open", vaultId: "v1", stemming: ["en"] })).toEqual({ loaded: true, notes: 2 });
		expect((await ask(next, "orchid ")).sort()).toEqual(["a.md", "b.md"]);
	});

	it("reads fields from what Obsidian gathered: headings, tags, aliases, links, body after frontmatter", async () => {
		const r = new Router(() => memoryStore(), timers);
		await r.handle({ op: "open", vaultId: "v", stemming: ["en"] });
		const text = "---\nsecret: frontmatter\n---\nbody words here";
		await r.handle({
			op: "batch",
			notes: [
				raw("n.md", text, {
					bodyStart: text.indexOf("body"),
					aliases: ["GreenHouse"],
					headings: [{ level: 1, text: "Quarry" }],
					tags: ["topic/rocks"],
					links: ["Other Note"],
				}),
			],
			last: true,
		});
		for (const q of ["quarry ", "greenhouse ", "rocks ", "other ", "body "])
			expect(await ask(r, q)).toEqual(["n.md"]);
		expect(await ask(r, "secret ")).toEqual([]);
	});

	it("saves only the sidecar after quiet edits, and merges when worth it", async () => {
		const store = memoryStore();
		const timers = manualTimers();
		const r = new Router(() => store, timers);
		await r.handle({ op: "open", vaultId: "v", stemming: ["en"] });
		await r.handle({
			op: "batch",
			notes: Array.from({ length: 30 }, (_, i) => raw(`n${i}.md`, `note ${i} meadow`)),
			last: true,
		});
		const base = store.saved?.base;
		await r.handle({ op: "upsert", notes: [raw("n1.md", "now about zebras")] });
		timers.fire();
		await settle();
		expect(store.saved?.base).toBe(base);
		expect(new TextDecoder().decode(store.saved?.sidecar)).toContain("zebras");
		const back = new Router(() => store, timers);
		await back.handle({ op: "open", vaultId: "v", stemming: ["en"] });
		expect(await ask(back, "zebras ")).toEqual(["n1.md"]);
	});

	it("rebuilds an index of another version or one that cannot be read", async () => {
		const store = memoryStore();
		await store.save({ base: new ArrayBuffer(64), sidecar: new Uint8Array(0), savedAt: 1, version: INDEX_VERSION });
		const r = new Router(() => store, timers);
		expect(await r.handle({ op: "open", vaultId: "v", stemming: ["en"] })).toEqual({ loaded: false, notes: 0 });
		await store.save({
			base: new ArrayBuffer(64),
			sidecar: new Uint8Array(0),
			savedAt: 1,
			version: INDEX_VERSION + 1,
		});
		expect(await new Router(() => store, timers).handle({ op: "open", vaultId: "v", stemming: ["en"] })).toEqual({
			loaded: false,
			notes: 0,
		});
	});

	it("keeps answers to the allowed notes, and clears the index", async () => {
		const store = memoryStore();
		const r = new Router(() => store, timers);
		await r.handle({ op: "open", vaultId: "v", stemming: ["en"] });
		await r.handle({ op: "batch", notes: [raw("x/a.md", "maple"), raw("y/b.md", "maple")], last: true });
		const q = (await r.handle({
			op: "query",
			seq: 7,
			text: "maple ",
			limit: 50,
			now: 0,
			allow: ["y/b.md"],
		})) as QueryReply;
		expect([q.seq, q.hits.map((h) => h.path)]).toEqual([7, ["y/b.md"]]);
		await r.handle({ op: "clear" });
		expect(store.saved).toBeNull();
		expect(await ask(r, "maple ")).toEqual([]);
	});
});

describe("scope sets in the worker", () => {
	const askIn = async (r: Router, text: string, scope: string): Promise<string[]> =>
		((await r.handle({ op: "query", seq: 1, text, limit: 50, now: 0, scope })) as QueryReply).hits
			.map((h) => h.path)
			.sort();

	it("keeps each scope's notes, follows deltas, renames and deletes, and filters queries by them", async () => {
		const r = new Router(() => memoryStore(), timers);
		await r.handle({ op: "open", vaultId: "v", stemming: [] });
		await r.handle({
			op: "batch",
			notes: [raw("a.md", "orchid garden"), raw("b.md", "orchid lantern"), raw("c.md", "orchid pebble")],
			last: true,
		});
		await r.handle({ op: "scope:set", id: "s1", paths: ["a.md", "b.md"] });
		expect(await askIn(r, "orchid ", "s1")).toEqual(["a.md", "b.md"]);
		await r.handle({ op: "scope:delta", id: "s1", add: ["c.md"], remove: ["a.md"] });
		expect(await askIn(r, "orchid ", "s1")).toEqual(["b.md", "c.md"]);
		await r.handle({ op: "rename", from: "b.md", to: "d.md" });
		expect(await askIn(r, "orchid ", "s1")).toEqual(["c.md", "d.md"]);
		await r.handle({ op: "delete", paths: ["c.md"] });
		expect(await askIn(r, "orchid ", "s1")).toEqual(["d.md"]);
		// An unknown scope answers nothing rather than everything.
		expect(await askIn(r, "orchid ", "nope")).toEqual([]);
		await r.handle({ op: "scope:clear" });
		expect(await askIn(r, "orchid ", "s1")).toEqual([]);
	});
});
