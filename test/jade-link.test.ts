import { describe, expect, it } from "vitest";
import { App, Plugin } from "obsidian";
import type { JadeApi, JadeControl, JadePartner } from "../src/jade-api";
import { JadeLink } from "../src/jade-link";

/** A Jade that records what partners add, and can go away and come back. */
const fakeJade = () => {
	const added: { hub: Array<[string, JadeControl]>; surface: string[] } = { hub: [], surface: [] };
	let active = true;
	let joins = 0;
	const partner = (): JadePartner =>
		({
			get active() {
				return active;
			},
			surface: { add: (a: { id: string }) => (added.surface.push(a.id), () => {}), floats: () => true },
			hub: { add: (area: string, c: JadeControl) => (added.hub.push([area, c]), () => {}) },
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
		features: ["surface", "hub"],
		join: () => {
			joins++;
			active = true;
			return partner();
		},
	};
	return { api, added, joins: () => joins, unload: () => (active = false) };
};

const setup = (jade: ReturnType<typeof fakeJade> | null) => {
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
