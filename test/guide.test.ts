import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const guide = readFileSync("docs/guide.md", "utf8");
const main = readFileSync("src/main.ts", "utf8");

describe("guide", () => {
	// Jet answers Omnisearch's two commands while Omnisearch is off. Nothing on screen says so, so the guide does,
	// with the same names the command palette shows.
	it("explains the Omnisearch shortcuts, with the names the palette shows", () => {
		const names = [...main.matchAll(/"(Jet Search: [^"]*\(Omnisearch's shortcut\))"/g)].map((m) => m[1] ?? "");
		expect(names.length).toBe(2);
		for (const name of names) expect(guide).toContain(name.replace("Jet Search: ", ""));
		expect(guide).toMatch(/Omnisearch is (?:turned )?on/i);
	});
});
