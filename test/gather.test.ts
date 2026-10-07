import { describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";
import { excluder, gather, inboundCounts } from "../src/index/gather";

const app = (): App => {
	const a = new App();
	const m = a.metadataCache as unknown as {
		caches: Map<string, unknown>;
		resolvedLinks: Record<string, Record<string, number>>;
	};
	m.caches.set("Projects/Orchid/Plan.md", {
		frontmatterPosition: { end: { offset: 22 } },
		frontmatter: { aliases: ["OP"], tags: ["project"] },
		headings: [
			{ level: 1, heading: "Orchid plan" },
			{ level: 2, heading: "Scope" },
		],
		tags: [{ tag: "#topic/garden" }],
		links: [{ link: "Lantern" }, { link: "Missing Note#Part" }],
	});
	m.resolvedLinks = {
		"Projects/Orchid/Plan.md": { "Lantern.md": 1 },
		"Daily.md": { "Lantern.md": 2, "Projects/Orchid/Plan.md": 1 },
	};
	return a;
};

describe("gathering a note from Obsidian", () => {
	it("takes headings, tags, aliases, resolved links and the body start from the metadata cache", () => {
		const a = app();
		const f = new TFile("Projects/Orchid/Plan.md");
		f.stat.mtime = 5;
		const text = "---\naliases: [OP]\n---\n# Orchid plan\nbody";
		const r = gather(a, f, text, 3);
		expect(r).toEqual({
			path: "Projects/Orchid/Plan.md",
			mtime: 5,
			text,
			bodyStart: 22,
			aliases: ["OP"],
			headings: [
				{ level: 1, text: "Orchid plan" },
				{ level: 2, text: "Scope" },
			],
			tags: ["project", "topic/garden"],
			links: ["Lantern", "Missing Note"],
			inLinks: 3,
		});
	});

	it("counts inbound links per note", () => {
		expect(inboundCounts(app())).toEqual(
			new Map([
				["Lantern.md", 2],
				["Projects/Orchid/Plan.md", 1],
			]),
		);
	});

	it("leaves out excluded folders and Obsidian's excluded files", () => {
		const a = app();
		(a.vault as unknown as { getConfig: (k: string) => unknown }).getConfig = (k) =>
			k === "userIgnoreFilters" ? ["Archive/", "/\\.excalidraw\\.md$/", "/[bad/"] : null;
		const out = excluder(a, ["Templates"]);
		expect(["Templates/x.md", "Archive/y.md", "a.excalidraw.md", "Notes/z.md"].map(out)).toEqual([
			true,
			true,
			true,
			false,
		]);
	});
});
