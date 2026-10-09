/**
 * Keeps every scope's members: one pass over the metadata cache when first
 * needed, then one note at a time as it changes, is renamed or deleted, with only the difference sent
 * to the worker. The worker forgets its sets when it stops; `resend` gives them back.
 */
import type { App, TFile } from "obsidian";
import type { JetClient } from "../worker/jet-client";
import { noteFacts } from "./facts";
import { inScope, matches, members } from "./members";
import type { Rule, Scope } from "./model";

export class ScopeKeeper {
	private sets: Map<string, Set<string>> | null = null;

	constructor(
		private readonly app: App,
		private readonly client: Pick<JetClient, "running" | "call">,
		private readonly scopes: () => readonly Scope[],
	) {}

	/** The first pass, if not done yet (the modal opens, or the scopes page draws its counts). */
	ensure(): void {
		if (this.sets) return;
		const files = this.app.vault.getMarkdownFiles();
		this.sets = members(
			this.scopes(),
			files.map((f) => noteFacts(this.app, f)),
		);
		this.resend();
	}

	/** How many notes are in a scope (0 before the first pass). */
	count(id: string): number {
		return this.sets?.get(id)?.size ?? 0;
	}

	/** A scope's members (empty before the first pass). */
	membersOf(id: string): ReadonlySet<string> {
		return this.sets?.get(id) ?? new Set();
	}

	/** Whether the first pass ran (counts are known). */
	get ready(): boolean {
		return this.sets !== null;
	}

	/** Notes per rule, for every rule of every scope at once (one pass, not one per rule). */
	private counts: Map<string, number> | null = null;

	/** How many notes one rule takes (the scope page shows it per rule). */
	ruleCount(r: Rule): number {
		const key = JSON.stringify(r);
		if (!this.counts) {
			const rules = new Map<string, Rule>();
			for (const s of this.scopes()) for (const x of s.rules) rules.set(JSON.stringify(x), x);
			rules.set(key, r);
			const counts = new Map<string, number>([...rules.keys()].map((k) => [k, 0]));
			const list = [...rules];
			for (const f of this.app.vault.getMarkdownFiles()) {
				const facts = noteFacts(this.app, f);
				for (const [k, x] of list) if (matches(x, facts)) counts.set(k, (counts.get(k) ?? 0) + 1);
			}
			this.counts = counts;
		}
		const known = this.counts.get(key);
		if (known !== undefined) return known;
		let n = 0;
		for (const f of this.app.vault.getMarkdownFiles()) if (matches(r, noteFacts(this.app, f))) n++;
		this.counts.set(key, n);
		return n;
	}

	/** The scopes changed (settings): start over at the next `ensure`. */
	reset(): void {
		this.sets = null;
		this.counts = null;
	}

	/** Every set to the worker again (it restarted, or the first pass ran). */
	resend(): void {
		if (!this.sets || !this.client.running) return;
		void this.client.call({ op: "scope:clear" });
		for (const [id, set] of this.sets) void this.client.call({ op: "scope:set", id, paths: [...set] });
	}

	/** A note's metadata changed (or it was created): recheck it in every scope. */
	changed(file: TFile): void {
		if (file.extension === "md") this.counts = null;
		if (!this.sets || file.extension !== "md") return;
		const facts = noteFacts(this.app, file);
		for (const s of this.scopes()) {
			const set = this.sets.get(s.id);
			if (!set) continue;
			const now = inScope(s, facts);
			if (now === set.has(file.path)) continue;
			if (now) set.add(file.path);
			else set.delete(file.path);
			this.send(s.id, now ? [file.path] : [], now ? [] : [file.path]);
		}
	}

	/** A note was renamed or moved: the worker renames its own sets; the new path may match differently. */
	renamed(file: TFile, from: string): void {
		if (!this.sets) return;
		for (const set of this.sets.values()) if (set.delete(from)) set.add(file.path);
		this.changed(file);
	}

	deleted(path: string): void {
		this.counts = null;
		if (!this.sets) return;
		for (const set of this.sets.values()) set.delete(path);
	}

	private send(id: string, add: string[], remove: string[]): void {
		if (this.client.running) void this.client.call({ op: "scope:delta", id, add, remove });
	}
}
