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
	it("the engine and the worker do not use its memory (the worker only reads an error's class and place)", () => {
		const off = [...files("src/engine"), ...files("src/worker").filter((f) => !f.endsWith("jet-client.ts"))];
		expect(off.length).toBeGreaterThan(10);
		for (const f of off) expect(read(f).replaceAll("diag/error-facts", ""), f).not.toMatch(/diag\//);
	});

	it("the engine does not even tell the worker's router about errors: only the router and the entry do", () => {
		for (const f of files("src/engine")) expect(read(f), f).not.toMatch(/notify|\btell\(/);
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
				if (!/\b(fail|warned|noted)\(/.test(line) || /^\s*(import|export)\b/.test(line)) return;
				// Inside a catch block, a .catch handler or the rejection handler of a .then, in the line or the few before it.
				const near = lines.slice(Math.max(0, i - 6), i + 1).join("\n");
				expect(near, `${f}:${i + 1}`).toMatch(/catch|\.then\(/);
			});
		}
	});

	it("the memory of it starts nothing: no timer, no listener, no work when it is loaded", () => {
		const src = read("src/diag/diag.ts") + read("src/diag/error-facts.ts") + read("src/diag/recorder.ts");
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

	it("the recorder is touched only by the full-text and meaning searches, outside loops and callbacks", () => {
		for (const f of files("src")) {
			if (f.includes("/diag/") || f.endsWith("src/search.ts")) continue;
			expect(read(f), f).not.toMatch(/\brecorder\b/);
		}
		const lines = read("src/search.ts").split("\n");
		const indent = (l: string): number => /^\t*/.exec(l)?.[0].length ?? 0;
		let seen = 0;
		lines.forEach((line, i) => {
			if (!/\brecorder\./.test(line)) return;
			seen++;
			// Every block this line sits in, from the inside out: none may be a loop or a callback, except the
			// async function each search runs in.
			let depth = indent(line);
			for (let k = i - 1; k >= 0 && depth > 0; k--) {
				const l = lines[k] as string;
				if (!l.trim() || indent(l) >= depth) continue;
				depth = indent(l);
				const opener = l.trim();
				if (/^void \(async \(\) => \{$/.test(opener)) continue;
				expect(opener, `search.ts:${i + 1} sits inside ${opener}`).not.toMatch(
					/\b(for|while)\b|=>|\.(map|filter|forEach|some|every|sort|reduce|then|catch)\(|\bfunction\b/,
				);
			}
		});
		expect(seen).toBeGreaterThan(4);
	});
});
