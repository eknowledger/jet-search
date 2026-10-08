import { describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";
import { noteFacts } from "../src/scopes/facts";

describe("a note's facts from the metadata cache", () => {
	it("resolves frontmatter links (lists too) to the notes they open, and gathers tags", () => {
		const app = new App();
		const m = app.metadataCache as unknown as {
			caches: Map<string, unknown>;
			resolvedLinks: Record<string, Record<string, number>>;
		};
		m.resolvedLinks = { "Projects/Garden/Garden.md": {}, "Projects/Lyon/Lyon.md": {} };
		m.caches.set("Daily/2025-03-01.md", {
			frontmatter: { project: ["[[Garden]]", "[[Projects/Lyon/Lyon|Lyon trip]]"], type: "log", tags: ["daily"] },
			frontmatterLinks: [
				{ key: "project.0", link: "Garden", original: "[[Garden]]" },
				{ key: "project.1", link: "Projects/Lyon/Lyon", original: "[[Projects/Lyon/Lyon|Lyon trip]]" },
				{ key: "Related", link: "Nowhere", original: "[[Nowhere]]" },
			],
			tags: [{ tag: "#garden/beds" }],
		});
		const f = noteFacts(app as never, new TFile("Daily/2025-03-01.md") as never);
		expect(f.path).toBe("Daily/2025-03-01.md");
		expect(f.links).toEqual({ project: ["Projects/Garden/Garden.md", "Projects/Lyon/Lyon.md"] });
		expect(f.props.type).toBe("log");
		expect(f.tags).toEqual(["#daily", "#garden/beds"]);
	});

	it("has empty facts for a note Obsidian has not read yet", () => {
		const f = noteFacts(new App() as never, new TFile("New.md") as never);
		expect(f).toEqual({ path: "New.md", props: {}, links: {}, tags: [] });
	});
});
