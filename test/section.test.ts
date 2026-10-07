import { describe, expect, it } from "vitest";
import { sectionAround } from "../src/preview/section";

const FM = "---\ntags: [demo]\n---\n";
const NOTE = `${FM}# CSS Render Test Page\nIntro line.\n## Colours\nRed and blue.\n## Fonts\nSerif and sans.\n`;
const shown = (text: string, offset?: number, cap?: number): string => {
	const { from, to } = sectionAround(text, FM.length - 1, offset, cap);
	return text.slice(from, to);
};

describe("the part of a note the preview renders", () => {
	it("shows the note from the top when there is no hit in the text (a title match)", () => {
		const s = shown(NOTE);
		expect(s).toContain("# CSS Render Test Page");
		expect(s).toContain("Intro line.");
		expect(s).toContain("Serif and sans.");
	});

	it("shows the section around a hit: from its heading to the next of the same level", () => {
		const s = shown(NOTE, NOTE.indexOf("blue"));
		expect(s.trim().startsWith("## Colours")).toBe(true);
		expect(s).toContain("Red and blue.");
		expect(s).not.toContain("Serif");
	});

	it("caps a long note, from the top or around the hit", () => {
		const long = `${FM}# Title\n${"A line of text.\n".repeat(2000)}`;
		expect(shown(long, undefined, 1000).length).toBeLessThanOrEqual(1100);
		const at = long.length - 50;
		const { from, to } = sectionAround(long, FM.length - 1, at, 1000);
		expect(to - from).toBeLessThanOrEqual(1100);
		expect(from).toBeLessThanOrEqual(at);
		expect(to).toBeGreaterThan(at);
	});
});
