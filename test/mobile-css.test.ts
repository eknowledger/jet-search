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

const rule = (selector: string): string | undefined =>
	mobileRules().find(([s]) => s.split(/,\s*/).includes(selector))?.[1];

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

	// A finger needs 44 px. The look stays; a transparent area around each small control reaches 44.
	it("the small controls get a 44 px touch area without changing size", () => {
		const reach = (selector: string, from: number): void => {
			const body = rule(selector) ?? "";
			const inset = /inset:\s*(-?\d+)px/.exec(body);
			expect(body, selector).toMatch(/content:\s*""/);
			expect(body, selector).toMatch(/position:\s*absolute/);
			expect(from + 2 * Math.abs(Number(inset?.[1])), selector).toBeGreaterThanOrEqual(44);
		};
		reach("body.is-mobile .jet-clear::before", 22);
		reach("body.is-mobile .jet-fbtn::before", 28);
		// The two sit side by side: their areas must not overlap (11 + 8 px reach, 6 px gap before).
		expect(rule("body.is-mobile .jet-clear")).toMatch(/margin-right:\s*(1[9-9]|[2-9]\d)px/);
	});

	it("a section header holding the sort control is 44 px high, so the sort control is", () => {
		expect(rule("body.is-mobile .jet-h.has-sort")).toMatch(/height:\s*44px/);
		expect(rule("body.is-mobile .jet-sort")).toMatch(/align-self:\s*stretch/);
	});

	// Obsidian's directory scan warns about both: they are only partly supported by the older apps it targets.
	it("the stylesheet needs neither :has() nor display: contents", () => {
		const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
		expect(code).not.toMatch(/:has\(/);
		expect(code).not.toMatch(/display:\s*contents/);
	});

	it("the chip boxes in the search field lay out their chips in a row, and take no room when empty", () => {
		for (const box of [".jet-kept", ".jet-fchips"]) {
			const body = new RegExp(`${box.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
			expect(body, box).toMatch(/display:\s*flex/);
			expect(body, box).toMatch(/align-items:\s*center/);
			expect(body, box).toMatch(/gap:\s*4px/);
			expect(css, box).toMatch(new RegExp(`${box.replace(".", "\\.")}:empty\\s*\\{[^}]*display:\\s*none`));
		}
	});

	it("scope chips keep their 26 px look and reach 44 px, with room above and below in the sliding row", () => {
		expect(rule("body.is-mobile .jet-schip::before")).toMatch(/inset:\s*-10px/);
		expect(rule("body.is-mobile .jet-scrow.is-slide .jet-schips")).toMatch(/padding:\s*10px/);
	});

	// Obsidian's phone style turns every settings row into a dark pill with a 30 px radius; Jet's option rows
	// sit inside a card and read as plain lines, as on a computer.
	it("option rows inside a settings card are flat lines with a small indent", () => {
		expect(rule("body.is-mobile .jet-set-opts")).toMatch(/padding:\s*4px 14px 8px 14px/);
		const row = rule("body.is-mobile .jet-set-opts .setting-item") ?? "";
		expect(row).toMatch(/background:\s*none/);
		expect(row).toMatch(/border-radius:\s*0/);
		expect(row).toMatch(/margin:\s*0/);
		expect(rule("body.is-mobile .jet-set-opts .setting-item:first-child")).toMatch(/border-top:\s*0/);
	});
});
