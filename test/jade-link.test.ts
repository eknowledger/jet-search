import { describe, expect, it } from "vitest";
import { App, Plugin } from "obsidian";
import type { JadeApi, JadeControl, JadePartner } from "../src/jade-api";
import { JadeLink } from "../src/jade-link";

/** A Jade that records what partners add, and can go away and come back. */
const fakeJade = (opts: { features?: string[]; taps?: Record<string, string> } = {}) => {
	const added: { hub: Array<[string, JadeControl]>; surface: string[]; quick: Array<{ id: string; run(): void }> } = {
		hub: [],
		surface: [],
		quick: [],
	};
	const taps = opts.taps ?? {};
	const offers: string[][] = [];
	let active = true;
	let joins = 0;
	const partner = (): JadePartner =>
		({
			get active() {
				return active;
			},
			surface: { add: (a: { id: string }) => (added.surface.push(a.id), () => {}), floats: () => true },
			hub: { add: (area: string, c: JadeControl) => (added.hub.push([area, c]), () => {}) },
			quick: { add: (a: { id: string; run(): void }) => (added.quick.push(a), () => {}) },
			commands: {
				tapFor: (cmd: string) => Object.entries(taps).find(([, c]) => c === cmd)?.[0] ?? null,
				owns: (code: string) => active && code in taps,
				offerTap: (code: string, cmd: string, label: string) => offers.push([code, cmd, label]),
			},
			layout: {
				reserve: () => ({ changed: () => {}, remove: () => {} }),
				corner: () => null,
				covers: () => false,
			},
			onChange: () => () => {},
			leave: () => {
				active = false;
			},
		}) as unknown as JadePartner;
	const api: JadeApi = {
		version: 0,
		features: (opts.features ?? ["surface", "hub"]) as JadeApi["features"],
		join: () => {
			joins++;
			active = true;
			return partner();
		},
	};
	return { api, added, offers, joins: () => joins, unload: () => (active = false) };
};

const setup = (jade: ReturnType<typeof fakeJade> | null, tapKey = "Shift") => {
	const app = new App();
	const handlers = new Map<string, () => void>();
	(app as unknown as { plugins: unknown }).plugins = {
		getPlugin: (id: string) => (id === "jade" && jade ? { api: jade.api } : null),
	};
	(app.workspace as unknown as { on: unknown }).on = (name: string, cb: () => void) => (
		handlers.set(name, cb),
		{ off: () => {} }
	);
	const plugin = new Plugin(app as never, { id: "jet-search", name: "Jet Search", version: "0" });
	const opened: string[] = [];
	let excerpts = true;
	const link = new JadeLink(app as never, plugin as never, {
		open: (t) => opened.push(t),
		status: () => "Ready",
		rebuild: () => {},
		excerpts: { get: () => excerpts, set: (v) => (excerpts = v) },
		persist: { get: () => false, set: () => {} },
		tapKey: () => tapKey,
		tapLabel: () => (tapKey === "off" ? null : "⇧⇧"),
		aliases: () => ["omnisearch:show-modal"],
	});
	return { link, handlers, opened, excerpts: () => excerpts };
};

describe("joining Jade", () => {
	it("adds Jet's controls under Find and Search the selection on the floating bar", () => {
		const jade = fakeJade();
		const { link, opened } = setup(jade);
		link.start();
		expect(link.joined).toBe(true);
		expect(jade.added.hub.map(([a, c]) => [a, c.id])).toEqual([
			["find", "open"],
			["find", "index"],
			["find", "excerpts"],
			["find", "persist"],
		]);
		expect(jade.added.surface).toEqual(["search-selection"]);
		const open = jade.added.hub[0]?.[1];
		if (open?.type === "action") open.run();
		expect(opened).toEqual([""]);
	});

	it("Jade after Jet: joins on jade:ready; after jade:unload, joins again when it is back", () => {
		const jade = fakeJade();
		const later = { jade: null as ReturnType<typeof fakeJade> | null };
		const s = setup(null);
		(s.link as unknown as { app: { plugins: unknown } }).app.plugins = {
			getPlugin: () => (later.jade ? { api: later.jade.api } : null),
		};
		s.link.start();
		expect(s.link.joined).toBe(false);
		later.jade = jade;
		s.handlers.get("jade:ready")?.();
		expect(s.link.joined).toBe(true);
		jade.unload();
		s.handlers.get("jade:unload")?.();
		expect(s.link.joined).toBe(false);
		s.handlers.get("jade:ready")?.();
		expect(jade.joins()).toBe(2);
	});

	it("without Jade, nothing", () => {
		const { link } = setup(null);
		link.start();
		expect(link.joined).toBe(false);
	});
});

describe("Search beside the J and one Shift-Shift owner", () => {
	it("adds Search beside the J when Jade offers quick actions; it opens Jet", () => {
		const jade = fakeJade({ features: ["surface", "hub", "quick"] });
		const { link, opened } = setup(jade);
		link.start();
		expect(jade.added.quick.map((q) => q.id)).toEqual(["search"]);
		jade.added.quick[0]?.run();
		expect(opened).toEqual([""]);
	});

	it("no quick action from a Jade without the feature", () => {
		const jade = fakeJade();
		setup(jade).link.start();
		expect(jade.added.quick).toEqual([]);
	});

	it("Jade owns Shift: Jet's own detector stands down, and Jade is asked once to point the tap at Jet", () => {
		const jade = fakeJade({ features: ["hub", "commands.tap"], taps: { ShiftLeft: "command-palette:open" } });
		const { link } = setup(jade);
		link.start();
		expect(link.ownsTap("Shift")).toBe(true);
		expect(jade.offers).toEqual([["ShiftLeft", "jet-search:open", "Jet Search"]]);
	});

	it("no offer when the tap already opens Jet (itself or Omnisearch's id), or when Jet's double Shift is off", () => {
		const a = fakeJade({ features: ["commands.tap"], taps: { ShiftLeft: "jet-search:open" } });
		setup(a).link.start();
		expect(a.offers).toEqual([]);
		const o = fakeJade({ features: ["commands.tap"], taps: { ShiftLeft: "omnisearch:show-modal" } });
		setup(o).link.start();
		expect(o.offers).toEqual([]);
		const b = fakeJade({ features: ["commands.tap"], taps: { ShiftLeft: "command-palette:open" } });
		setup(b, "off").link.start();
		expect(b.offers).toEqual([]);
	});

	it("unknown without the feature (the caller falls back to reading Jade's settings); false once Jade goes", () => {
		const plain = fakeJade();
		const s = setup(plain);
		s.link.start();
		expect(s.link.ownsTap("Shift")).toBeNull();
		const jade = fakeJade({ features: ["commands.tap"], taps: { ShiftRight: "x" } });
		const t = setup(jade);
		t.link.start();
		expect(t.link.ownsTap("Shift")).toBe(true);
		jade.unload();
		t.handlers.get("jade:unload")?.();
		expect(t.link.ownsTap("Shift")).toBeNull();
	});
});
