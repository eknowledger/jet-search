import { beforeEach, describe, expect, it, vi } from "vitest";
import { diag, errorName, errorWhere, fail, warned } from "../src/diag/diag";

describe("what Jet remembers about itself", () => {
	beforeEach(() => diag.reset());

	it("starts with nothing counted", () => {
		expect(diag.workerStarts).toBe(0);
		expect(diag.workerCrashes).toBe(0);
		expect(diag.sleeps).toBe(0);
		expect(diag.problems).toEqual([]);
	});

	it("keeps a problem as a code and an error name, never the message", () => {
		diag.problem("search.failed", new TypeError("cannot read /Vault/Private Notes/Secret.md"));
		expect(diag.problems).toHaveLength(1);
		expect(diag.problems[0]).toMatchObject({ code: "search.failed", error: "TypeError", count: 1 });
		expect(JSON.stringify(diag.problems)).not.toContain("Secret");
	});

	it("counts the same problem again instead of listing it twice in a row", () => {
		const e = new Error("x");
		diag.problem("save.failed", e);
		diag.problem("save.failed", e);
		diag.problem("save.failed", e);
		expect(diag.problems).toHaveLength(1);
		expect(diag.problems[0]?.count).toBe(3);
	});

	it("lists a different problem on its own line", () => {
		diag.problem("save.failed", new Error("a"));
		diag.problem("index.open", new RangeError("b"));
		diag.problem("save.failed", new Error("c"));
		expect(diag.problems.map((p) => p.code)).toEqual(["save.failed", "index.open", "save.failed"]);
	});

	it("keeps only the last twenty problems", () => {
		for (let i = 0; i < 30; i++) diag.problem(`p.${i}`, new Error("x"));
		expect(diag.problems).toHaveLength(20);
		expect(diag.problems[0]?.code).toBe("p.10");
		expect(diag.problems[19]?.code).toBe("p.29");
	});

	it("names what was thrown, even when it was not an Error", () => {
		expect(errorName(new RangeError("x"))).toBe("RangeError");
		expect(errorName("text with /a/path")).toBe("string");
		expect(errorName(null)).toBe("null");
		expect(errorName(undefined)).toBe("undefined");
		expect(errorName({ message: "x" })).toBe("object");
	});

	it("counts worker starts, crashes and sleeps", () => {
		diag.workerStarted();
		diag.workerStarted();
		diag.workerCrashed();
		diag.slept();
		expect([diag.workerStarts, diag.workerCrashes, diag.sleeps]).toEqual([2, 1, 1]);
	});

	it("resets to nothing", () => {
		diag.workerStarted();
		diag.problem("a", new Error("x"));
		diag.reset();
		expect(diag.workerStarts).toBe(0);
		expect(diag.problems).toEqual([]);
	});

	it("keeps whether it was an error or a warning, and counts them apart", () => {
		const e = new Error("x");
		diag.problem("a.b", e);
		diag.problem("a.b", e, "warn");
		diag.problem("a.b", e, "warn");
		expect(diag.problems.map((p) => [p.level, p.count])).toEqual([
			["error", 1],
			["warn", 2],
		]);
	});

	it("tells errors from warnings through fail and warned", () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		fail("x.failed", "Jet Search: x", new Error("a"));
		warned("y.warned", "Jet Search: y", new Error("b"));
		expect(diag.problems.map((p) => [p.code, p.level])).toEqual([
			["x.failed", "error"],
			["y.warned", "warn"],
		]);
		log.mockRestore();
		warn.mockRestore();
	});

	it("keeps the place in Jet's code, as function and position, never a file name", () => {
		const e = new Error("x");
		e.stack = "Error: x\n    at openIndex (app://obsidian.md/plugins/jet/main.js:120:7)\n    at run (blob:abc:5:1)";
		expect(errorWhere(e)).toBe("openIndex:120:7");
		e.stack = "Error: x\n    at app://obsidian.md/x/main.js:9:3";
		expect(errorWhere(e)).toBe("anonymous:9:3");
		e.stack = "Error: /Vault/Secret.md";
		expect(errorWhere(e)).toBeNull();
		expect(errorWhere("text")).toBeNull();
		diag.problem("k.l", e);
		expect(JSON.stringify(diag.problems)).not.toMatch(/Secret|app:\/\//);
	});

	it("knows when the worker started and that it stopped", () => {
		expect(diag.workerSince).toBeNull();
		diag.workerStarted();
		expect(diag.workerSince).not.toBeNull();
		diag.workerStopped();
		expect(diag.workerSince).toBeNull();
	});
});
