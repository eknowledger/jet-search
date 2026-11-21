import { beforeEach, describe, expect, it } from "vitest";
import { diag, errorName } from "../src/diag/diag";

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
});
