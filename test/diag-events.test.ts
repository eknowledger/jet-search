import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, TFile } from "obsidian";
import { Feeder } from "../src/index/feeder";
import { diag, noted } from "../src/diag/diag";
import { JetClient } from "../src/worker/jet-client";
import type { JetClient as Client } from "../src/worker/jet-client";
import { Router } from "../src/worker/router";
import { memoryStore } from "../src/worker/store";
import type { Request } from "../src/worker/protocol";

const still = { set: () => 0, clear: () => {} };

/** A Worker the test drives by hand. */
const stubWorker = () => {
	const made: { onmessage: ((e: { data: unknown }) => void) | null; sent: unknown[] }[] = [];
	vi.stubGlobal(
		"Worker",
		class {
			onmessage: ((e: { data: unknown }) => void) | null = null;
			onerror: unknown = null;
			sent: unknown[] = [];
			constructor() {
				made.push(this);
			}
			postMessage(m: unknown): void {
				this.sent.push(m);
			}
			terminate(): void {}
		},
	);
	vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
	return made;
};

const oneNote = (): App => {
	const app = new App();
	const f = new TFile("a.md");
	f.stat = { mtime: 1, ctime: 1, size: 10 };
	app.vault.files.set("a.md", f);
	(app.vault as unknown as { cachedRead: () => Promise<string> }).cachedRead = async () => "alpha beta";
	return app;
};

const clientFor = (router: Router) =>
	({ running: true, call: (req: Request) => router.handle(req) }) as unknown as Client;

describe("what the worker tells the main thread", () => {
	beforeEach(() => diag.reset());
	afterEach(() => vi.unstubAllGlobals());

	it("an event from the worker is kept as a problem, and is no answer to any request", async () => {
		const made = stubWorker();
		const client = new JetClient();
		const p = client.call({ op: "stats" });
		const w = made[0]!;
		w.onmessage?.({
			data: { event: { code: "index.save", level: "warn", error: "RangeError", where: "worker:f:1:2" } },
		});
		expect(diag.problems).toMatchObject([
			{ code: "index.save", level: "warn", error: "RangeError", where: "worker:f:1:2", count: 1 },
		]);
		w.onmessage?.({ data: { id: 1, result: { notes: 1 } } });
		await expect(p).resolves.toEqual({ notes: 1 });
	});

	it("a failed request keeps its class and where it was thrown in the worker", async () => {
		const made = stubWorker();
		const client = new JetClient();
		const p = client.call({ op: "stats" });
		made[0]!.onmessage?.({
			data: { id: 1, error: "RangeError: bad at /Vault/Secret.md", name: "RangeError", where: "worker:load:9:4" },
		});
		const e = await p.catch((x: unknown) => x as Error);
		expect(e.name).toBe("RangeError");
		diag.problem("index.open", e);
		expect(diag.problems[0]).toMatchObject({ code: "index.open", error: "RangeError", where: "worker:load:9:4" });
		expect(JSON.stringify(diag.problems)).not.toContain("Secret");
	});

	it("an error without a class from an older worker is still an Error", async () => {
		const made = stubWorker();
		const client = new JetClient();
		const p = client.call({ op: "stats" });
		made[0]!.onmessage?.({ data: { id: 1, error: "x" } });
		expect(((await p.catch((x: unknown) => x)) as Error).name).toBe("Error");
	});
});

describe("how the saved index opened, as the main thread keeps it", () => {
	beforeEach(() => diag.reset());

	it("records none the first time and loaded the next", async () => {
		const store = memoryStore();
		const a = new Feeder(
			oneNote() as never,
			clientFor(new Router(() => store, still)),
			"v",
			() => [],
			() => [],
		);
		await a.ensure();
		expect(diag.opened).toMatchObject({ how: "none", store: "memory", found: null });
		const b = new Feeder(
			oneNote() as never,
			clientFor(new Router(() => store, still)),
			"v",
			() => [],
			() => [],
		);
		await b.ensure();
		expect(diag.opened).toMatchObject({ how: "loaded", store: "memory" });
		expect(diag.opened?.ms).toBeGreaterThanOrEqual(0);
		expect(diag.opened?.at).toBeGreaterThan(0);
	});
});

describe("passing over an error on purpose", () => {
	beforeEach(() => diag.reset());

	it("is remembered as a warning and printed nowhere", () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		noted("meaning.remove", new TypeError("x /Vault/Secret.md"));
		expect(diag.problems).toMatchObject([{ code: "meaning.remove", level: "warn", error: "TypeError" }]);
		expect(log).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
		expect(JSON.stringify(diag.problems)).not.toContain("Secret");
		log.mockRestore();
		warn.mockRestore();
	});

	it("a rename the worker could not take is remembered, not lost", async () => {
		const store = memoryStore();
		const router = new Router(() => store, still);
		const client = {
			running: true,
			call: (req: Request) => (req.op === "rename" ? Promise.reject(new RangeError("x")) : router.handle(req)),
		} as unknown as Client;
		const app = oneNote();
		const feeder = new Feeder(
			app as never,
			client,
			"v",
			() => [],
			() => [],
		);
		await feeder.ensure();
		const moved = new TFile("b.md");
		moved.stat = { mtime: 1, ctime: 1, size: 10 };
		feeder.rename(moved, "a.md");
		await new Promise((r) => setTimeout(r, 5));
		expect(diag.problems.map((p) => [p.code, p.level, p.error])).toContainEqual([
			"index.rename",
			"warn",
			"RangeError",
		]);
	});
});
