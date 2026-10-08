/**
 * Joining Jade through its partner API, version 0: Jet's
 * controls in the J panel under Find, and "Search the selection" on Jade's floating bar. Whichever
 * loads first: Jet joins when Jade is there now, and again on `jade:ready`; on `jade:unload` Jade
 * removes what Jet added. Without Jade, nothing changes: Jet keeps its own UI.
 */
import type { App, Plugin } from "obsidian";
import type { JadeApi, JadePartner } from "./jade-api";

export type JadeHost = {
	/** Open Jet with this text. */
	open(text: string): void;
	/** The index's state in a few words ("1,200 notes · updated 2 min ago"). */
	status(): string;
	rebuild(): void;
	excerpts: { get(): boolean; set(v: boolean): void };
	persist: { get(): boolean; set(v: boolean): void };
};

export class JadeLink {
	private partner: JadePartner | null = null;

	constructor(
		private readonly app: App,
		private readonly plugin: Plugin,
		private readonly host: JadeHost,
	) {}

	/** Join now if Jade is on, and whenever it comes (back). */
	start(): void {
		this.join();
		const ws = this.app.workspace as unknown as { on(name: string, cb: () => void): import("obsidian").EventRef };
		this.plugin.registerEvent(ws.on("jade:ready", () => this.join()));
		this.plugin.registerEvent(
			ws.on("jade:unload", () => {
				this.partner = null;
			}),
		);
	}

	get joined(): boolean {
		return !!this.partner?.active;
	}

	private join(): void {
		if (this.partner?.active) return;
		const plugins = (this.app as unknown as { plugins?: { getPlugin(id: string): unknown } }).plugins;
		const api = (plugins?.getPlugin("jade") as { api?: JadeApi } | null)?.api;
		if (api?.version !== 0) return;
		let p: JadePartner;
		try {
			p = api.join(this.plugin);
		} catch (e) {
			console.error("Jet Search: joining Jade failed", e);
			return;
		}
		this.partner = p;
		const has = (f: string): boolean => api.features.includes(f as never);
		if (has("hub")) {
			p.hub.add("find", {
				id: "open",
				type: "action",
				label: "Search notes",
				desc: "Jet Search (⇧⇧)",
				button: "Open",
				run: () => this.host.open(""),
			});
			p.hub.add("find", {
				id: "index",
				type: "action",
				label: "Index",
				desc: () => this.host.status(),
				button: "Rebuild",
				run: () => this.host.rebuild(),
			});
			p.hub.add("find", {
				id: "excerpts",
				type: "toggle",
				label: "Show excerpts",
				get: () => this.host.excerpts.get(),
				set: (v) => this.host.excerpts.set(v),
			});
			p.hub.add("find", {
				id: "persist",
				type: "toggle",
				label: "Persist filters",
				desc: "Reopen with the last scope and filters",
				get: () => this.host.persist.get(),
				set: (v) => this.host.persist.set(v),
			});
		}
		if (has("surface"))
			p.surface.add({
				id: "search-selection",
				label: "Search the selection",
				icon: "search",
				place: "floating",
				area: "find",
				when: (s) => s.to > s.from && s.to - s.from <= 200,
				run: (s) => this.host.open(s.editor.getSelection().replace(/\s+/g, " ").trim().slice(0, 200)),
			});
	}

	stop(): void {
		this.partner?.leave();
		this.partner = null;
	}
}
