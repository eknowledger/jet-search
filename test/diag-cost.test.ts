import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const files = (dir: string): string[] =>
	readdirSync(dir).flatMap((n) => {
		const p = join(dir, n);
		return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
	});

const read = (p: string): string => readFileSync(p, "utf8");

/**
 * The support info must cost searches nothing. These are checks on the code, not on timings (a timing
 * check is noise on a busy machine): the search engine and the worker never touch it, and the hot paths of
 * the main thread only ever name it in a catch, through `fail` and `warned`.
 */
describe("the support info stays out of the hot paths", () => {
	it("the engine, the index and the worker do not use it", () => {
		const off = [...files("src/engine"), ...files("src/worker").filter((f) => !f.endsWith("jet-client.ts"))];
		expect(off.length).toBeGreaterThan(10);
		for (const f of off) expect(read(f), f).not.toMatch(/diag\//);
	});

	it("the search, the ranking and the modal call no counter of it", () => {
		const hot = ["src/search.ts", "src/rank.ts", ...files("src/modal"), ...files("src/tier0")];
		for (const f of hot) expect(read(f), f).not.toMatch(/\bdiag\./);
	});

	it("an error is recorded only where it is already caught", () => {
		for (const f of files("src")) {
			if (f.includes("/diag/")) continue;
			const lines = read(f).split("\n");
			lines.forEach((line, i) => {
				if (!/\b(fail|warned)\(/.test(line) || /^\s*(import|export)\b/.test(line)) return;
				// Inside a catch block, a .catch handler or the rejection handler of a .then, in the line or the few before it.
				const near = lines.slice(Math.max(0, i - 6), i + 1).join("\n");
				expect(near, `${f}:${i + 1}`).toMatch(/catch|\.then\(/);
			});
		}
	});

	it("the memory of it starts nothing: no timer, no listener, no work when it is loaded", () => {
		const src = read("src/diag/diag.ts");
		expect(src).not.toMatch(
			/setTimeout|setInterval|requestAnimationFrame|addEventListener|\.on\(|registerEvent|new Worker/,
		);
	});

	it("the report is built only on request: Obsidian's start does not import its collector eagerly into a listener", () => {
		const main = read("src/main.ts");
		// The only mention of the window in main is the command that opens it.
		const mentions = main.split("\n").filter((l) => /SupportModal|collect\(/.test(l) && !l.startsWith("import"));
		expect(mentions.length).toBe(1);
		expect(mentions[0]).toMatch(/new SupportModal/);
	});
});
