/**
 * QA (search by meaning): each test here is a bug found by review. They fail on the code as it
 * is; each says what should happen instead. Harness: the real Router behind a fake JetClient, the real
 * Feeder and Meaning on the Obsidian mock.
 */
import { afterEach, describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";
import type { RawNote } from "../src/engine/fields";
import type { JetData } from "../src/data";
import { normalizeData } from "../src/data";
import { Feeder } from "../src/index/feeder";
import { Meaning } from "../src/meaning/control";
import { packModel } from "../src/meaning/model";
import { isQuestion } from "../src/meaning/question";
import { basicTokens } from "../src/meaning/tokenizer";
import { MeaningConfirm } from "../src/settings/meaning-settings";
import type { JetClient } from "../src/worker/jet-client";
import type { NearReply, QueryReply, Request } from "../src/worker/protocol";
import { Router } from "../src/worker/router";
import { memoryStore } from "../src/worker/store";

const timers = {
	set: (fn: () => void, ms: number) => setTimeout(fn, ms),
	clear: (h: unknown) => clearTimeout(h as number),
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const never = <T>() => new Promise<T>(() => {});
const deferred = <T>() => {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((r) => (resolve = r));
	return { promise, resolve };
};

/** A tiny packed model (as in meaning-router.test.ts): "ship"/"release"/"deploy" one way, "cake"/"dessert" another. */
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
const near = async (r: Router, text: string): Promise<string[]> =>
	((await r.handle({ op: "nearest", seq: 1, text, k: 10 })) as NearReply).near.map((n) => n.path);

/** A vault on the Obsidian mock: notes by path with their text and mtime. */
const vaultWith = (notes: Array<[path: string, text: string, mtime: number]>) => {
	const app = new App();
	const texts = new Map<string, string>();
	for (const [path, text, mtime] of notes) {
		const f = new TFile(path);
		f.stat = { mtime, ctime: mtime, size: text.length };
		app.vault.files.set(path, f);
		texts.set(path, text);
	}
	const reads: { fail: Set<string> } = { fail: new Set() };
	(app.vault as unknown as { cachedRead: (f: TFile) => Promise<string> }).cachedRead = async (f) => {
		if (reads.fail.has(f.path)) throw new Error(`ENOENT: ${f.path}`);
		return texts.get(f.path) ?? "";
	};
	return { app, texts, reads };
};

/** A JetClient that hands requests to a Router in this thread; `hold` can answer some itself. */
const clientFor = (router: Router, hold?: (req: Request) => Promise<unknown> | undefined) => {
	const calls: Request[] = [];
	let running = false;
	const client = {
		get running() {
			return running;
		},
		call: (req: Request) => {
			running = true;
			calls.push(req);
			return hold?.(req) ?? router.handle(req);
		},
	};
	return { client: client as unknown as JetClient, calls };
};

/** An index saved by an earlier session (meaning off then), so this session opens it and catches up. */
const savedIndex = async (notes: RawNote[], withVectors = false) => {
	const store = memoryStore();
	const r = new Router(() => store, timers);
	await r.handle({ op: "open", vaultId: "v", stemming: [] });
	if (withVectors) await r.handle({ op: "meaning:load", buf: model(), model: "potion-base-8M" });
	await r.handle({ op: "batch", notes, last: true });
	return store;
};

const dataWith = (on: boolean, installed: boolean): JetData => {
	const d = normalizeData({});
	d.settings.meaning = on;
	d.meaningModel = installed ? { id: "potion-base-8M", bytes: 1234 } : null;
	return d;
};
const adapterOn = (app: App, a: Partial<Record<"exists" | "readBinary" | "writeBinary" | "remove", unknown>>) =>
	((app.vault as unknown as { adapter: unknown }).adapter = {
		exists: async () => true,
		readBinary: async () => model(),
		writeBinary: async () => {},
		remove: async () => {},
		...a,
	});

const NOTES: Array<[string, string, number]> = [
	["Releases.md", "ship release deploy", 1000],
	["Baking.md", "cake dessert", 1000],
];

// ── 1. A bad model file breaks word search ────────────────────────────────────────────

describe("an unreadable model file does not stop the index from opening", () => {
	const bad = (): Record<string, ArrayBuffer> => {
		const good = model();
		const old = good.slice(0);
		new DataView(old).setUint32(4, 0, true); // a packed file of another format version
		return {
			truncated: good.slice(0, Math.floor(good.byteLength * 0.6)),
			"old version": old,
			empty: new ArrayBuffer(0),
		};
	};
	for (const [name, buf] of Object.entries(bad()))
		it(`model file ${name}: the index still opens and words still answer`, async () => {
			const { app } = vaultWith(NOTES);
			const router = new Router(() => memoryStore(), timers);
			const { client } = clientFor(router);
			const feeder = new Feeder(app as never, client, "v", () => []);
			feeder.meaningModel = async () => buf;
			// Expected: meaning is skipped (with a warning); the word index is built as usual.
			await expect(feeder.ensure()).resolves.toBeUndefined();
			const r = (await router.handle({
				op: "query",
				seq: 1,
				text: "cake",
				limit: 5,
				now: Date.now(),
			})) as QueryReply;
			expect(r.hits.length).toBe(1);
		});
});

// ── 2. The index waits for every vector (and fails with them) ─────────────────────────

describe("word search does not wait for (or fail with) the embedding of missing notes", () => {
	it("a reopened index is ready before every note has its vector", async () => {
		const store = await savedIndex(NOTES.map(([p, t, m]) => raw(p, t, m)));
		const { app } = vaultWith(NOTES);
		const router = new Router(() => store, timers);
		// The embedding is slow (15k notes): its batches have not come back yet.
		const { client } = clientFor(router, (req) => (req.op === "meaning:embed" ? never() : undefined));
		const feeder = new Feeder(app as never, client, "v", () => []);
		feeder.meaningModel = async () => model();
		const first = await Promise.race([feeder.ensure().then(() => "ready"), sleep(200).then(() => "still waiting")]);
		expect(first).toBe("ready");
	});

	it("a note that cannot be read while vectors are made does not make the index fail to open", async () => {
		const store = await savedIndex(NOTES.map(([p, t, m]) => raw(p, t, m)));
		const { app, reads } = vaultWith(NOTES);
		reads.fail.add("Baking.md"); // deleted (or synced away) between the list and the read
		const router = new Router(() => store, timers);
		const { client } = clientFor(router);
		const feeder = new Feeder(app as never, client, "v", () => []);
		feeder.meaningModel = async () => model();
		await expect(feeder.ensure()).resolves.toBeUndefined();
	});
});

// ── 3. Notes with no known word are missing for ever ──────────────────────────────────

describe("a note with no known word is embedded once, not every time", () => {
	it("is not reported missing again after it was embedded", async () => {
		const r = new Router(() => memoryStore(), timers);
		await r.handle({ op: "open", vaultId: "v", stemming: [] });
		await r.handle({ op: "meaning:load", buf: model(), model: "potion-base-8M" });
		await r.handle({ op: "batch", notes: [raw("Ship.md", "ship"), raw("Z.md", "zzz qqq")], last: true });
		await r.handle({ op: "meaning:embed", notes: [raw("Z.md", "zzz qqq")] });
		expect(await r.handle({ op: "meaning:missing" })).toEqual([]);
	});
});

// ── 4. Turned on while the index builds: ignored until the worker restarts ────────────

describe("meaning turned on during the first build reaches the worker", () => {
	it("after the build, questions are answered by meaning", async () => {
		const { app } = vaultWith(NOTES);
		const router = new Router(() => memoryStore(), timers);
		const building = deferred<void>();
		let sent = false;
		const { client } = clientFor(router, (req) => {
			if (req.op !== "batch") return undefined;
			sent = true;
			return building.promise.then(() => router.handle(req));
		});
		const feeder = new Feeder(app as never, client, "v", () => []);
		let on = false;
		feeder.meaningModel = async () => (on ? model() : null);
		const ready = feeder.ensure();
		while (!sent) await sleep(1); // the first build is under way (a big vault: a minute)
		// The model was installed (or the toggle turned on) while the first build runs.
		on = true;
		await feeder.meaningChanged(true);
		building.resolve();
		await ready;
		await sleep(10);
		expect(await near(router, "how do we deploy")).toContain("Releases.md");
	});
});

// ── 5. On then off quickly: the worker ends up on ─────────────────────────────────────

describe("on then off quickly leaves meaning off in the worker", () => {
	it("the late model load after an off is dropped", async () => {
		const { app } = vaultWith(NOTES);
		const file = deferred<ArrayBuffer>();
		adapterOn(app, { readBinary: () => file.promise });
		const router = new Router(() => memoryStore(), timers);
		const { client } = clientFor(router);
		const feeder = new Feeder(app as never, client, "v", () => []);
		const data = dataWith(false, true);
		const meaning = new Meaning(
			app as never,
			"plugin",
			() => data,
			() => {},
			feeder,
		);
		await feeder.ensure();
		const turningOn = meaning.set(true); // reads the 8 MB model…
		await meaning.set(false); // …and is turned off before that read ends
		file.resolve(model());
		await turningOn;
		await sleep(10);
		expect(data.settings.meaning).toBe(false);
		// Off means no model and no vectors in the worker.
		expect(await near(router, "how do we deploy")).toEqual([]);
	});
});

// ── 6. Remove while the worker sleeps keeps the vectors ───────────────────────────────

describe("Remove the model forgets the saved vectors even while the worker sleeps", () => {
	it("no vectors are left in the store after Remove", async () => {
		const store = await savedIndex(
			NOTES.map(([p, t, m]) => raw(p, t, m)),
			true,
		);
		expect(store.vectors?.paths.length).toBe(2);
		const { app } = vaultWith(NOTES);
		adapterOn(app, {});
		const router = new Router(() => store, timers);
		const { client } = clientFor(router); // not running: Jet was idle for 10 minutes
		const feeder = new Feeder(app as never, client, "v", () => []);
		const data = dataWith(true, true);
		const meaning = new Meaning(
			app as never,
			"plugin",
			() => data,
			() => {},
			feeder,
		);
		await meaning.remove();
		await feeder.ensure(); // the next search wakes the worker
		await router.handle({ op: "save" });
		expect(store.vectors).toBeNull();
	});
});

// ── 7. The model file is gone but meaning still claims to answer ──────────────────────

describe("with its model file gone, meaning is not offered", () => {
	it("is not available once the feeder found no model file", async () => {
		const { app } = vaultWith(NOTES);
		adapterOn(app, { exists: async () => false }); // data.json synced from another device; the .bin was not
		const router = new Router(() => memoryStore(), timers);
		const { client } = clientFor(router);
		const feeder = new Feeder(app as never, client, "v", () => []);
		const data = dataWith(true, true);
		const meaning = new Meaning(
			app as never,
			"plugin",
			() => data,
			() => {},
			feeder,
		);
		await feeder.ensure();
		// Questions would otherwise go to an empty "By meaning" list ("Nothing near … yet") for ever.
		expect(meaning.available()).toBe(false);
	});
});

// ── 8. Embedding is not newest first ──────────────────────────────────────────────────

describe("vectors are made newest notes first", () => {
	it("the note edited last is in the first batch", async () => {
		const notes: Array<[string, string, number]> = Array.from({ length: 150 }, (_, i) => [
			`N${i}.md`,
			"ship release",
			i + 1,
		]);
		const { app } = vaultWith(notes);
		const router = new Router(() => memoryStore(), timers);
		const { client, calls } = clientFor(router);
		const feeder = new Feeder(app as never, client, "v", () => []);
		let on = false;
		feeder.meaningModel = async () => (on ? model() : null);
		await feeder.ensure();
		// The oldest note is edited: now it is the newest.
		const f = app.vault.getFileByPath("N0.md") as TFile;
		f.stat = { ...f.stat, mtime: 10_000 };
		await router.handle({ op: "upsert", notes: [raw("N0.md", "ship release", 10_000)] });
		on = true;
		await feeder.meaningChanged(true);
		const batches = calls.filter((c): c is Extract<Request, { op: "meaning:embed" }> => c.op === "meaning:embed");
		expect(batches.length).toBe(2);
		expect(batches[0]?.notes.map((n) => n.path)).toContain("N0.md");
	});
});

// ── 9. Stale embed batches overwrite newer state ──────────────────────────────────────

describe("a vector batch read before a delete or an edit does not undo it", () => {
	it("a note deleted while its batch was read does not come back as a vector", async () => {
		const r = new Router(() => memoryStore(), timers);
		await r.handle({ op: "open", vaultId: "v", stemming: [] });
		await r.handle({ op: "batch", notes: [raw("A.md", "ship"), raw("B.md", "cake")], last: true });
		await r.handle({ op: "meaning:load", buf: model(), model: "potion-base-8M" });
		const batch = [raw("A.md", "ship"), raw("B.md", "cake")]; // read by the feeder…
		await r.handle({ op: "delete", paths: ["B.md"] }); // …B deleted meanwhile (flush wins the race)
		await r.handle({ op: "meaning:embed", notes: batch });
		expect(await near(r, "dessert")).not.toContain("B.md");
	});

	it("an edit sent while a batch was read keeps its newer vector", async () => {
		const r = new Router(() => memoryStore(), timers);
		await r.handle({ op: "open", vaultId: "v", stemming: [] });
		await r.handle({ op: "batch", notes: [raw("A.md", "ship"), raw("B.md", "cake")], last: true });
		await r.handle({ op: "meaning:load", buf: model(), model: "potion-base-8M" });
		await r.handle({ op: "meaning:embed", notes: [raw("B.md", "cake")] });
		const batch = [raw("A.md", "ship", 1000)]; // read by the feeder…
		await r.handle({ op: "upsert", notes: [raw("A.md", "cake dessert", 2000)] }); // …then edited
		await r.handle({ op: "meaning:embed", notes: batch });
		expect((await near(r, "dessert"))[0]).toBe("A.md");
		expect(await r.handle({ op: "meaning:missing" })).toEqual([]);
	});
});

// ── 10. Progress stuck after a failed or interrupted embedding ────────────────────────

describe("the settings' progress ends when the embedding stops", () => {
	it("is cleared when a batch fails (the worker went to sleep or stopped)", async () => {
		const { app } = vaultWith(NOTES);
		const router = new Router(() => memoryStore(), timers);
		const { client } = clientFor(router, (req) =>
			req.op === "meaning:embed" ? Promise.reject(new Error("Jet Search: the worker stopped")) : undefined,
		);
		const feeder = new Feeder(app as never, client, "v", () => []);
		let on = false;
		feeder.meaningModel = async () => (on ? model() : null);
		await feeder.ensure();
		on = true;
		await expect(feeder.meaningChanged(true)).rejects.toThrow();
		// Otherwise the settings say "Giving notes their meaning: 0 of 2…" until the next embedding.
		expect(feeder.meaningProgress).toBeNull();
	});
});

// ── 11. The question rule ─────────────────────────────────────────────────────────────

describe("the question rule", () => {
	it("a question word with a contraction is a question", () => {
		expect(isQuestion("what's the plan for the launch")).toBe(true);
		expect(isQuestion("what’s the plan for the launch")).toBe(true); // typographic apostrophe (macOS, iOS)
		expect(isQuestion("how's the migration going")).toBe(true);
		expect(isQuestion("where's the billing runbook")).toBe(true);
	});

	it("a time or a URL is not a filter piece", () => {
		expect(isQuestion("what happened at the 10:30 standup")).toBe(true);
		expect(isQuestion("how do we redirect https://example.com/docs")).toBe(true);
	});

	it("only the listed question words start a question: a name like Will stays a word search", () => {
		expect(isQuestion("Will Smith interview notes")).toBe(false);
		expect(isQuestion("Have I Been Pwned breach list")).toBe(false);
	});
});

// ── 12. Tokenizer vs Hugging Face's BertNormalizer ────────────────────────────────────

describe("the tokenizer normalizes as Hugging Face's BertNormalizer (Rust) does", () => {
	it("line and paragraph separators (U+2028/U+2029) are whitespace", () => {
		expect(basicTokens("release\u2028notes")).toEqual(["release", "notes"]);
		expect(basicTokens("ship\u2029it")).toEqual(["ship", "it"]);
	});

	it("lower case is per character: a final capital sigma becomes σ, not ς", () => {
		expect(basicTokens("ΟΔΟΣ")).toEqual(["οδοσ"]);
	});

	it("private-use characters are removed (is_other: Cc, Cf, Co, Cn)", () => {
		expect(basicTokens("re\uE000lease")).toEqual(["release"]);
	});
});

// ── 13. The model loads at the first search, not the first question ───────────────────

describe("the model loads on the first question of a session", () => {
	it("a session of keyword searches does not read the model", async () => {
		const { app } = vaultWith(NOTES);
		const router = new Router(() => memoryStore(), timers);
		const { client } = clientFor(router);
		const feeder = new Feeder(app as never, client, "v", () => []);
		let reads = 0;
		feeder.meaningModel = async () => {
			reads++;
			return model();
		};
		await feeder.ensure(); // the first search of the session: "deployment checklist"
		expect(reads).toBe(0);
	});
});

// ── 14. The confirm closed mid-download ───────────────────────────────────────────────

describe("the confirm closed (Esc) while downloading", () => {
	afterEach(() => document.body.replaceChildren());

	it("reports the real outcome: the install it started still turns meaning on", async () => {
		const install = deferred<void>();
		const fake = { busy: "Downloading the model…", install: () => install.promise };
		const outcomes: boolean[] = [];
		const m = new MeaningConfirm(new App() as never, fake as never, 2, (ok) => outcomes.push(ok));
		(m as unknown as { titleEl: HTMLElement }).titleEl = document.createElement("div");
		m.open();
		m.contentEl.querySelector<HTMLButtonElement>("button.mod-cta")?.click();
		(m.scope as unknown as { press(k: string): boolean }).press("Escape"); // Cancel is disabled; Esc is not
		install.resolve();
		await sleep(0);
		// The toggle was redrawn "off" at Esc, then the download finished and turned meaning on.
		expect(outcomes).toEqual([true]);
	});
});
