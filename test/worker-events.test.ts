import { describe, expect, it } from "vitest";
import { INDEX_VERSION, Router } from "../src/worker/router";
import { memoryStore, type Store } from "../src/worker/store";
import type { RawNote } from "../src/engine/fields";
import type { Reply } from "../src/worker/protocol";
import type { WorkerEvent } from "../src/diag/diag";
import { packModel } from "../src/meaning/model";

/** A tiny meaning model (two words), enough to load. */
const tinyModel = (): ArrayBuffer => {
	const vocab = { "[PAD]": 0, "[UNK]": 1, ship: 2 };
	const rows = [
		[0, 0, 0],
		[0, 0, 0],
		[1, 0.1, 0],
	];
	const header = JSON.stringify({
		e: { dtype: "F32", shape: [rows.length, 3], data_offsets: [0, rows.length * 12] },
	});
	const h = new TextEncoder().encode(header.padEnd(header.length + ((4 - ((8 + header.length) % 4)) % 4), " "));
	const buf = new ArrayBuffer(8 + h.byteLength + rows.length * 12);
	new DataView(buf).setBigUint64(0, BigInt(h.byteLength), true);
	new Uint8Array(buf, 8, h.byteLength).set(h);
	new Float32Array(buf, 8 + h.byteLength).set(rows.flat());
	return packModel(buf, JSON.stringify({ model: { unk_token: "[UNK]", vocab } }), 256);
};

const still = { set: () => 0, clear: () => {} };

const raw = (path: string, text: string): RawNote => ({
	path,
	mtime: 1,
	text,
	bodyStart: 0,
	aliases: [],
	headings: [],
	tags: [],
	links: [],
	inLinks: 0,
});

type Heard = { code: string; level: string; name: string }[];
const hear = (): { heard: Heard; notify: (code: string, e: unknown, level: "error" | "warn") => void } => {
	const heard: Heard = [];
	return {
		heard,
		notify: (code, e, level) => heard.push({ code, level, name: e instanceof Error ? e.name : typeof e }),
	};
};

const open = (r: Router) => r.handle({ op: "open", vaultId: "v", stemming: [] }) as Promise<Reply<{ op: "open" }>>;

describe("how the saved index opened", () => {
	it("says nothing was saved yet, and where the index is kept", async () => {
		const r = new Router(() => memoryStore(), still);
		const o = await open(r);
		expect(o).toMatchObject({ loaded: false, how: "none", store: "memory", found: null, version: INDEX_VERSION });
		expect(o.ms).toBeGreaterThanOrEqual(0);
	});

	it("says it loaded the saved index", async () => {
		const store = memoryStore();
		const first = new Router(() => store, still);
		await open(first);
		await first.handle({ op: "batch", notes: [raw("a.md", "alpha beta")], last: true });
		const o = await open(new Router(() => store, still));
		expect(o).toMatchObject({ loaded: true, how: "loaded", notes: 1 });
	});

	it("says the saved index is of another format, and which", async () => {
		const store = memoryStore();
		const first = new Router(() => store, still);
		await open(first);
		await first.handle({ op: "batch", notes: [raw("a.md", "alpha")], last: true });
		if (store.saved) store.saved.version = INDEX_VERSION - 1;
		const o = await open(new Router(() => store, still));
		expect(o).toMatchObject({ loaded: false, how: "format-changed", found: INDEX_VERSION - 1 });
	});

	it("says the saved index could not be read, and tells the main thread what failed (no message)", async () => {
		const store = memoryStore();
		const first = new Router(() => store, still);
		await open(first);
		await first.handle({ op: "batch", notes: [raw("a.md", "alpha")], last: true });
		if (store.saved) store.saved.sidecar = new TextEncoder().encode("{ not json /Vault/Secret Plans.md");
		const { heard, notify } = hear();
		const o = await open(new Router(() => store, still, undefined, notify));
		expect(o).toMatchObject({ loaded: false, how: "error" });
		expect(heard).toEqual([{ code: "index.read", level: "warn", name: "SyntaxError" }]);
	});

	it("names the kind of store the router was given", async () => {
		const kept: Store = { ...memoryStore(), kind: "indexeddb" };
		const o = await open(new Router(() => kept, still));
		expect(o.store).toBe("indexeddb");
		const unnamed = memoryStore();
		delete (unnamed as { kind?: string }).kind;
		expect((await open(new Router(() => unnamed, still))).store).toBe("other");
	});
});

describe("what the worker catches, it tells", () => {
	it("a save that fails after the first build", async () => {
		const store = memoryStore();
		store.save = () => Promise.reject(new RangeError("disk full at /Vault/Secret Plans.md"));
		const { heard, notify } = hear();
		const r = new Router(() => store, still, undefined, notify);
		await open(r);
		await r.handle({ op: "batch", notes: [raw("a.md", "alpha")], last: true });
		expect(heard).toEqual([{ code: "index.save", level: "warn", name: "RangeError" }]);
	});

	it("a damaged index found by a query, and the clear that then fails", async () => {
		const store = memoryStore();
		store.clear = () => Promise.reject(new Error("blocked"));
		const { heard, notify } = hear();
		const r = new Router(() => store, still, undefined, notify);
		await open(r);
		await r.handle({ op: "batch", notes: [raw("a.md", "alpha")], last: true });
		r.engine.query = () => {
			throw new TypeError("bad byte");
		};
		const reply = r.query({ op: "query", seq: 1, text: "alpha", limit: 10, now: 0 });
		expect(reply.broken).toBe(true);
		await new Promise((x) => setTimeout(x, 0));
		expect(heard.map((h) => h.code)).toEqual(["index.damaged", "index.clear"]);
		expect(heard[0]).toMatchObject({ level: "error", name: "TypeError" });
	});

	it("note vectors that cannot be read", async () => {
		const store = memoryStore();
		store.loadVectors = () => Promise.reject(new RangeError("x"));
		const { heard, notify } = hear();
		const r = new Router(() => store, still, undefined, notify);
		await open(r);
		await r.handle({ op: "meaning:load", buf: tinyModel(), model: "tiny" });
		expect(heard).toEqual([{ code: "vectors.read", level: "warn", name: "RangeError" }]);
	});

	it("nothing is told when nothing goes wrong", async () => {
		const { heard, notify } = hear();
		const r = new Router(() => memoryStore(), still, undefined, notify);
		await open(r);
		await r.handle({ op: "batch", notes: [raw("a.md", "alpha")], last: true });
		r.query({ op: "query", seq: 1, text: "alpha", limit: 10, now: 0 });
		expect(heard).toEqual([]);
	});

	it("an event holds only a code, a level, an error class and a place", () => {
		const ev: WorkerEvent = { code: "index.save", level: "warn", error: "RangeError", where: "worker:f:1:2" };
		expect(Object.keys(ev).sort()).toEqual(["code", "error", "level", "where"]);
	});
});
