import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readme = readFileSync("README.md", "utf8");

describe("README", () => {
	// Obsidian's directory shows this file on its own site, where a path relative to the repository points
	// at nothing. Every image and file link is a full address; only #anchors stay relative.
	it("uses full addresses for images and links, so it reads the same on the directory page", () => {
		const targets = [
			...[...readme.matchAll(/\]\(([^)\s]+)/g)].map((m) => m[1] ?? ""),
			...[...readme.matchAll(/(?:src|srcset)="([^"]+)"/g)].map((m) => m[1] ?? ""),
		];
		expect(targets.length).toBeGreaterThan(10);
		const relative = targets.filter((t) => !/^(https?:|#|mailto:)/.test(t));
		expect(relative).toEqual([]);
	});

	// A figure written by hand goes stale the day after: the number of tests and the file size both moved.
	it("keeps no hand-typed test count or plugin size", () => {
		expect(readme).not.toMatch(/\b\d[\d,]*\s+automated tests/i);
		expect(readme).not.toMatch(/tests-\d+%20passing/);
		expect(readme).not.toMatch(/plugin-\d+%20KB/);
		expect(readme).not.toMatch(/\bis \d+ KB\b/);
	});
});
