import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { App } from "obsidian";
import { Explainer } from "../src/explain/explainer";
import type { JetClient } from "../src/worker/jet-client";

const files = (dir: string): string[] =>
	readdirSync(dir).flatMap((n) => {
		const p = join(dir, n);
		return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
	});
const read = (p: string): string => readFileSync(p, "utf8");

/**
 * Explaining must cost searches nothing. These are checks on the code, not on timings: a search never
 * reaches it, nothing of it runs at Obsidian's start, and the only thing it adds to typing is a test of one
 * boolean.
 */
describe("explaining stays out of the way of searching", () => {
	it("the search, the ranking and the names do not know it", () => {
		for (const f of ["src/search.ts", "src/rank.ts", ...files("src/tier0")])
			expect(read(f), f).not.toMatch(/explain/i);
	});

	it("the engine's query and the worker's query and nearest do not call it", () => {
		const engine = read("src/engine/jet-engine.ts");
		const query = engine.slice(
			engine.indexOf("	query(q: Query"),
			engine.indexOf("	/**\n	 * Why a search lists what it does"),
		);
		expect(query).not.toMatch(/explain/i);
		const router = read("src/worker/router.ts");
		const at = router.indexOf("	explain(req");
		// The engine and the vectors are asked only from the explain handler, once each.
		for (const call of ["this.engine.explain(", "explainMeaning({"]) {
			expect(router.split(call)).toHaveLength(2);
			expect(router.indexOf(call), call).toBeGreaterThan(at);
		}
	});

	it("the engine and the worker do not import the support info, and the explanation does not import the search", () => {
		for (const f of files("src/explain"))
			expect(read(f), f).not.toMatch(/from "\.\.\/search"|from "\.\.\/diag\/(?!diag)/);
		for (const f of [...files("src/engine"), "src/meaning/explain.ts"]) expect(read(f), f).not.toMatch(/diag\//);
	});

	it("nothing of it starts anything: no timer, no listener, no worker, apart from the pane the user opens", () => {
		for (const f of files("src/explain"))
			expect(read(f), f).not.toMatch(
				/setTimeout|setInterval|requestAnimationFrame|addEventListener|\.on\(|registerEvent|new Worker/,
			);
	});

	it("making the explainer, as Obsidian's start does, asks the worker for nothing", () => {
		let asked = 0;
		const client = { explain: () => (asked++, Promise.reject(new Error("no"))) } as unknown as JetClient;
		new Explainer({
			app: new App() as never,
			client,
			ensure: () => (asked++, Promise.resolve()),
			progress: () => null,
			excluded: () => [],
		});
		expect(asked).toBe(0);
	});

	it("the window's own change on the typing path is a test of one boolean", () => {
		const modal = read("src/modal/jet-modal.ts");
		// The pane is told of a new list, and does nothing at all unless it is open.
		expect(modal).toContain("this.explainPane?.refresh();");
		expect(read("src/modal/explain-pane.ts")).toMatch(
			/refresh\(\): void \{\n\t\tif \(this\.shown\) this\.ask\(\);/,
		);
	});
});
