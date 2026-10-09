/**
 * "When new ones appear": after the vault changes, Jet generates again when idle
 * (at most once a minute, never at start) and compares with your scopes. Tell me: it counts what is
 * new. Add them: new members of patterns you already accepted (a new subfolder of a container whose
 * scopes you added) join on Suggest; a new pattern always waits for your review. Do nothing: no run.
 */
import { generate } from "./generate";
import type { Scope } from "./model";
import { applyReview, review } from "./review";
import type { Snapshot } from "./snapshot";

export type WatchHost = {
	mode(): "tell" | "add" | "nothing";
	scopes(): Scope[];
	setScopes(scopes: Scope[]): void;
	save(): void;
	snapshot(): Promise<Snapshot>;
	/** What was noticed changed (the settings show it). */
	noticed(): void;
	timers: { set(fn: () => void, ms: number): unknown; clear(h: unknown): void };
	now(): number;
};

/** At most one run per minute. */
const GAP_MS = 60_000;
/** Wait for the vault to be quiet before running. */
const QUIET_MS = 5_000;

export class ScopeWatcher {
	/** How many new scopes were noticed since the last generation (Tell me). */
	fresh = 0;
	private timer: unknown = null;
	private last = 0;
	private running = false;

	constructor(private readonly h: WatchHost) {}

	/** The vault changed (a folder, a note's properties): look again later, if anything was generated. */
	changed(): void {
		if (this.h.mode() === "nothing" || !this.h.scopes().some((s) => s.source === "generated")) return;
		if (this.timer !== null) this.h.timers.clear(this.timer);
		const wait = Math.max(QUIET_MS, this.last + GAP_MS - this.h.now());
		this.timer = this.h.timers.set(() => {
			this.timer = null;
			void this.run();
		}, wait);
	}

	stop(): void {
		if (this.timer !== null) this.h.timers.clear(this.timer);
		this.timer = null;
	}

	/** One look: count what is new, and with "Add them" add new members of accepted patterns. */
	async run(): Promise<void> {
		if (this.running) return;
		this.running = true;
		this.last = this.h.now();
		try {
			const snap = await this.h.snapshot();
			const items = review(generate(snap).proposals, this.h.scopes(), snap.notes);
			// A pattern you accepted: the main origins of your scopes, never a flat tag (every flat tag is at
			// "#"; one agreeing with one folder must not accept a whole new container).
			const accepted = new Set(
				this.h
					.scopes()
					.map((s) => s.origins?.[0])
					.filter((o): o is NonNullable<typeof o> => !!o && o.signal !== "flat-tag")
					.map((o) => `${o.signal}|${o.at}`),
			);
			const known = (o: { signal: string; at: string } | undefined): boolean =>
				!!o && o.signal !== "flat-tag" && accepted.has(`${o.signal}|${o.at}`);
			// The item's tick, not the proposal's: one you turned down before is not new to you.
			const fresh = items.filter((i) => i.state === "new" && i.ticked);
			if (this.h.mode() === "add") {
				// New members of a pattern you accepted, and folders renamed (moved along, your edits kept).
				const auto = [
					...fresh.filter((i) => known(i.proposal?.origins[0])),
					...items.filter((i) => i.state === "changed" && i.dropRules?.length),
				];
				if (auto.length) {
					const only = items.map((i) => ({ ...i, ticked: auto.includes(i) }));
					this.h.setScopes(applyReview(only, this.h.scopes()));
					this.h.save();
				}
				this.fresh = fresh.length - auto.length;
			} else this.fresh = fresh.length;
			this.h.noticed();
		} catch (e) {
			console.error("Jet Search: looking for new scopes failed", e);
		} finally {
			this.running = false;
		}
	}
}
