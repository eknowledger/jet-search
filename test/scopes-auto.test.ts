import { describe, expect, it } from "vitest";
import { ambiguity, autoRisk } from "../src/scopes/auto";

describe("when Auto is allowed", () => {
	it("ambiguity is mentions outside the scope per note inside it", () => {
		expect(ambiguity({ notes: 78, inside: 51 }, 51)).toBeCloseTo(27 / 51);
		expect(ambiguity({ notes: 653, inside: 30 }, 30)).toBeCloseTo(20.77, 1);
		expect(ambiguity({ notes: 0, inside: 0 }, 0)).toBe(0);
	});

	it("over one mention outside per note inside, the page warns; not measured: nothing to say yet", () => {
		expect(autoRisk(0.5)).toBe("rare");
		expect(autoRisk(1)).toBe("rare");
		expect(autoRisk(20.8)).toBe("common");
		expect(autoRisk(null)).toBeNull();
	});
});
