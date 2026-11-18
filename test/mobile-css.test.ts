import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("styles.css", "utf8");
const MARK = "/* Phones and tablets */";

/** The rules written after the marker, as [selector, body] pairs (no nested at-rules in this block). */
const mobileRules = (): Array<[string, string]> => {
	const at = css.indexOf(MARK);
	if (at < 0) return [];
	const out: Array<[string, string]> = [];
	for (const m of css
		.slice(at + MARK.length)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.matchAll(/([^{}]+)\{([^{}]*)\}/g))
		out.push([(m[1] ?? "").trim(), (m[2] ?? "").trim()]);
	return out;
};

const rule = (selector: string): string | undefined => mobileRules().find(([s]) => s.split(/,\s*/).includes(selector))?.[1];

describe("phone styles", () => {
	// Everything for phones sits in one block at the end of styles.css, and every selector in it starts
	// with a class Obsidian puts on the body of a phone or tablet, so desktop never reads any of it.
	it("every rule in the phone block is under body.is-mobile or body.is-phone", () => {
		const rules = mobileRules();
		expect(rules.length).toBeGreaterThan(0);
		const loose = rules.flatMap(([s]) => s.split(/,\s*/)).filter((s) => !/^body\.is-(mobile|phone)\b/.test(s));
		expect(loose).toEqual([]);
	});

	it("the footer of key hints is hidden on a phone only", () => {
		expect(rule("body.is-phone .modal.jet-modal .jet-ft")).toMatch(/display:\s*none/);
		// Desktop and tablets keep it: the base rule does not hide it.
		expect(css.slice(0, css.indexOf(MARK))).not.toMatch(/\.jet-ft\s*\{[^}]*display:\s*none/);
	});
});
