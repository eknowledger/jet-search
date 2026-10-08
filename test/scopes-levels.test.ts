import { describe, expect, it } from "vitest";
import { generate } from "../src/scopes/generate";
import type { NoteFacts } from "../src/scopes/members";
import { emptyConfig, type Snapshot } from "../src/scopes/snapshot";

/** Notes in a folder: `n` of them named `<prefix> i`, with optional properties, links and tags. */
const notes = (
	folder: string,
	n: number,
	extra: { prefix?: string; props?: Record<string, string>; links?: Record<string, string[]>; tags?: string[] } = {},
): NoteFacts[] =>
	Array.from({ length: n }, (_, i) => ({
		path: `${folder}/${extra.prefix ?? "Note"} ${i}.md`,
		// A link property is written as [[Title]] and resolved into `links`.
		props: {
			...extra.props,
			...Object.fromEntries(
				Object.entries(extra.links ?? {}).map(([k, v]) => [
					k,
					v.map((t) => `[[${(t.split("/").pop() ?? "").replace(/\.md$/, "")}]]`).join(", "),
				]),
			),
		},
		links: { ...extra.links },
		tags: [...(extra.tags ?? [])],
	}));
const note = (path: string): NoteFacts => ({ path, props: {}, links: {}, tags: [] });
const snap = (all: NoteFacts[]): Snapshot => ({ notes: all, files: all.map((n) => n.path), config: emptyConfig() });
const ticked = (s: Snapshot): string[] =>
	generate(s)
		.proposals.filter((p) => p.ticked)
		.map((p) => p.name)
		.sort();
const why = (s: Snapshot, name: string): string[] | undefined =>
	generate(s).proposals.find((p) => p.name === name)?.untick;

describe("levels per branch", () => {
	it("a sibling of a folder split into its own children stays on its level", () => {
		const s = snap([
			...["articles", "books", "podcasts"].flatMap((v) =>
				notes(`Library/Readwise/${v[0]?.toUpperCase()}${v.slice(1)}`, 6, { props: { category: v } }),
			),
			...notes("Library/Clippings", 6),
			...notes("Library/Book Notes", 6),
		]);
		expect(ticked(s)).toEqual(["Articles", "Book Notes", "Books", "Clippings", "Podcasts"]);
		expect(why(s, "Readwise")).toContain("a level below or above the main one");
	});

	it("date-named subfolders do not make a container; a top-level leaf a property agrees with is a scope", () => {
		const s = snap([
			// Most of the vault is in Courses/, split into courses: other top-level leaves are buckets.
			...["Alpha", "Beta", "Gamma", "Delta"].flatMap((c) => [
				note(`Courses/${c}/${c}.md`),
				...notes(`Courses/${c}`, 10, { links: { course: [`Courses/${c}/${c}.md`] } }),
			]),
			note("Thesis/Thesis.md"),
			...notes("Thesis", 10, { links: { project: ["Thesis/Thesis.md"] }, tags: ["#thesis"] }),
			...notes("Thesis/Ideas", 6, { tags: ["#thesis"] }),
			...Array.from({ length: 8 }, (_, i) => note(`Thesis/Drafts/2025-01-0${i + 1}.md`)),
			...notes("Papers", 10),
		]);
		expect(ticked(s)).toEqual(["Alpha", "Beta", "Delta", "Gamma", "Thesis"]);
		expect(generate(s).proposals.some((p) => p.name === "Ideas")).toBe(false);
		expect(why(s, "Papers")).toContain("a level below or above the main one");
	});

	it("when split folders hold under half the vault, top-level folders are topics in their own right", () => {
		const s = snap([
			...["Alpha", "Beta"].flatMap((c) => [
				note(`Courses/${c}/${c}.md`),
				...notes(`Courses/${c}`, 5, { links: { course: [`Courses/${c}/${c}.md`] } }),
			]),
			...notes("Recipes", 20),
			...notes("Papers", 10),
		]);
		expect(ticked(s)).toEqual(["Alpha", "Beta", "Papers", "Recipes"]);
	});

	it("off a primary container, a folder holding the notes other scopes link to is above them", () => {
		const s = snap([
			...["Garden", "Kiln"].flatMap((p) => [note(`Efforts/On/${p}/${p}.md`), ...notes(`Efforts/On/${p}`, 5)]),
			note("Efforts/Ongoing/Runs.md"),
			note("Efforts/Ongoing/Bread.md"),
			...notes("Efforts/Ongoing", 4),
			...notes("Logs", 5, { prefix: "Garden log", links: { effort: ["Efforts/On/Garden/Garden.md"] } }),
			...notes("Logs", 5, { prefix: "Kiln log", links: { effort: ["Efforts/On/Kiln/Kiln.md"] } }),
			...notes("Logs", 5, { prefix: "Run log", links: { effort: ["Efforts/Ongoing/Runs.md"] } }),
			...notes("Logs", 5, { prefix: "Bread log", links: { effort: ["Efforts/Ongoing/Bread.md"] } }),
		]);
		const t = ticked(s);
		expect(t).toEqual(expect.arrayContaining(["Bread", "Garden", "Kiln", "Runs"]));
		expect(t).not.toContain("Ongoing");
	});

	it("a child folder with an archive-like name starts unticked", () => {
		const s = snap([...notes("Projects/Alpha", 6), ...notes("Projects/Beta", 6), ...notes("Projects/_archive", 6)]);
		expect(ticked(s)).toEqual(["Alpha", "Beta"]);
		expect(why(s, "_archive")).toContain("an archive");
	});

	it("one group under two names merges; a topic tag mostly inside one course stays its own scope", () => {
		const s = snap([
			...notes("Courses/Alpha", 9, { tags: ["#course/alpha", "#topic/net"] }),
			...notes("Courses/Alpha", 1, { prefix: "Intro", tags: ["#course/alpha"] }),
			...notes("Courses/Beta", 9, { tags: ["#course/beta", "#topic/db"] }),
			...notes("Courses/Beta", 1, { prefix: "Intro", tags: ["#course/beta"] }),
			...notes("Papers", 9, { prefix: "Net", tags: ["#topic/net"] }),
			...notes("Papers", 9, { prefix: "Db", tags: ["#topic/db"] }),
			// A third topic: two would read as a state (yes/no).
			...notes("Papers", 9, { prefix: "Ml", tags: ["#topic/ml"] }),
		]);
		const g = generate(s);
		const rules = (name: string): string[] =>
			(g.proposals.find((p) => p.name === name)?.rules ?? []).map((r) =>
				r.rule.kind === "tag" ? r.rule.tag : r.rule.kind,
			);
		expect(rules("Alpha")).toEqual(["folder", "#course/alpha"]);
		expect(rules("net")).toEqual(["#topic/net"]);
		expect(ticked(s)).toEqual(["Alpha", "Beta", "Papers", "db", "ml", "net"]);
	});
});
