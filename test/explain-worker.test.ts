import { describe, expect, it } from "vitest";
import type { WordsExplanation } from "../src/engine/explain";
import type { RawNote } from "../src/engine/fields";
import type { MeaningExplanation } from "../src/meaning/explain";
import { packModel } from "../src/meaning/model";
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

const ready = async (withMeaning = true): Promise<Router> => {
	const r = new Router(() => memoryStore(), timers);
	await r.handle({ op: "open", vaultId: "v", stemming: [] });
	if (withMeaning) await r.handle({ op: "meaning:load", buf: model(), model: "tiny" });
	await r.handle({
		op: "batch",
		notes: [raw("Releases.md", "ship release"), raw("Baking.md", "cake dessert"), raw("Misc.md", "zzz qqq")],
		last: true,
	});
	return r;
};
const words = async (r: Router, text: string, path: string | null, extra: object = {}): Promise<WordsExplanation> =>
	(await r.handle({ op: "explain", mode: "words", text, path, limit: 50, now: 2000, ...extra })) as WordsExplanation;
const meaning = async (r: Router, text: string, path: string | null, extra: object = {}): Promise<MeaningExplanation> =>
	(await r.handle({
		op: "explain",
		mode: "meaning",
		text,
		path,
		limit: 2,
		now: 2000,
		...extra,
	})) as MeaningExplanation;

describe("explaining in the worker", () => {
	it("explains a words search and a note in it", async () => {
		const r = await ready();
		const x = await words(r, "ship release", "Releases.md");
		expect(x.kind).toBe("words");
		expect(x.note?.rank).toBe(1);
		expect(x.list.withAll).toBe(1);
	});

	it("keeps a scope's notes to the scope: a note outside it is outside", async () => {
		const r = await ready();
		await r.handle({ op: "scope:set", id: "s1", paths: ["Baking.md"] });
		const x = await words(r, "ship release", "Releases.md", { scope: "s1" });
		expect(x.note?.allowed).toBe(false);
		expect(x.note?.rank).toBeNull();
		expect((await words(r, "cake", "Baking.md", { scope: "s1" })).note?.allowed).toBe(true);
	});

	it("explains a search by meaning: the note's rank and score are the ones nearest gives", async () => {
		const r = await ready();
		const near = (await r.handle({ op: "nearest", seq: 1, text: "how do we deploy", k: 5 })) as {
			near: Array<{ path: string; score: number }>;
		};
		const x = await meaning(r, "how do we deploy", "Baking.md");
		expect(x.on).toBe(true);
		expect(x.understood).toBe(true);
		expect(x.note?.rank).toBe(near.near.findIndex((n) => n.path === "Baking.md") + 1);
		expect(x.note?.score).toBeCloseTo(near.near.find((n) => n.path === "Baking.md")?.score ?? 99, 6);
		expect(x.list.best).toBeCloseTo(near.near[0]?.score ?? 99, 6);
		expect(x.vectors.indexed).toBe(3);
	});

	it("says a note with no word the model knows has no meaning to be near by", async () => {
		const r = await ready();
		expect((await meaning(r, "deploy", "Misc.md")).note?.vector).toBe("none");
	});

	it("says a note waiting for its vector is waiting, and a note the index lacks is not indexed", async () => {
		// Meaning turned on after the notes were indexed: none has a vector until they are embedded.
		const r = await ready(false);
		await r.handle({ op: "meaning:load", buf: model(), model: "tiny" });
		const x = await meaning(r, "deploy", "Releases.md");
		expect(x.note?.indexed).toBe(true);
		expect(x.note?.vector).toBe("waiting");
		expect(x.note?.rank).toBeNull();
		const y = await meaning(r, "deploy", "Nowhere.md");
		expect(y.note?.indexed).toBe(false);
		expect(y.note?.vector).toBe("waiting");
	});

	it("says meaning is off when no model is loaded", async () => {
		const r = await ready(false);
		const x = await meaning(r, "deploy", "Releases.md");
		expect(x.on).toBe(false);
		expect(x.note?.rank).toBeNull();
	});

	it("says a question with no word the model knows is not understood", async () => {
		const r = await ready();
		expect((await meaning(r, "zzz qqq", null)).understood).toBe(false);
	});

	it("changes nothing: the next search is the same", async () => {
		const r = await ready();
		const before = JSON.stringify(await r.handle({ op: "query", seq: 1, text: "ship", limit: 5, now: 2000 }));
		await words(r, "ship", "Releases.md");
		await meaning(r, "ship", "Releases.md");
		expect(
			JSON.stringify(
				await r
					.handle({ op: "query", seq: 2, text: "ship", limit: 5, now: 2000 })
					.then((x) => ({ ...(x as object), seq: 1, ms: 0 })),
			),
		).toBe(JSON.stringify({ ...(JSON.parse(before) as object), ms: 0 }));
	});
});
