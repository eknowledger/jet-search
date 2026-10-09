/**
 * QA: the plugin's lifecycle and the partnership with Jade. Each test names the behaviour it expects.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Plugin } from "obsidian";
import type { JadeApi, JadePartner } from "../src/jade-api";
import { JadeLink } from "../src/jade-link";
import JetSearchPlugin from "../src/main";

// Obsidian's debounce waits (and has run() and cancel()); the shared mock calls at once, which hides
// what is still unsaved when the plugin goes. Only main.ts uses debounce.
vi.mock("obsidian", async (importOriginal) => {
	const m = await importOriginal<Record<string, unknown>>();
	const debounce = <A extends unknown[]>(fn: (...a: A) => unknown, ms = 0, reset = false) => {
		let t: ReturnType<typeof setTimeout> | null = null;
		let args: A | null = null;
		const d = (...a: A) => {
			args = a;
			if (t !== null) {
				if (!reset) return d;
				clearTimeout(t);
			}
			t = setTimeout(() => {
				t = null;
				fn(...(args as A));
			}, ms);
			return d;
		};
		d.cancel = () => {
			if (t !== null) clearTimeout(t);
			t = null;
			return d;
		};
		d.run = () => {
			if (t === null) return;
			clearTimeout(t);
			t = null;
			return fn(...(args as A));
		};
		return d;
	};
	return { ...m, debounce };
});

const manifest = { id: "jet-search", name: "Jet Search", version: "0.0.1" };

type Cmd = { id: string; name: string; callback?: () => unknown };
type Listener = (...a: unknown[]) => void;
type Mocked = JetSearchPlugin & { commands: Cmd[]; pendingCleanups(): number };

/** A worker that keeps what it is sent; the test answers. */
class FakeWorker {
	static made: FakeWorker[] = [];
	readonly posted: Array<{ id: number; req: { op: string } }> = [];
	terminated = false;
	onmessage: ((e: { data: unknown }) => void) | null = null;
	onerror: unknown = null;
	constructor() {
		FakeWorker.made.push(this);
	}
	postMessage(m: { id: number; req: { op: string } }): void {
		this.posted.push(m);
	}
	terminate(): void {
		this.terminated = true;
	}
	answer(id: number, result: unknown): void {
		this.onmessage?.({ data: { id, result } });
	}
}

/** A partner that accepts everything (Jade's handle, as Jet sees it). */
const partnerStub = (over: Partial<Record<keyof JadePartner, unknown>> = {}): JadePartner =>
	({
		active: true,
		surface: { add: () => () => {}, floats: () => true },
		hub: { add: () => () => {} },
		quick: { add: () => () => {} },
		commands: { owns: () => false, tapFor: () => null, offerTap: () => {} },
		layout: { reserve: () => ({ changed: () => {}, remove: () => {} }), corner: () => null, covers: () => false },
		onChange: () => () => {},
		leave: () => {},
		...over,
	}) as unknown as JadePartner;

const alive = new Set<Mocked>();

/** Jet in a mock app with Obsidian's command and plugin registries, and workspace events that fire. */
const make = (opts: { data?: unknown; jade?: unknown } = {}) => {
	const app = new App();
	const handlers = new Map<string, Listener[]>();
	const ws = app.workspace as unknown as Record<string, unknown>;
	ws.on = (name: string, cb: Listener) => {
		handlers.set(name, [...(handlers.get(name) ?? []), cb]);
		return {
			off: () =>
				handlers.set(
					name,
					(handlers.get(name) ?? []).filter((x) => x !== cb),
				),
		};
	};
	Object.assign(app.metadataCache, { on: () => ({ off: () => {} }) });
	const emit = (name: string, ...args: unknown[]): void => {
		for (const cb of (handlers.get(name) ?? []).slice()) cb(...args);
	};
	const commands: Record<string, Cmd> = {};
	const registry = {
		commands,
		addCommand: (c: Cmd) => {
			commands[c.id] = c;
		},
		removeCommand: (id: string) => {
			delete commands[id];
		},
	};
	const plugins: Record<string, unknown> = {};
	Object.assign(app, {
		commands: registry,
		plugins: { plugins, enabledPlugins: new Set<string>(), getPlugin: (id: string) => plugins[id] ?? null },
	});
	if (opts.jade) plugins.jade = opts.jade;
	const plugin = new JetSearchPlugin(app as never, manifest as never) as Mocked;
	// Every plugin goes at the end of its test: its document listeners must not answer the next test.
	alive.add(plugin);
	const unload = plugin.unload.bind(plugin);
	plugin.unload = () => {
		alive.delete(plugin);
		unload();
	};
	let saved: unknown = null;
	Object.assign(plugin, {
		loadData: async () => opts.data ?? null,
		saveData: async (d: unknown) => {
			saved = JSON.parse(JSON.stringify(d));
		},
	});
	const ready = (): void => {
		for (const cb of app.workspace.layoutReadyCallbacks.splice(0)) cb();
	};
	return { app, plugin, commands, registry, plugins, emit, ready, saved: () => saved };
};

