import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { missingFeature } from "../src/compat";

const sources = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
	);

describe("older phones", () => {
	// A lookbehind before iOS 16.4 is a syntax error: as a literal, the whole bundle fails to load with no
	// message; built at run time, the search that uses it fails. None is used, so the floor is lower.
	it("no source file uses a regex lookbehind", () => {
		const bad = sources("src").filter((f) => /\(\?<[=!]/.test(readFileSync(f, "utf8")));
		expect(bad).toEqual([]);
	});

	it("an engine with everything Jet uses reports nothing missing", () => {
		expect(missingFeature()).toBeNull();
	});

	it("names the first missing feature", () => {
		const real = Array.prototype.at;
		// @ts-expect-error simulating an engine from before 2022
		delete Array.prototype.at;
		try {
			expect(missingFeature()).toMatch(/Array\.prototype\.at/);
		} finally {
			Array.prototype.at = real;
		}
	});
});
