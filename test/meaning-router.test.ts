import { describe, expect, it } from "vitest";
import type { RawNote } from "../src/engine/fields";
import { packModel } from "../src/meaning/model";
import type { NearReply } from "../src/worker/protocol";
import { Router } from "../src/worker/router";
import { memoryStore } from "../src/worker/store";

const timers = {
	set: (fn: () => void, ms: number) => setTimeout(fn, ms),
	clear: (h: unknown) => clearTimeout(h as number),
};

/** A tiny model: "ship" and "release" point one way, "cake" and "dessert" another. */
const model = (): ArrayBuffer => {
	const vocab = { "[PAD]": 0, "[UNK]": 1, ship: 2, release: 3, cake: 4, dessert: 5, deploy: 6 };
	const rows = [
		[0, 0, 0],
		[0, 0, 0],
		[1, 0.1, 0],
		[0.9, 0.2, 0],
		[0, 0.1, 1],
		[0, 0, 0.9],
		[0.95, 0.15, 0],
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
const raw = (path: string, text: string, mtime = 1000): RawNote => ({
	path,
	mtime,
	text,
	bodyStart: 0,
	aliases: [],
	headings: [],
	tags: [],
	links: [],
	inLinks: 0,
});
const near = async (r: Router, text: string, extra: object = {}): Promise<string[]> =>
	((await r.handle({ op: "nearest", seq: 1, text, k: 5, ...extra })) as NearReply).near.map((n) => n.path);

describe("search by meaning in the worker", () => {
	it("gives notes vectors as they come, answers by nearness, follows deletes and renames", async () => {
		const r = new Router(() => memoryStore(), timers);
		await r.handle({ op: "open", vaultId: "v", stemming: [] });
		await r.handle({ op: "meaning:load", buf: model(), model: "tiny" });
		await r.handle({
			op: "batch",
			notes: [raw("Releases.md", "ship release"), raw("Baking.md", "cake dessert")],
			last: true,
		});
		expect(await near(r, "how do we deploy")).toEqual(["Releases.md", "Baking.md"]);
		expect((await near(r, "dessert ideas"))[0]).toBe("Baking.md");
		expect(await near(r, "how do we deploy", { allow: ["Baking.md"] })).toEqual(["Baking.md"]);
		await r.handle({ op: "rename", from: "Baking.md", to: "Kitchen.md" });
		await r.handle({ op: "delete", paths: ["Releases.md"] });
		expect(await near(r, "deploy")).toEqual(["Kitchen.md"]);
		expect(await near(r, "zzz qqq")).toEqual([]);
	});

	it("turned on later: the index's notes are missing until embedded; vectors are saved and come back", async () => {
		const store = memoryStore();
		const r = new Router(() => store, timers);
		await r.handle({ op: "open", vaultId: "v", stemming: [] });
		await r.handle({ op: "batch", notes: [raw("A.md", "ship"), raw("B.md", "cake")], last: true });
		const loaded = (await r.handle({ op: "meaning:load", buf: model(), model: "tiny" })) as { missing: number };
		expect(loaded.missing).toBe(2);
		expect(await r.handle({ op: "meaning:missing" })).toEqual(["A.md", "B.md"]);
		await r.handle({ op: "meaning:embed", notes: [raw("A.md", "ship"), raw("B.md", "cake")] });
		expect(await r.handle({ op: "meaning:missing" })).toEqual([]);
		await r.handle({ op: "save" });
		expect(store.vectors?.paths.length).toBe(2);
		const next = new Router(() => store, timers);
		await next.handle({ op: "open", vaultId: "v", stemming: [] });
		const again = (await next.handle({ op: "meaning:load", buf: model(), model: "tiny" })) as {
			missing: number;
			vectors: number;
		};
		expect(again).toMatchObject({ missing: 0, vectors: 2 });
		// A note edited since: its vector is stale.
		await next.handle({ op: "upsert", notes: [raw("A.md", "cake", 2000)] });
		expect(await next.handle({ op: "meaning:missing" })).toEqual([]);
		expect((await near(next, "dessert"))[0]).toBe("A.md");
	});

	it("off: no answers, and forget deletes the saved vectors", async () => {
		const store = memoryStore();
		const r = new Router(() => store, timers);
		await r.handle({ op: "open", vaultId: "v", stemming: [] });
		await r.handle({ op: "meaning:load", buf: model(), model: "tiny" });
		await r.handle({ op: "batch", notes: [raw("A.md", "ship")], last: true });
		expect(store.vectors?.paths).toEqual(["A.md"]);
		await r.handle({ op: "meaning:off", forget: true });
		expect(await near(r, "ship")).toEqual([]);
		expect(store.vectors).toBeNull();
	});
});
