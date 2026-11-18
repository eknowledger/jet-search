import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { missingFeature } from "../src/compat";

const sources = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
	);

describe("older phones", () => {
	// A lookbehind written as a regex literal is a syntax error before iOS 16.4: the whole bundle would
	// fail to load, with no message. The ones built at run time (new RegExp) fail only when used, and
	// `missingFeature` stops Jet before that.
	it("no source file writes a regex lookbehind as a literal", () => {
		const bad = sources("src").filter((f) => /\/(?:[^/\n*]|\\\/)*\(\?<[=!]/.test(readFileSync(f, "utf8")));
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
