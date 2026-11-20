import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error The script is plain JavaScript, run by the release workflow too.
import { allVersions, parseChangelog, releaseNotes } from "../scripts/release-notes.mjs";

const changelog = readFileSync("CHANGELOG.md", "utf8");
const manifest = JSON.parse(readFileSync("manifest.json", "utf8")) as { version: string };
const versionsJson = JSON.parse(readFileSync("versions.json", "utf8")) as Record<string, string>;

const SAMPLE = `# Changelog

## 2.0.0 - 2030-01-02

### Added
- **Reset button**: puts the inputs back where they started.
  Detail that belongs in the changelog only.
- **Share a link**: copies the address with the inputs in it.

### Fixed
- **Readable labels**: labels are the same size on a phone.

## 1.0.0 - 2029-12-31

### Added
- **First thing**: it exists.
`;

describe("the notes of a GitHub release", () => {
	it("groups entries as New, Changed and Fixed with a count, one line each, and leaves the detail out", () => {
		expect(releaseNotes("2.0.0", parseChangelog(SAMPLE))).toBe(
			[
				"### New (2)",
				"",
				"- **Reset button**: puts the inputs back where they started.",
				"- **Share a link**: copies the address with the inputs in it.",
				"",
				"### Fixed (1)",
				"",
				"- **Readable labels**: labels are the same size on a phone.",
				"",
				"Full changelog: [CHANGELOG.md](https://github.com/eknowledger/jet-search/blob/main/CHANGELOG.md#200---2030-01-02)",
				"",
			].join("\n"),
		);
	});

	it("reads versions newest first, as the changelog lists them", () => {
		expect(parseChangelog(SAMPLE).map((v: { version: string }) => v.version)).toEqual(["2.0.0", "1.0.0"]);
	});

	it("refuses a version the changelog does not have", () => {
		expect(() => releaseNotes("9.9.9", parseChangelog(SAMPLE))).toThrow(/no section for 9\.9\.9/);
	});

	it("writes the real notes of 0.4.0 as worked out by hand from the changelog", () => {
		expect(releaseNotes("0.4.0")).toBe(
			[
				"### New (2)",
				"",
				"- **Action panel**: Cmd/Ctrl + K opens a panel of actions for the selected note.",
				"- **Obsidian search hand-off**: Jet offers Obsidian's own search when a search uses its operators.",
				"",
				"### Changed (1)",
				"",
				"- **Gentler first build**: the first index build is gathered in slices of 8 ms, so Obsidian stays smooth while it runs.",
				"",
				"Full changelog: [CHANGELOG.md](https://github.com/eknowledger/jet-search/blob/main/CHANGELOG.md#040---2026-10-09)",
				"",
			].join("\n"),
		);
	});
});

describe("CHANGELOG.md", () => {
	const versions = parseChangelog(changelog) as {
		version: string;
		groups: Record<string, { name: string; sentence: string }[]>;
	}[];

	it("has a section for the version in manifest.json, and for every version in versions.json", () => {
		const have = allVersions() as string[];
		expect(have).toContain(manifest.version);
		for (const v of Object.keys(versionsJson)) expect(have, v).toContain(v);
	});

	it("lists versions newest first", () => {
		const parts = (v: string) => v.split(".").map(Number) as [number, number, number];
		const sorted = [...versions].sort((a, b) => {
			const [x, y] = [parts(a.version), parts(b.version)];
			return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
		});
		expect(versions.map((v) => v.version)).toEqual(sorted.map((v) => v.version));
	});

	it("gives every bullet a bold name, a colon and one sentence under 120 characters", () => {
		const bullets = changelog.split("\n").filter((l) => l.startsWith("- "));
		expect(bullets.length).toBeGreaterThan(20);
		for (const line of bullets) {
			const m = /^- \*\*(.+?)\*\*: (.+)$/.exec(line);
			expect(m, `bold name and colon: ${line}`).not.toBeNull();
			const sentence = m?.[2] ?? "";
			expect(sentence.length, `under 120 characters: ${line}`).toBeLessThan(120);
			expect(sentence.endsWith("."), `ends with a full stop: ${line}`).toBe(true);
			expect(sentence.slice(0, -1).includes(". "), `one sentence: ${line}`).toBe(false);
		}
	});

	it("uses no dash as punctuation", () => {
		expect(changelog).not.toMatch(/—| – /);
	});

	it("puts every entry under Added, Changed or Fixed", () => {
		for (const v of versions) {
			for (const heading of Object.keys(v.groups))
				expect(["Added", "Changed", "Fixed"], v.version).toContain(heading);
		}
	});
});
