import { describe, expect, it } from "vitest";
import "./obsidian-mock";
import { forgetThemeMark, themeMark } from "../src/modal/theme-mark";

describe("Jet's marks in the theme's highlight", () => {
	it("reads a note's mark colours once per theme, and leaves nothing behind", () => {
		const style = document.createElement("style");
		style.textContent = ".markdown-rendered mark { background-color: rgb(245, 224, 220); color: rgb(24, 24, 37); }";
		document.head.append(style);
		forgetThemeMark();
		const before = document.body.childElementCount;
		expect(themeMark(document)).toEqual({
			"--jet-mark-bg": "rgb(245, 224, 220)",
			"--jet-mark-fg": "rgb(24, 24, 37)",
		});
		expect(document.body.childElementCount).toBe(before);
		// Another theme: still the first measure until the theme change is told.
		style.textContent = ".markdown-rendered mark { background-color: rgb(1, 2, 3); color: rgb(4, 5, 6); }";
		expect(themeMark(document)["--jet-mark-bg"]).toBe("rgb(245, 224, 220)");
		forgetThemeMark();
		expect(themeMark(document)["--jet-mark-bg"]).toBe("rgb(1, 2, 3)");
		style.remove();
		forgetThemeMark();
	});
});
