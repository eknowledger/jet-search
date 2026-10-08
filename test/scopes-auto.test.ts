import { describe, expect, it } from "vitest";
import { ambiguity, autoApplies, autoOffer } from "../src/scopes/auto";

describe("when Auto is allowed", () => {
	it("ambiguity is mentions outside the scope per note inside it", () => {
		expect(ambiguity({ notes: 78, inside: 51 }, 51)).toBeCloseTo(27 / 51);
		expect(ambiguity({ notes: 653, inside: 30 }, 30)).toBeCloseTo(20.77, 1);
		expect(ambiguity({ notes: 0, inside: 0 }, 0)).toBe(0);
	});

	it("a rare name: Auto in any casing; a capitalised or acronym name: only as written; else not offered", () => {
		expect(autoOffer("Cobalt", 0.5)).toBe("any");
		expect(autoOffer("OKR", 2.9)).toBe("case");
		expect(autoOffer("Amber Studio", 3)).toBe("case");
		expect(autoOffer("Moonbridge", 4)).toBe("case");
		expect(autoOffer("Team", 20.8)).toBe("no");
		expect(autoOffer("General", 11.6)).toBe("no");
		// Not measured yet: as written only.
		expect(autoOffer("Cobalt", null)).toBe("case");
	});

	it("applies at once only when allowed for the casing typed", () => {
		expect(autoApplies("Cobalt", "cobalt", 0.5)).toBe(true);
		expect(autoApplies("OKR", "OKR", 2.9)).toBe(true);
		expect(autoApplies("OKR", "ask", 2.9)).toBe(false);
		expect(autoApplies("Team", "Team", 20.8)).toBe(false);
		expect(autoApplies("Cobalt", "Cobalt", null)).toBe(true);
		expect(autoApplies("Cobalt", "cobalt", null)).toBe(false);
	});
});
