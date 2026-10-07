import "obsidian";
import { describe, expect, it } from "vitest";
import { age, crumb, highlight, titleOf } from "../src/modal/format";

describe("row formatting", () => {
	it("shortens long breadcrumbs", () => {
		expect(crumb("a/b/c.md")).toBe("a / b");
		expect(crumb("a/b/c/d/e/f.md")).toBe("a / … / d / e");
		expect(crumb("f.md")).toBe("");
		expect(titleOf("x/Garden Plan.md")).toBe("Garden Plan");
	});

	it("says how long ago, briefly", () => {
		const now = new Date(2026, 9, 7, 15, 0).getTime();
		expect(age(now - 30_000, now)).toBe("now");
		expect(age(now - 22 * 60_000, now)).toBe("22m");
		expect(age(now - 3 * 3_600_000, now)).toBe("3h");
		expect(age(new Date(2026, 9, 5, 9).getTime(), now)).toBe("Mon");
		expect(age(new Date(2026, 8, 12).getTime(), now)).toBe("Sep 12");
		expect(age(new Date(2025, 8, 12).getTime(), now)).toBe("Sep 12, 2025");
	});

	it("wraps ranges in highlight spans, in order, ignoring overlaps", () => {
		const el = document.createElement("div");
		highlight(
			el,
			"Pattern Spec",
			[
				[9, 13],
				[0, 1],
				[0, 2],
			],
			"jet-th",
		);
		expect(el.innerHTML).toBe('<span class="jet-th">Pl</span>atform <span class="jet-th">Spec</span>');
	});
});