/** Two clean taps of Shift in this document. */
const doubleShift = (doc: Document, code = "ShiftLeft"): void => {
	for (let i = 0; i < 2; i++) {
		doc.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", code }));
		doc.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", code }));
	}
};

const modalOpen = (): boolean => document.querySelector(".jet-modal") !== null;

beforeEach(() => {
	FakeWorker.made = [];
	vi.stubGlobal("Worker", FakeWorker);
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	for (const p of Array.from(alive))
		try {
			p.unload();
		} catch {
			// A test that leaves a half-loaded plugin.
		}
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

describe("QA lifecycle: nothing of Jet runs after it is turned off", () => {
	it("turned off while onload still awaits its data: unload does not throw", async () => {
		const { plugin } = make();
		let release!: (v: unknown) => void;
		Object.assign(plugin, { loadData: () => new Promise((r) => (release = r)) });
		const loading = plugin.onload();
		expect(() => plugin.unload()).not.toThrow();
		release(null);
		await loading;
	});

	it("turned off while onload awaits: when the data arrives, Jet registers nothing and never says on after off", async () => {
		const { app, plugin } = make();
		let release!: (v: unknown) => void;
		Object.assign(plugin, { loadData: () => new Promise((r) => (release = r)) });
		const loading = plugin.onload();
		try {
			plugin.unload();
		} catch {
			// The first test covers the throw.
		}
		release(null);
		await loading;
		expect({
			lastEvent: app.workspace.triggered.at(-1),
			commands: plugin.commands.map((c) => c.id),
			waitingForLayout: app.workspace.layoutReadyCallbacks.length,
		}).toEqual({ lastEvent: "jet-search:off", commands: [], waitingForLayout: 0 });
	});

	it("the layout gets ready after Jet was turned off: no key listener, no Jade partner, no stand-in ids", async () => {
		vi.useFakeTimers();
		const join = vi.fn(() => partnerStub());
		const jade = { api: { version: 0, features: ["hub"], join } };
		const { plugin, ready, commands } = make({ data: { indexedAt: 1 }, jade });
		await plugin.onload();
		plugin.unload();
		const added = vi.spyOn(document, "addEventListener");
		try {
			ready();
			await vi.advanceTimersByTimeAsync(10);
			expect({
				joins: join.mock.calls.length,
				keyListeners: added.mock.calls.filter((c) => c[0] === "keyup" || c[0] === "keydown").length,
				standIn: "omnisearch:show-modal" in commands,
			}).toEqual({ joins: 0, keyListeners: 0, standIn: false });
		} finally {
			// Undo what the dead plugin registered, so its key listeners do not answer later tests.
			plugin.unload();
		}
	});

	it("the first build's timer goes with the plugin: turned off within 3 s of the first enable, no worker starts", async () => {
		vi.useFakeTimers();
		const { plugin, ready } = make(); // a first run: indexedAt is null
		await plugin.onload();
		ready();
		plugin.unload();
		await vi.advanceTimersByTimeAsync(5000);
		expect(FakeWorker.made).toHaveLength(0);
	});

	it("turned off with a change still waiting to be saved: the change is written at once, not 1 s later", async () => {
		vi.useFakeTimers();
		const { plugin, ready, saved } = make({ data: { indexedAt: 1 } });
		await plugin.onload();
		ready();
		plugin.data.searches = ["fresh query"];
		plugin.save();
		plugin.unload();
		await vi.advanceTimersByTimeAsync(0);
		expect((saved() as { searches?: string[] } | null)?.searches).toEqual(["fresh query"]);
	});
});

describe("QA lifecycle: Omnisearch's ids", () => {
	it("Omnisearch turned off after Jet started (the day-one migration): Jet takes its ids, so bindings to them open Jet", async () => {
		vi.useFakeTimers();
		const { plugin, ready, commands, registry, plugins, emit } = make({ data: { indexedAt: 1 } });
		plugins.omnisearch = {};
		const open = { id: "omnisearch:show-modal", name: "Omnisearch: Vault search", callback: () => {} };
		const inFile = { id: "omnisearch:show-modal-infile", name: "Omnisearch: In-file search", callback: () => {} };
		registry.addCommand(open);
		registry.addCommand(inFile);
		await plugin.onload();
		ready();
		await vi.advanceTimersByTimeAsync(1);
		expect(commands["omnisearch:show-modal"]).toBe(open);
		// Omnisearch is turned off: Obsidian removes its commands. Some time and a layout change pass.
		delete plugins.omnisearch;
		registry.removeCommand(open.id);
		registry.removeCommand(inFile.id);
		emit("layout-change");
		await vi.advanceTimersByTimeAsync(10_000);
		expect([commands["omnisearch:show-modal"]?.name, commands["omnisearch:show-modal-infile"]?.name]).toEqual([
			"Jet Search: Search notes (Omnisearch's shortcut)",
			"Jet Search: Search in this note (Omnisearch's shortcut)",
		]);
	});

	it("turned off after Omnisearch came on, Jet leaves Omnisearch's own commands in place", async () => {
		vi.useFakeTimers();
		const { plugin, ready, commands, registry, plugins } = make({ data: { indexedAt: 1 } });
		await plugin.onload();
		ready();
		await vi.advanceTimersByTimeAsync(1);
		expect(commands["omnisearch:show-modal"]?.name).toBe("Jet Search: Search notes (Omnisearch's shortcut)");
		// Omnisearch is turned on: Obsidian's addCommand puts its commands under the same ids.
		plugins.omnisearch = {};
		const open = { id: "omnisearch:show-modal", name: "Omnisearch: Vault search", callback: () => {} };
		const inFile = { id: "omnisearch:show-modal-infile", name: "Omnisearch: In-file search", callback: () => {} };
		registry.addCommand(open);
		registry.addCommand(inFile);
		plugin.unload();
		expect([commands["omnisearch:show-modal"], commands["omnisearch:show-modal-infile"]]).toEqual([open, inFile]);
	});
});

describe("QA lifecycle: Shift-Shift in popout windows", () => {
	it("works in a popout that was already open when Jet started listening (Jet enabled or reloaded)", async () => {
		const pop = document.implementation.createHTMLDocument("popout");
		const { app, plugin, ready } = make({ data: { indexedAt: 1 } });
		const leafIn = (doc: Document) => ({
			view: { containerEl: doc.body },
			getContainer: () => ({ doc, win: window }),
		});
		Object.assign(app.workspace, {
			floatingSplit: { children: [{ doc: pop, win: window }] },
			iterateAllLeaves: (cb: (leaf: unknown) => void) => {
				cb(leafIn(document));
				cb(leafIn(pop));
			},
		});
		await plugin.onload();
		ready();
		doubleShift(pop);
		expect(modalOpen()).toBe(true);
	});

	it("a closed popout keeps no Jet listeners (its document is not held until Jet unloads)", async () => {
		const pop = document.implementation.createHTMLDocument("popout");
		const popWin = new EventTarget();
		Object.defineProperty(pop, "defaultView", { value: popWin });
		const live = new Set<string>();
		const track = (t: EventTarget, name: string): void => {
			const add = t.addEventListener.bind(t);
			const remove = t.removeEventListener.bind(t);
			t.addEventListener = (type: string, ...rest: [never, never?]) => {
				live.add(`${name}:${type}`);
				add(type, ...rest);
			};
			t.removeEventListener = (type: string, ...rest: [never, never?]) => {
				live.delete(`${name}:${type}`);
				remove(type, ...rest);
			};
		};
		track(pop, "doc");
		track(popWin, "win");
		const { app, plugin, ready, emit } = make({ data: { indexedAt: 1 } });
		// The popout's leaf is in the layout while it is open (Jet follows layout changes).
		let open = false;
		Object.assign(app.workspace, {
			iterateAllLeaves: (cb: (leaf: unknown) => void) => {
				if (open) cb({ getContainer: () => ({ doc: pop, win: popWin }) });
			},
		});
		await plugin.onload();
		ready();
		open = true;
		emit("layout-change");
		expect(live.size).toBeGreaterThan(0);
		open = false;
		emit("layout-change");
		expect([...live]).toEqual([]);
	});
});

describe("QA lifecycle: double Shift edge cases", () => {
	it("Shift-click twice (selecting a range) does not open Jet: a mouse press between taps cancels", async () => {
		const { plugin, ready } = make({ data: { indexedAt: 1 } });
		await plugin.onload();
		ready();
		for (let i = 0; i < 2; i++) {
			document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", code: "ShiftLeft" }));
			document.dispatchEvent(new MouseEvent("mousedown", { shiftKey: true }));
			document.dispatchEvent(new MouseEvent("mouseup", { shiftKey: true }));
			document.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", code: "ShiftLeft" }));
		}
		expect(modalOpen()).toBe(false);
	});
});

describe("QA lifecycle: the worker's sleep", () => {
	it("a search that comes while the worker saves before sleeping keeps the worker (and its answer)", async () => {
		vi.useFakeTimers();
		const { plugin, ready } = make({ data: { indexedAt: 1 } });
		await plugin.onload();
		ready();
		const wake = (): void => (plugin as unknown as { wake(): void }).wake();
		wake();
		void plugin.client.call({ op: "open", vaultId: "v", stemming: [] } as never).catch(() => {});
		const w = FakeWorker.made[0];
		if (!w) throw new Error("no worker");
		w.answer(1, { loaded: true });
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		const save = w.posted.find((m) => m.req.op === "save");
		expect(save).toBeDefined();
		// A search arrives while the save runs: the host wakes Jet before each search.
		wake();
		let failed: unknown = null;
		const query = plugin.client
			.call({ op: "query", seq: 1, text: "x", limit: 5, now: 0 } as never)
			.catch((e: unknown) => (failed = e));
		w.answer(save?.id ?? -1, null);
		await vi.advanceTimersByTimeAsync(0);
		expect({ terminated: w.terminated, failed: failed === null ? null : String(failed) }).toEqual({
			terminated: false,
			failed: null,
		});
		void query;
	});
});

describe("QA lifecycle: Jade's partner API", () => {
	it("a Jade call that throws while joining does not stop Jet listening to the vault and to Shift", async () => {
		const partner = partnerStub({
			hub: {
				add: () => {
					throw new Error("Jade: the hub is not mounted");
				},
			},
		});
		const jade = { api: { version: 0, features: ["hub", "surface"], join: () => partner } };
		const { app, plugin, ready } = make({ data: { indexedAt: 1 }, jade });
		await plugin.onload();
		let threw: unknown = null;
		try {
			ready();
		} catch (e) {
			threw = e;
		}
		expect({ threw: threw === null ? null : String(threw), vaultListeners: app.vault.listenerCount() > 0 }).toEqual(
			{
				threw: null,
				vaultListeners: true,
			},
		);
	});

	it("asks Jade to point Shift at Jet when Shift runs something else, even if another key's double tap opens Jet", () => {
		const taps: Record<string, string> = { ShiftLeft: "command-palette:open", ControlLeft: "jet-search:open" };
		const offers: string[][] = [];
		const partner = partnerStub({
			commands: {
				owns: (code: string) => code in taps,
				tapFor: (cmd: string) => Object.entries(taps).find(([, c]) => c === cmd)?.[0] ?? null,
				offerTap: (code: string, cmd: string, label: string) => offers.push([code, cmd, label]),
			},
		});
		const api = { version: 0, features: ["commands.tap"], join: () => partner } as unknown as JadeApi;
		const app = new App();
		Object.assign(app, { plugins: { getPlugin: (id: string) => (id === "jade" ? { api } : null) } });
		const plugin = new Plugin(app as never, manifest as never);
		const link = new JadeLink(app as never, plugin as never, {
			open: () => {},
			status: () => "",
			rebuild: () => {},
			excerpts: { get: () => true, set: () => {} },
			persist: { get: () => false, set: () => {} },
			doubleShift: () => true,
			aliases: () => ["omnisearch:show-modal"],
		});
		link.start();
		// Jet's own detector stands down (Jade owns Shift), so Shift-Shift runs the command palette for good.
		expect(link.ownsShift()).toBe(true);
		expect(offers).toEqual([["ShiftLeft", "jet-search:open", "Jet Search"]]);
	});
});
