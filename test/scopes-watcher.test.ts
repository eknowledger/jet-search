import { describe, expect, it } from "vitest";
import type { NoteFacts } from "../src/scopes/members";
import type { Scope } from "../src/scopes/model";
import { emptyConfig, type Snapshot } from "../src/scopes/snapshot";
import { ScopeWatcher } from "../src/scopes/watcher";

/** Projects/<name> folders of 6 notes, each linked by project:, and 4 loose notes. */
const vault = (projects: string[]): Snapshot => {
	const notes: NoteFacts[] = [];
	for (const p of projects) {
		notes.push({ path: `Projects/${p}/${p}.md`, props: {}, links: {}, tags: [] });
		for (let i = 0; i < 5; i++)
			notes.push({
				path: `Projects/${p}/n${i}.md`,
				props: { project: `[[${p}]]` },
				links: { project: [`Projects/${p}/${p}.md`] },
				tags: [],
			});
	}
	for (let i = 0; i < 4; i++) notes.push({ path: `Loose ${i}.md`, props: {}, links: {}, tags: [] });
	return { notes, files: notes.map((n) => n.path), config: emptyConfig() };
};

const generated = (name: string): Scope => ({
	id: name,
	name,
	aliases: [],
	kind: "Projects",
	rules: [{ kind: "folder", path: `Projects/${name}` }],
	combine: "any",
	mode: "suggest",
	source: "generated",
	origins: [{ signal: "container-folder", at: "Projects", key: `Projects/${name}`, v: 1 }],
	generated: [{ kind: "folder", path: `Projects/${name}` }],
});

const make = (mode: "tell" | "add" | "nothing", scopes: Scope[], projects: string[]) => {
	const state = { scopes, noticed: 0, saved: 0, timers: [] as Array<{ fn: () => void; ms: number }>, now: 1_000_000 };
	const w = new ScopeWatcher({
		mode: () => mode,
		scopes: () => state.scopes,
		setScopes: (s) => {
			state.scopes = s;
		},
		save: () => state.saved++,
		snapshot: () => Promise.resolve(vault(projects)),
		noticed: () => state.noticed++,
		timers: { set: (fn, ms) => state.timers.push({ fn, ms }), clear: () => {} },
		now: () => state.now,
	});
	return { w, state };
};

describe("when new scopes appear", () => {
	it("tell me: counts a new project folder, adds nothing", async () => {
		const { w, state } = make("tell", [generated("Garden"), generated("Lyon")], ["Garden", "Lyon", "Orion"]);
		await w.run();
		expect(w.fresh).toBe(1);
		expect(state.scopes).toHaveLength(2);
		expect(state.noticed).toBe(1);
	});

	it("add them: a new member of an accepted pattern joins on Suggest", async () => {
		const { w, state } = make("add", [generated("Garden"), generated("Lyon")], ["Garden", "Lyon", "Orion"]);
		await w.run();
		expect(state.scopes.map((s) => [s.name, s.mode])).toEqual([
			["Garden", "suggest"],
			["Lyon", "suggest"],
			["Orion", "suggest"],
		]);
		expect(w.fresh).toBe(0);
		expect(state.saved).toBe(1);
	});

	it("waits for a quiet vault and runs at most once a minute; never before anything was generated", () => {
		const { w, state } = make("tell", [generated("Garden")], ["Garden"]);
		w.changed();
		expect(state.timers.at(-1)?.ms).toBe(5_000);
		const none = make("tell", [], ["Garden"]);
		none.w.changed();
		expect(none.state.timers).toHaveLength(0);
		const off = make("nothing", [generated("Garden")], ["Garden"]);
		off.w.changed();
		expect(off.state.timers).toHaveLength(0);
	});
});
