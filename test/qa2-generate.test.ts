/**
 * QA (generating scopes and the settings pages): each test reproduces one bug found by reading the
 * code and trying what a user does. They fail until the bug is fixed. Vaults are built in memory as
 * generator snapshots (the same shape `obsidianSnapshot` gives), so no file is written.
 */
import { afterEach, describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";
import JetSearchPlugin from "../src/main";
import { createTarget } from "../src/scopes/create";
import { generate } from "../src/scopes/generate";
import type { NoteFacts } from "../src/scopes/members";
import type { Rule, Scope } from "../src/scopes/model";
import { fold } from "../src/scopes/names";
import { applyReview, review } from "../src/scopes/review";
import { emptyConfig, type Snapshot } from "../src/scopes/snapshot";
import { ScopeWatcher } from "../src/scopes/watcher";
import type { JetSettingTab } from "../src/settings-tab";
import { mockApi } from "./obsidian-mock";

// ── Vault builders ─────────────────────────────────────────────────────────────

const note = (
	path: string,
	props: Record<string, unknown> = {},
	links: Record<string, string[]> = {},
	tags: string[] = [],
): NoteFacts => ({ path, props, links, tags });

/** `n` plain notes in a folder. */
const notesIn = (dir: string, n: number, extra: Partial<NoteFacts> = {}): NoteFacts[] =>
	Array.from({ length: n }, (_, i) => ({ ...note(`${dir}/Note ${i}.md`), ...extra }));

/** `n` notes at the vault root, so the root itself is no container. */
const loose = (n: number, prefix = "Loose"): NoteFacts[] =>
	Array.from({ length: n }, (_, i) => note(`${prefix} ${i}.md`));

const snap = (notes: NoteFacts[]): Snapshot => ({
	notes,
	files: notes.map((n) => n.path),
	config: emptyConfig(),
});

/** Generate on an empty settings: what "Add N scopes" saves with every ticked proposal. */
const firstRun = (s: Snapshot): Scope[] => applyReview(review(generate(s).proposals, []), []);

/** The watcher over a list of scopes, with a snapshot that can be swapped. */
const watcher = (mode: "tell" | "add" | "nothing", scopes: Scope[], vault: () => Snapshot) => {
	const state = { scopes, saved: 0, noticed: 0 };
	const w = new ScopeWatcher({
		mode: () => mode,
		scopes: () => state.scopes,
		setScopes: (s) => {
			state.scopes = s;
		},
		save: () => state.saved++,
		snapshot: () => Promise.resolve(vault()),
		noticed: () => state.noticed++,
		timers: { set: () => 0, clear: () => {} },
		now: () => 1_000_000,
	});
	return { w, state };
};

const folderOfScope = (s: Scope): string | undefined =>
	s.rules.find((r): r is Extract<Rule, { kind: "folder" }> => r.kind === "folder")?.path;

/** Three projects of 6 notes each, and 30 notes at the root. */
const projects = (names: string[]): Snapshot =>
	snap([...names.flatMap((p) => notesIn(`Projects/${p}`, 6)), ...loose(30)]);

// ── Generating again ───────────────────────────────────────────────────────────

describe("QA generate: generating again after you edited or deleted scopes", () => {
	it("a generated scope you deleted is not offered again, ticked, the next time you generate", () => {
		const vault = projects(["Garden", "Lyon"]);
		const accepted = firstRun(vault);
		expect(accepted.map((s) => s.name)).toEqual(["Garden", "Lyon"]);
		// Settings → Scopes → Lyon → Delete this scope.
		const afterDelete = accepted.filter((s) => s.name !== "Lyon");
		// Settings → Scopes → Find new scopes, then "Apply" without changing a toggle.
		const items = review(generate(vault).proposals, afterDelete);
		const after = applyReview(items, afterDelete);
		expect(after.map((s) => s.name)).toEqual(["Garden"]);
	});

	it("“Add them” does not put back, by itself, a scope you deleted", async () => {
		const vault = projects(["Garden", "Lyon", "Orion"]);
		const accepted = firstRun(vault);
		const afterDelete = accepted.filter((s) => s.name !== "Lyon");
		// Any change in the vault wakes the watcher; nothing about Lyon changed.
		const { w, state } = watcher("add", afterDelete, () => vault);
		await w.run();
		expect(state.scopes.map((s) => s.name)).toEqual(["Garden", "Orion"]);
	});

	it("archiving one project does not report the projects still there as Gone", () => {
		const before = snap([
			...notesIn("Projects/Garden", 6),
			...notesIn("Projects/Lyon", 6),
			...notesIn("Projects/Orion", 2),
			...loose(30),
		]);
		const accepted = firstRun(before);
		expect(accepted.map((s) => s.name)).toEqual(["Garden", "Lyon"]);
		// Lyon is finished: moved to Archive. Projects/Garden still exists with its 6 notes.
		const after = snap([
			...notesIn("Projects/Garden", 6),
			...notesIn("Archive/Lyon", 6),
			...notesIn("Projects/Orion", 2),
			...loose(30),
		]);
		// The review sees the vault (as the Generate page and the watcher give it), so it can tell Gone.
		const items = review(generate(after).proposals, accepted, after.notes);
		const garden = items.find((i) => i.scope?.name === "Garden");
		expect(garden?.state).not.toBe("gone");
	});

	it("notes added elsewhere do not report a property's scopes as Gone", () => {
		const clients = (extra: number): Snapshot => {
			const ns: NoteFacts[] = [];
			for (let i = 0; i < 15; i++)
				ns.push(note(`Client note ${i}.md`, { client: ["Acme", "Globex", "Initech"][i % 3] }));
			return snap([...ns, ...loose(extra, "Other")]);
		};
		const accepted = firstRun(clients(185));
		expect(accepted.map((s) => s.name).sort()).toEqual(["Acme", "Globex", "Initech"]);
		// 120 more notes (daily notes, clippings) that have nothing to do with clients.
		const v = clients(305);
		const items = review(generate(v).proposals, accepted, v.notes);
		expect(items.filter((i) => i.state === "gone").map((i) => i.scope?.name)).toEqual([]);
	});

	it("renaming a project folder keeps one scope, with your edits, on the new folder (“Add them”)", async () => {
		const accepted = firstRun(projects(["Garden", "Lyon", "Orion"]));
		const lyon = accepted.find((s) => s.name === "Lyon") as Scope;
		// Your edits on Lyon's page: Auto, and an alias.
		lyon.mode = "auto";
		lyon.aliases = ["trip"];
		// In the file explorer: Projects/Lyon renamed to Projects/Lyon Trip.
		const { w, state } = watcher("add", accepted, () => projects(["Garden", "Lyon Trip", "Orion"]));
		await w.run();
		const lyons = state.scopes.filter((s) => /lyon/i.test(s.name) || s.aliases.includes("trip"));
		expect(lyons.map((s) => [folderOfScope(s), s.mode, s.aliases])).toEqual([
			["Projects/Lyon Trip", "auto", ["trip"]],
		]);
	});

	it("“Add them” waits for review on a brand-new container, even when a flat tag agrees with one child", async () => {
		// First run: two projects; Garden's notes carry #garden, which joins Garden as a flat tag.
		const v1 = snap([
			...notesIn("Projects/Garden", 6, { tags: ["#garden"] }),
			...notesIn("Projects/Lyon", 6),
			...loose(30),
		]);
		const accepted = firstRun(v1);
		expect(accepted.map((s) => s.name)).toEqual(["Garden", "Lyon"]);
		// Later: a new top folder Clients with two clients. Acme's notes carry #acme.
		const v2 = snap([
			...v1.notes,
			...notesIn("Clients/Acme", 6, { tags: ["#acme"] }),
			...notesIn("Clients/Globex", 6),
		]);
		const { w, state } = watcher("add", accepted, () => v2);
		await w.run();
		// "Subfolders of Clients" is a new pattern: nothing from it is added without asking.
		expect(state.scopes.map((s) => s.name)).toEqual(["Garden", "Lyon"]);
	});

	it("a rule you removed is not put back after a later change to the scope", () => {
		const folder: Rule = { kind: "folder", path: "Projects/Garden" };
		const tag: Rule = { kind: "tag", tag: "#garden" };
		const link: Rule = { kind: "property", key: "project", target: "Projects/Garden/Garden.md" };
		const origin = { signal: "container-folder", at: "Projects", key: "Projects/Garden", v: 1 };
		const proposal = (rules: Rule[]) => ({
			id: "garden",
			name: "Garden",
			aliases: [],
			kind: "Projects",
			group: "Subfolders of Projects",
			rules: rules.map((rule) => ({ rule, count: 6 })),
			members: 6,
			ticked: true,
			untick: [],
			origins: [origin],
		});
		// Generated with the folder and #garden; you removed #garden on its page.
		let scopes: Scope[] = applyReview(review([proposal([folder, tag])], []), []);
		(scopes[0] as Scope).rules = [folder];
		// Next time: #garden no longer agrees, but project links do: "add 1 rule" (the link), applied.
		scopes = applyReview(review([proposal([folder, link])], scopes), scopes);
		expect(scopes[0]?.rules).toEqual([folder, link]);
		// Later #garden agrees again.
		const items = review([proposal([folder, link, tag])], scopes);
		expect(applyReview(items, scopes)[0]?.rules).toEqual([folder, link]);
	});
});

// ── What Generate proposes ─────────────────────────────────────────────────────

describe("QA generate: what Generate proposes on unusual vaults", () => {
	it("course folders named by code (CS 110, CS 210, MATH 221) are proposed, not taken for a numbered sequence", () => {
		const g = generate(
			snap([...notesIn("Courses/CS 110", 6), ...notesIn("Courses/CS 210", 6), ...notesIn("Courses/MATH 221", 6)]),
		);
		expect(
			g.proposals
				.filter((p) => p.ticked)
				.map((p) => p.name)
				.sort(),
		).toEqual(["CS 110", "CS 210", "MATH 221"]);
	});

	it("projects whose folder note is index.md give scopes named after the project, not three named “index”", () => {
		const ns: NoteFacts[] = [];
		for (const p of ["Garden", "Lyon", "Orion"]) {
			ns.push(note(`Projects/${p}/index.md`));
			ns.push(...notesIn(`Projects/${p}`, 5));
			for (let i = 0; i < 6; i++)
				ns.push(
					note(
						`Meetings/${p} meeting ${i}.md`,
						{ project: `[[Projects/${p}/index]]` },
						{ project: [`Projects/${p}/index.md`] },
					),
				);
		}
		const g = generate(snap(ns));
		expect(g.proposals.filter((p) => p.name === "index").length).toBe(0);
	});

	it("a value written two ways (Sci-Fi, Sci Fi) becomes one scope that holds the notes of both spellings", () => {
		const ns: NoteFacts[] = [];
		const add = (v: string, n: number) => {
			for (let i = 0; i < n; i++) ns.push(note(`Book ${ns.length}.md`, { genre: v }));
		};
		add("Sci-Fi", 5);
		add("Sci Fi", 3);
		add("Fantasy", 6);
		add("Mystery", 5);
		const g = generate(snap(ns));
		const scifi = g.proposals.filter((p) => fold(p.name) === "sci fi");
		// One proposal (the generator folds the spellings together)…
		expect(scifi).toHaveLength(1);
		// …that takes all 8 notes, not only the 5 with the most frequent spelling.
		expect(scifi[0]?.members).toBe(8);
	});

	it("flag and skin-tone emoji are stripped from folder names, like other emoji", () => {
		const g = generate(
			snap([
				...notesIn("Travel/🇫🇷 France", 6),
				...notesIn("Travel/🇯🇵 Japan", 6),
				...notesIn("Travel/👍🏽 Reviews", 6),
			]),
		);
		expect(g.proposals.map((p) => p.name).sort()).toEqual(["France", "Japan", "Reviews"]);
	});

	it("a property with two topics (area: Work / Personal) on a flat vault is proposed", () => {
		const ns: NoteFacts[] = [];
		for (let i = 0; i < 40; i++) ns.push(note(`Note ${i}.md`, { area: i % 2 ? "Work" : "Personal" }));
		const g = generate(snap(ns));
		expect(g.proposals.map((p) => p.name).sort()).toEqual(["Personal", "Work"]);
	});

	it("generating on a 15k-note vault with many nested tags takes well under a second (the watcher runs it on the main thread)", () => {
		const ns: NoteFacts[] = [];
		for (let i = 0; i < 15000; i++)
			ns.push(
				note(`Folder ${String.fromCharCode(65 + (i % 26))}${i % 40} x/n${i}.md`, {}, {}, [
					`#topic/t${(i * 7) % 300}`,
					`#person/p${(i * 8) % 300}`,
					`#source/s${(i * 9) % 300}`,
				]),
			);
		const s = snap(ns);
		const t = performance.now();
		generate(s);
		const ms = performance.now() - t;
		expect(ms).toBeLessThan(1000);
	}, 60_000);
});

// ── Creating a note in a generated scope ───────────────────────────────────────

describe("QA generate: creating a note in a generated scope", () => {
	it("the link filled in opens the scope's own note when other notes share its name", () => {
		const target = "Projects/Garden/index.md";
		const vaultPaths = ["Projects/Garden/index.md", "Projects/Lyon/index.md", "Projects/Orion/index.md"];
		const scope: Scope = {
			id: "g",
			name: "Garden",
			aliases: [],
			kind: "project",
			rules: [{ kind: "property", key: "project", target }],
			combine: "any",
			mode: "default",
			source: "generated",
		};
		const prop = createTarget(scope).prop;
		const linkpath = (prop?.[1] ?? "").replace(/^\[\[|\]\]$/g, "").split("|")[0] ?? "";
		// The notes the written link could open (by path, or by name when the path is not given).
		const opens = vaultPaths.filter((p) => p === `${linkpath}.md` || p.endsWith(`/${linkpath}.md`));
		expect(opens).toEqual([target]);
	});
});

// ── Settings ───────────────────────────────────────────────────────────────────

describe("QA generate: the settings tab before Obsidian 1.13", () => {
	const was = mockApi.version;
	afterEach(() => {
		mockApi.version = was;
	});

	// Pending: a classic Scopes UI for Obsidian 1.8–1.12 is not built yet, or
	// minAppVersion goes to 1.13. Kept as the check for whichever is chosen.
	it.skip("the classic tab (Jet supports 1.8) shows the scopes, Generate and “When new ones appear”", async () => {
		mockApi.version = "1.12.4";
		const app = new App();
		(app.vault as unknown as { files: Map<string, TFile> }).files.set(
			"Projects/Garden/Plan.md",
			new TFile("Projects/Garden/Plan.md"),
		);
		const plugin = new JetSearchPlugin(app as never, { id: "jet-search", name: "Jet", version: "0.0.1" } as never);
		await plugin.onload();
		plugin.data.scopes = [
			{
				id: "g",
				name: "Garden",
				aliases: [],
				kind: "Projects",
				rules: [{ kind: "folder", path: "Projects/Garden" }],
				combine: "any",
				mode: "default",
				source: "generated",
			},
		];
		const tab = (plugin as unknown as { settingTabs: JetSettingTab[] }).settingTabs[0] as JetSettingTab;
		tab.display();
		const names = [...tab.containerEl.querySelectorAll(".setting-item-name")].map((e) => e.textContent ?? "");
		plugin.onunload();
		expect(names).toContain("When new ones appear");
		expect(names.some((n) => n.includes("Garden"))).toBe(true);
	});
});
