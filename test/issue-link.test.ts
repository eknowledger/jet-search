import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { issueLink, REPO_URL, URL_BUDGET } from "../src/diag/issue";

const base = { versions: "Jet 0.7.1, Obsidian 1.15.1, macOS desktop", size: "239 notes" };
const params = (url: string): URLSearchParams => new URL(url).searchParams;

describe("the link that opens a bug report with the support info filled in", () => {
	it("opens the bug report form of the repository, with the versions, the size, the sentence and the report", () => {
		const { url, filled } = issueLink({
			...base,
			what: "Double Shift does nothing",
			support: "Jet Search: 0.7.1\nIndex: ok",
		});
		expect(url.startsWith(`${REPO_URL}/issues/new?`)).toBe(true);
		const p = params(url);
		expect(p.get("template")).toBe("bug_report.yml");
		expect(p.get("versions")).toBe(base.versions);
		expect(p.get("size")).toBe("239 notes");
		expect(p.get("what")).toBe("Double Shift does nothing");
		expect(p.get("support")).toBe("Jet Search: 0.7.1\nIndex: ok");
		expect(filled).toEqual({ what: true, support: true });
	});

	it("never asks for more than the form has: only those five fields", () => {
		const keys = [...params(issueLink({ ...base, what: "x", support: "y" }).url).keys()].sort();
		expect(keys).toEqual(["size", "support", "template", "versions", "what"]);
	});

	it("leaves a field out when it is empty", () => {
		const p = params(issueLink({ ...base, what: "  ", support: "report" }).url);
		expect(p.has("what")).toBe(false);
		expect(p.get("support")).toBe("report");
	});

	it("keeps the report out of the link when it would make the link too long, and says so", () => {
		const big = "Index: 239 of 239 notes indexed, saved 2 min ago\n".repeat(200);
		const { url, filled } = issueLink({ ...base, what: "It is slow", support: big });
		expect(url.length).toBeLessThanOrEqual(URL_BUDGET);
		expect(params(url).has("support")).toBe(false);
		expect(params(url).get("what")).toBe("It is slow");
		expect(filled).toEqual({ what: true, support: false });
	});

	it("keeps the sentence out too when even that is too long", () => {
		const { url, filled } = issueLink({ ...base, what: "word ".repeat(2000), support: "report" });
		expect(url.length).toBeLessThanOrEqual(URL_BUDGET);
		expect(params(url).has("what")).toBe(false);
		expect(filled.what).toBe(false);
	});

	it("never goes over the budget, whatever the text", () => {
		for (const n of [10, 500, 1500, 2500, 6000]) {
			const text = "é & = ? # % +\n".repeat(n);
			const { url } = issueLink({ ...base, what: text.slice(0, n), support: text });
			expect(url.length).toBeLessThanOrEqual(URL_BUDGET);
		}
	});

	it("fits a report of about three thousand characters, the usual size without a trace", () => {
		const report = Array.from({ length: 48 }, (_, i) => `Label${i}:      ${"x".repeat(50)}`).join("\n");
		expect(issueLink({ ...base, what: "", support: report }).filled.support).toBe(true);
	});
});

describe("the form the link fills in", () => {
	const form = readFileSync(".github/ISSUE_TEMPLATE/bug_report.yml", "utf8");
	const ids = [...form.matchAll(/^\s+id: (\w+)$/gm)].map((m) => m[1]);

	it("has a field for each one the link fills, so none is ignored", () => {
		const keys = [...params(issueLink({ ...base, what: "x", support: "y" }).url).keys()].filter(
			(k) => k !== "template",
		);
		for (const k of keys) expect(ids, k).toContain(k);
	});

	it("sets the issue type to Bug, not only the label", () => {
		expect(form).toMatch(/^type: Bug$/m);
		expect(readFileSync(".github/ISSUE_TEMPLATE/feature_request.yml", "utf8")).toMatch(/^type: Feature$/m);
	});

	it("asks for nothing but the sentence as required, so a report from the button can be submitted", () => {
		const required = [...form.matchAll(/id: (\w+)[\s\S]*?(?=\n  - type|$)/g)]
			.filter((m) => /required: true/.test(m[0]))
			.map((m) => m[1]);
		expect(required).toEqual(["what"]);
	});
});
