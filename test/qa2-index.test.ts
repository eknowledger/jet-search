/**
 * QA: the index's persistence and recovery under faults (store, router, client and worker,
 * feeder, status, engine save/load). Every test here fails on the code as it is
 * and names the behaviour it expects.
 *
 * Harness: the real Router behind a fake JetClient (or behind a stubbed Worker for the real
 * JetClient), the real Feeder on the Obsidian mock, and memoryStore() for IndexedDB.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, TFile } from "obsidian";
import type { RawNote } from "../src/engine/fields";
import { Feeder } from "../src/index/feeder";
import { clearIndex, indexStatus, rebuild } from "../src/index-status";
import JetSearchPlugin from "../src/main";
import { JetClient } from "../src/worker/jet-client";
import type { QueryReply, Request } from "../src/worker/protocol";
import { Router } from "../src/worker/router";
import { memoryStore, type Store } from "../src/worker/store";

// ── Harness ───────────────────────────────────────────────────────────────────

/** Router timers that never fire (no idle merge or save unless a test asks). */
const still = { set: () => 0, clear: () => {} };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => (resolve = r));
	return { promise, resolve };
};

const raw = (path: string, text: string, mtime = 0): RawNote => ({
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

const ask = async (r: Router, text: string): Promise<string[]> =>
	((await r.handle({ op: "query", seq: 1, text, limit: 50, now: 0 })) as QueryReply).hits.map((h) => h.path).sort();

/**
 * A vault on the Obsidian mock. Reads see the text as it is when the read starts (as Obsidian's
 * cachedRead does); `holdNext(path)` makes the next read of that note wait until released.
 */
const vault = (notes: Array<[path: string, text: string, mtime: number]>, app = new App()) => {
	const texts = new Map<string, string>();
	const files = app.vault.files;
	const holds = new Map<string, { promise: Promise<void>; started: () => void }>();
	const add = (path: string, text: string, mtime = 0): TFile => {
		const f = new TFile(path);
		f.stat = { mtime, ctime: mtime, size: text.length };
		files.set(path, f);
		texts.set(path, text);
		return f;
	};
	for (const [p, t, m] of notes) add(p, t, m);
	(app.vault as unknown as { cachedRead: (f: TFile) => Promise<string> }).cachedRead = async (f) => {
		const text = texts.get(f.path);
		const h = holds.get(f.path);
		if (h) {
			holds.delete(f.path);
			h.started();
			await h.promise;
		}
		if (text === undefined) throw new Error(`ENOENT: ${f.path}`);
		return text;
	};
	return {
		app,
		texts,
		add,
		/** Change a note's text and modified time (Obsidian mutates the TFile's stat in place). */
		edit(path: string, text: string, mtime: number): TFile {
			const f = files.get(path) as TFile;
			f.stat = { mtime, ctime: f.stat.ctime, size: text.length };
			texts.set(path, text);
			return f;
		},
		remove(path: string): TFile {
			const f = files.get(path) as TFile;
			files.delete(path);
			texts.delete(path);
			return f;
		},
		/** The mock's TFile path is fixed: a renamed note is a new TFile with the same text and stat. */
		rename(from: string, to: string): TFile {
			const old = files.get(from) as TFile;
			const text = texts.get(from) ?? "";
			files.delete(from);
			texts.delete(from);
			const f = new TFile(to);
			f.stat = old.stat;
			files.set(to, f);
			texts.set(to, text);
			return f;
		},
		/** The next read of `path` waits for `release()`; `started()` says whether it began. */
		holdNext(path: string): { release: () => void; started: () => boolean } {
			const d = deferred();
			let began = false;
			holds.set(path, { promise: d.promise, started: () => (began = true) });
			return { release: d.resolve, started: () => began };
		},
	};
};

/** A JetClient that hands every request to a Router in this thread. */
const clientFor = (router: Router) =>
	({
		running: true,
		call: (req: Request) => router.handle(req),
	}) as unknown as JetClient;

/** An index saved by an earlier session, holding these notes. */
const savedWith = async (notes: RawNote[], store = memoryStore()) => {
	const r = new Router(() => store, still);
	await r.handle({ op: "open", vaultId: "test vault", stemming: [] });
	await r.handle({ op: "batch", notes, last: true });
	return store;
};

/** A live feeder (its first build done) over a fresh router and store. */
const liveFeeder = async (v: ReturnType<typeof vault>, exclude: string[] = []) => {
	const store = memoryStore();
	const router = new Router(() => store, still);
	const feeder = new Feeder(
		v.app as never,
		clientFor(router),
		"test vault",
		() => exclude,
		() => [],
	);
	await feeder.ensure();
	return { feeder, router, store };
};

/** A Worker class whose every instance runs its own Router over one shared store (a worker per wake). */
const stubWorkers = (store: Store) => {
	const made: Router[] = [];
	vi.stubGlobal(
		"Worker",
		class {
			onmessage: ((e: { data: unknown }) => void) | null = null;
			onerror: unknown = null;
			private dead = false;
			private readonly router = new Router(() => store, still);
			constructor() {
				made.push(this.router);
			}
			postMessage(msg: { id: number; req: Request }): void {
				void this.router.handle(msg.req).then(
					(result) => !this.dead && this.onmessage?.({ data: { id: msg.id, result } }),
					(e: unknown) => !this.dead && this.onmessage?.({ data: { id: msg.id, error: String(e) } }),
				);
			}
			terminate(): void {
				this.dead = true;
			}
		},
	);
	return made;
};

/** Jet loaded in the mock app over this vault, with the given data.json. */
const plugin = async (v: ReturnType<typeof vault>, data: unknown) => {
	const p = new JetSearchPlugin(v.app as never, { id: "jet-search", name: "Jet", version: "0.0.1" } as never);
	(p as unknown as { data: unknown }).data = data;
	await p.onload();
	return p;
};

const waitFor = async (ok: () => boolean, ms = 2000): Promise<void> => {
	const t0 = Date.now();
	while (!ok()) {
		if (Date.now() - t0 > ms) throw new Error("timed out waiting");
		await sleep(5);
	}
};

const plugins: JetSearchPlugin[] = [];
afterEach(() => {
	for (const p of plugins.splice(0)) p.unload();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

// ── Findings ──────────────────────────────────────────────────────────────────

describe("Rebuild while the worker is asleep", () => {
	it("reads every note again: a saved index with stale text is not kept by Rebuild", async () => {
		// The saved index says a.md holds "zebra"; the note says "giraffe", with the same modified
		// time (a sync that kept the time, or any index damage the catch-up cannot see by mtime).
		const store = await savedWith([raw("a.md", "zebra", 0)]);
		const v = vault([["a.md", "giraffe", 0]]);
		stubWorkers(store);
		const p = await plugin(v, { indexedAt: 1 });
		plugins.push(p);
		// Settings opened more than 10 minutes after the last search: the worker sleeps.
		expect(p.client.running).toBe(false);
		await rebuild(p);
		const hits = (await p.client.query("giraffe "))?.hits.map((h) => h.path);
		expect(hits).toEqual(["a.md"]);
	});
});

describe("Clear index while the worker is asleep", () => {
	it("deletes the saved index from the device", async () => {
		const store = await savedWith([raw("private.md", "budget review notes", 0)]);
		const v = vault([["private.md", "budget review notes", 0]]);
		stubWorkers(store);
		const p = await plugin(v, { indexedAt: 1 });
		plugins.push(p);
		expect(p.client.running).toBe(false);
		await clearIndex(p);
		expect(p.data.indexedAt).toBeNull(); // the status now says "Not built yet"…
		expect({ saved: store.saved !== null }).toEqual({ saved: false }); // …so the note text must be gone from IndexedDB too
	});
});

describe("a save that fails at the end of the first build", () => {
	it("still leaves a searchable index (the disk is full: QuotaExceededError)", async () => {
		const store: Store = {
			load: () => Promise.resolve(null),
			save: () => Promise.reject(new DOMException("The quota has been exceeded.", "QuotaExceededError")),
			clear: () => Promise.resolve(),
		};
		const router = new Router(() => store, still);
		const v = vault([
			["a.md", "lighthouse keeper", 1],
			["b.md", "harbour master", 2],
		]);
		const feeder = new Feeder(
			v.app as never,
			clientFor(router),
			"v",
			() => [],
			() => [],
		);
		let failed: unknown = null;
		await feeder.ensure().catch((e: unknown) => (failed = e));
		// Today the build throws at its last batch: Jet is never ready, and every search starts the
		// whole build (every note read again) and fails the same way.
		expect({ failed: failed === null ? null : String(failed), live: feeder.live }).toEqual({
			failed: null,
			live: true,
		});
		expect(await ask(router, "lighthouse ")).toEqual(["a.md"]);
	});
});

describe("changes while the saved index is caught up", () => {
	it("a note deleted and a note created during the catch-up reach the index", async () => {
		const store = await savedWith([raw("A.md", "alpha", 1), raw("D.md", "delta", 1)]);
		// A changed while Jet slept, so the catch-up reads it; the read is slow (a phone, a sync).
		const v = vault([
			["A.md", "alpha again", 2],
			["D.md", "delta", 1],
		]);
		const read = v.holdNext("A.md");
		const router = new Router(() => store, still);
		const feeder = new Feeder(
			v.app as never,
			clientFor(router),
			"test vault",
			() => [],
			() => [],
		);
		const ready = feeder.ensure();
		await waitFor(read.started);
		// Meanwhile (sync, or you): D is deleted and N is created.
		feeder.touch(v.remove("D.md"), "delete");
		feeder.touch(v.add("N.md", "november", 3), "upsert");
		await sleep(150); // the change is flushed
		read.release();
		await ready;
		await sleep(700);
		expect({ delta: await ask(router, "delta "), november: await ask(router, "november ") }).toEqual({
			delta: [],
			november: ["N.md"],
		});
		feeder.stop();
	});
});

describe("a note moved into an excluded folder", () => {
	it("leaves the index (it is not searchable under its new path)", async () => {
		const v = vault([["Plan.md", "orchid planting plan", 1]]);
		const { feeder, router } = await liveFeeder(v, ["Archive"]);
		expect(await ask(router, "orchid ")).toEqual(["Plan.md"]);
		feeder.rename(v.rename("Plan.md", "Archive/Plan.md"), "Plan.md");
		await sleep(250);
		expect(await ask(router, "orchid ")).toEqual([]);
		feeder.stop();
	});
});

describe("a note deleted, then another renamed to its path (sync applies both at once)", () => {
	it("the deleted note's text does not stay in the index under the reused path", async () => {
		const v = vault([
			["A.md", "apple orchard", 1],
			["B.md", "banana split", 1],
		]);
		const { feeder, router } = await liveFeeder(v);
		feeder.touch(v.remove("B.md"), "delete");
		feeder.rename(v.rename("A.md", "B.md"), "A.md");
		await sleep(250);
		// B.md now holds "apple orchard"; the old B ("banana split") was deleted.
		expect({ banana: await ask(router, "banana "), apple: await ask(router, "apple ") }).toEqual({
			banana: [],
			apple: ["B.md"],
		});
		feeder.stop();
	});
});

describe("one note with a huge heading line", () => {
	it("does not make the first build fail (the body is capped at 2 MB; headings are not)", async () => {
		const v = vault([
			["a.md", "lighthouse keeper", 2],
			["Import.md", "", 1],
		]);
		// An imported note whose first line is "# " and a pasted blob of 150,000 words.
		v.app.metadataCache.caches.set("Import.md", {
			headings: [{ level: 1, heading: "word ".repeat(150_000) }],
		});
		const router = new Router(() => memoryStore(), still);
		const feeder = new Feeder(
			v.app as never,
			clientFor(router),
			"v",
			() => [],
			() => [],
		);
		let failed: unknown = null;
		await feeder.ensure().catch((e: unknown) => (failed = e));
		expect(failed === null ? null : String(failed)).toBeNull();
		expect(await ask(router, "lighthouse ")).toEqual(["a.md"]);
	});
});

describe("a first build longer than the worker's 10-minute sleep", () => {
	it("is not stopped halfway by the sleep: it finishes without a search", async () => {
		vi.useFakeTimers();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const store = memoryStore();
		stubWorkers(store);
		const v = vault(Array.from({ length: 300 }, (_, i): [string, string, number] => [`n${i}.md`, `note ${i}`, i]));
		// A slow phone: each batch of 100 notes takes 4 minutes to read (12 minutes in all). With
		// 100 s per batch (5 minutes in all) this test passes.
		const read = v.app.vault.cachedRead.bind(v.app.vault);
		(v.app.vault as unknown as { cachedRead: (f: TFile) => Promise<string> }).cachedRead = async (f) => {
			await new Promise((r) => setTimeout(r, 240_000));
			return read(f);
		};
		Object.assign(v.app.metadataCache, { on: () => ({ off: () => {} }) });
		// The first time Jet is enabled: it builds 3 s after the layout is ready, without a search.
		const p = await plugin(v, null);
		plugins.push(p);
		for (const cb of v.app.workspace.layoutReadyCallbacks.splice(0)) cb();
		await vi.advanceTimersByTimeAsync(20 * 60_000);
		// Today the sleep at 10 min saves 200 notes, stops the worker and the build; nothing resumes it.
		expect(p.data.indexedAt !== null).toBe(true);
	});
});

describe("a first build interrupted (Obsidian closed or killed in the background)", () => {
	it("keeps what it had indexed, so the next start catches up instead of starting at note 1", async () => {
		const store = memoryStore();
		const notes = Array.from({ length: 250 }, (_, i): [string, string, number] => [`n${i}.md`, `note ${i}`, i]);
		const v = vault(notes);
		// The build saves every 20 s; here every batch, so the test needs no clock.
		const router = new Router(() => store, still, 0);
		const feeder = new Feeder(
			v.app as never,
			clientFor(router),
			"test vault",
			() => [],
			() => [],
		);
		// Oldest notes go last: the last batch's first read waits, as if the app were closed then.
		const read = v.holdNext("n0.md");
		void feeder.ensure();
		await waitFor(read.started);
		expect(router.engine.size).toBe(200); // two batches in the worker, searchable
		// Obsidian closes (or the phone kills it). The next start opens what was saved.
		const next = new Router(() => store, still);
		const opened = (await next.handle({ op: "open", vaultId: "test vault", stemming: [] })) as {
			loaded: boolean;
			notes: number;
		};
		expect(opened).toEqual({ loaded: true, notes: 200 });
	});
});

describe("a saved index whose sidecar cannot be read", () => {
	it("is rebuilt from the vault without the notes deleted since (no half-loaded base)", async () => {
		const store = await savedWith([raw("Keep.md", "kept words", 1), raw("Gone.md", "ghostly words", 1)]);
		// The sidecar is damaged (truncated JSON); Gone.md was deleted while Jet was closed.
		if (store.saved) store.saved.sidecar = new TextEncoder().encode('{"dead":[0],');
		const v = vault([["Keep.md", "kept words", 1]]);
		const router = new Router(() => store, still);
		const feeder = new Feeder(
			v.app as never,
			clientFor(router),
			"test vault",
			() => [],
			() => [],
		);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		await feeder.ensure();
		expect(warn).toHaveBeenCalled(); // "the saved index could not be read; rebuilding"
		expect(await ask(router, "ghostly ")).toEqual([]);
	});
});

describe("a note deleted while its change is being read", () => {
	it("does not come back into the index when the read finishes", async () => {
		const v = vault([["X.md", "xylophone", 1]]);
		const { feeder, router } = await liveFeeder(v);
		v.edit("X.md", "xylophone lessons", 2);
		const read = v.holdNext("X.md");
		feeder.touch(v.app.vault.files.get("X.md") as TFile, "upsert");
		await waitFor(read.started);
		feeder.touch(v.remove("X.md"), "delete");
		await sleep(150); // the delete is flushed while the edit's read is still out
		expect(await ask(router, "xylophone ")).toEqual([]); // the delete reached the index…
		read.release();
		await sleep(50);
		expect(await ask(router, "xylophone ")).toEqual([]); // …and the late read must not undo it
		feeder.stop();
	});
});

describe("the editor's text sent just as the worker goes to sleep", () => {
	it("does not start a new worker that was never opened", async () => {
		stubWorkers(memoryStore());
		const v = vault([["Note.md", "first draft", 1]]);
		const client = new JetClient();
		const feeder = new Feeder(
			v.app as never,
			client,
			"test vault",
			() => [],
			() => [],
		);
		await feeder.ensure();
		const file = v.app.vault.files.get("Note.md") as TFile;
		(v.app.workspace as unknown as { getActiveViewOfType: () => unknown }).getActiveViewOfType = () => ({
			file,
			editor: { getValue: () => "first draft, typed on" },
		});
		let workers = 0;
		const Base = globalThis.Worker as unknown as new () => object;
		vi.stubGlobal(
			"Worker",
			class extends Base {
				constructor() {
					super();
					workers++;
				}
			},
		);
		feeder.typing(); // a key, then the 10-minute sleep fires (main.ts wake(): stop, then reset)
		client.stop();
		feeder.reset();
		await sleep(450);
		expect({ workers, running: client.running }).toEqual({ workers: 0, running: false });
		feeder.stop();
		client.stop();
	});
});

describe("a saved index with a damaged posting", () => {
	it("is rebuilt, or at least does not make searches for the word fail", async () => {
		const store = await savedWith([raw("n1.md", "aardvark", 1), raw("n2.md", "zebra", 2)]);
		const base = store.saved?.base as ArrayBuffer;
		// One byte of the first term's body postings changes (a doc gap now points past the last note).
		const head = new Uint32Array(base, 0, 32);
		new Uint8Array(base)[head[9 + 4] as number] = 0x7f;
		const r = new Router(() => store, still);
		await r.handle({ op: "open", vaultId: "test vault", stemming: [] });
		await expect(r.handle({ op: "query", seq: 1, text: "aardvark ", limit: 50, now: 0 })).resolves.toBeDefined();
	});
});

describe("a note renamed to another extension", () => {
	it("leaves the index under its old .md path", async () => {
		const v = vault([["Note.md", "quokka sightings", 1]]);
		const { feeder, router } = await liveFeeder(v);
		feeder.rename(v.rename("Note.md", "Note.txt"), "Note.md");
		await sleep(250);
		expect(await ask(router, "quokka ")).toEqual([]);
		feeder.stop();
	});
});

describe("the index status with excluded folders", () => {
	it("counts the notes Jet indexes, not the excluded ones too ('2 of 2', not '2 of 3')", async () => {
		const v = vault([
			["a.md", "one", 1],
			["b.md", "two", 1],
			["Archive/c.md", "three", 1],
		]);
		const p = await plugin(v, { indexedAt: 1, settings: { exclude: ["Archive"] } });
		plugins.push(p);
		Object.defineProperty(p.client, "running", { get: () => true });
		(p.client as unknown as { call: () => Promise<unknown> }).call = () =>
			Promise.resolve({ notes: 2, segments: 1, pending: 0, savedAt: Date.now(), bytes: 1000 });
		expect((await indexStatus(p)).notes).toBe("2 of 2 notes");
	});
});

describe("a first build that fails", () => {
	it("leaves no 'Building: 0 of 2 notes' progress behind", async () => {
		const v = vault([
			["a.md", "one", 1],
			["b.md", "two", 2],
		]);
		// The worker answers the batch with an error (a router exception, not a crash).
		const client = {
			running: true,
			call: (req: Request) =>
				req.op === "open"
					? Promise.resolve({ loaded: false, notes: 0 })
					: req.op === "batch"
						? Promise.reject(new Error("QuotaExceededError"))
						: Promise.resolve({ notes: 0 }),
		} as unknown as JetClient;
		const feeder = new Feeder(
			v.app as never,
			client,
			"v",
			() => [],
			() => [],
		);
		await feeder.ensure().catch(() => {});
		// The settings and the modal read this: "Building: 0 of 2 notes" / "Indexing 0 of 2…", for good.
		expect(feeder.progress).toBeNull();
	});
});
