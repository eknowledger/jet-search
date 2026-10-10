/**
 * Joining Jade through its partner API, version 0:
 * Jet's controls in the J panel under Find, "Search the selection" on Jade's floating bar, Search
 * beside the J (feature `quick`), and one Shift-Shift owner (feature `commands.tap`): when Jade owns a
 * double Shift, Jet's own detector stands down and Jade is asked, once, to point it at Jet. Whichever
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
	/** The key whose double tap opens Jet, or off: no offer to Jade then. */
	tapKey(): string;
	/** The double tap as hints write it (⇧⇧), or null when off. */
	tapLabel?(): string | null;
	/** Other command ids that open Jet now (Omnisearch's, while Jet stands in for it). */
	aliases(): string[];
};

const OPEN = "jet-search:open";
/** The two keys of a modifier, as Jade's taps name them (ShiftLeft, ShiftRight). */
const codesOf = (key: string): string[] => [`${key}Left`, `${key}Right`];

export class JadeLink {
	private partner: JadePartner | null = null;
	private taps = false;

	constructor(
		private readonly app: App,
		private readonly plugin: Plugin,
		private readonly host: JadeHost,
	) {}

	/** Join now if Jade is on, and whenever it comes (back). */
	start(): void {
		this.join();
		const ws = this.app.workspace as unknown as { on(name: string, cb: () => void): import("obsidian").EventRef };
		// One listener: when Jade goes, its partner object turns inactive by itself (Jade undoes what Jet
		// added), so `jade:unload` needs no handler here; `jade:ready` joins again.
		this.plugin.registerEvent(ws.on("jade:ready", () => this.join()));
	}

	get joined(): boolean {
		return !!this.partner?.active;
	}

	/** Whether Jade owns a double tap of this key (null: Jade does not say; the caller reads its settings). */
	ownsTap(key: string): boolean | null {
		const p = this.partner;
		if (!p?.active || !this.taps) return null;
		return codesOf(key).some((c) => p.commands.owns(c));
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
		// A Jade that throws while Jet joins (or has no feature list) must not stop Jet: Jet keeps its own
		// UI as the fallback.
		try {
			this.offer(api, p);
		} catch (e) {
			console.error("Jet Search: joining Jade failed", e);
			try {
				p.leave();
			} catch {
				// Leaving a broken Jade: nothing more to do.
			}
			this.partner = null;
			this.taps = false;
		}
	}

	/** What Jet adds to Jade once joined: its entries, the Shift offer, the floating action. */
	private offer(api: JadeApi, p: JadePartner): void {
		// A Jade with no feature list offers nothing beyond joining.
		const features: readonly string[] = Array.isArray(api.features) ? api.features : [];
		const has = (f: string): boolean => features.includes(f);
		if (has("hub")) {
			p.hub.add("find", {
				id: "open",
				type: "action",
				label: "Search notes",
				desc: this.host.tapLabel ? `Jet Search (${this.host.tapLabel() ?? "a hotkey"})` : "Jet Search",
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
		if (has("quick"))
			p.quick.add({ id: "search", icon: "search", label: "Search", order: 30, run: () => this.host.open("") });
		this.taps = has("commands.tap");
		const key = this.host.tapKey();
		if (this.taps && key !== "off") {
			const owned = codesOf(key).find((c) => p.commands.owns(c));
			// Jade remembers the answer; an offer for a tap that already opens Jet is never made.
			// The Shift tap Jade owns, not any tap: Ctrl-Ctrl opening Jet leaves Shift-Shift elsewhere.
			const opensJet = [OPEN, ...this.host.aliases()].some((c) => p.commands.tapFor(c) === owned);
			if (owned && !opensJet) p.commands.offerTap(owned, OPEN, "Jet Search");
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
		this.taps = false;
	}
}
