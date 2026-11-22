/**
 * The notes of a GitHub release, built from CHANGELOG.md: one line per entry, grouped as New, Changed and
 * Fixed, then a link to the full changelog.
 *
 * The changelog is where the detail lives. A person scanning a release for what shipped wants only the
 * first line of each entry, so that is all these notes carry: `- **Name**: one sentence.` The lines below an
 * entry in the changelog are detail and are left out.
 *
 *   node scripts/release-notes.mjs 0.7.0               print one version's notes
 *   node scripts/release-notes.mjs --all               print every version's, newest first
 *   node scripts/release-notes.mjs 0.7.0 --apply       write that version's GitHub release (gh)
 *   node scripts/release-notes.mjs --all --apply       write every version's, once
 *
 * --apply needs the gh CLI signed in with write access to the repository, and a tag for the version. It
 * edits the release when there is one, and otherwise creates it without files, marked as not the latest.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "../..");
const BLOB = "https://github.com/eknowledger/jet-search/blob/main";

/** The changelog's headings, and what the release notes call them. */
export const GROUPS = [
	{ heading: "Added", title: "New" },
	{ heading: "Changed", title: "Changed" },
	{ heading: "Fixed", title: "Fixed" },
];

/** GitHub's anchor for a "## 0.7.0 - 2026-11-19" heading. */
const headingAnchor = (version, date) => `${version.replace(/\./g, "")}---${date}`;

/** Every version in the changelog text, newest first, with its date and its entries by heading. */
export function parseChangelog(text) {
	const versions = [];
	let version = null;
	let group = null;
	for (const line of text.split("\n")) {
		const v = /^## (\d+\.\d+\.\d+) - (\d{4}-\d{2}-\d{2})$/.exec(line);
		if (v) {
			version = { version: v[1], date: v[2], groups: {} };
			versions.push(version);
			group = null;
			continue;
		}
		const g = /^### (\w+)$/.exec(line);
		if (g && version) {
			group = g[1];
			version.groups[group] = [];
			continue;
		}
		const entry = /^- \*\*(.+?)\*\*: (.+)$/.exec(line);
		if (entry && version && group) version.groups[group].push({ name: entry[1], sentence: entry[2] });
	}
	return versions;
}

const readChangelog = () => parseChangelog(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8"));

/** One version's notes, as markdown. Throws for a version the changelog does not have. */
export function releaseNotes(version, versions = readChangelog()) {
	const found = versions.find((v) => v.version === version);
	if (!found) throw new Error(`CHANGELOG.md has no section for ${version}`);
	const out = [];
	for (const g of GROUPS) {
		const entries = found.groups[g.heading] ?? [];
		if (!entries.length) continue;
		out.push(`### ${g.title} (${entries.length})`, "");
		for (const e of entries) out.push(`- **${e.name}**: ${e.sentence}`);
		out.push("");
	}
	out.push(`Full changelog: [CHANGELOG.md](${BLOB}/CHANGELOG.md#${headingAnchor(version, found.date)})`, "");
	return out.join("\n");
}

/** Every version the changelog has, newest first. */
export const allVersions = () => readChangelog().map((v) => v.version);

function apply(version, notes) {
	const dir = mkdtempSync(join(tmpdir(), "release-notes-"));
	const file = join(dir, "notes.md");
	writeFileSync(file, notes);
	try {
		let exists = true;
		try {
			execFileSync("gh", ["release", "view", version, "--json", "tagName"], { stdio: "ignore" });
		} catch {
			exists = false;
		}
		if (exists) execFileSync("gh", ["release", "edit", version, "--notes-file", file], { stdio: "inherit" });
		else
			execFileSync(
				"gh",
				[
					"release",
					"create",
					version,
					"--verify-tag",
					"--title",
					version,
					"--notes-file",
					file,
					"--latest=false",
				],
				{ stdio: "inherit" },
			);
		console.log(`${version}: notes ${exists ? "rewritten" : "published"}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const versions = args.includes("--all") ? allVersions() : args.filter((a) => !a.startsWith("--"));
	if (!versions.length) {
		console.error("Usage: node scripts/release-notes.mjs <version>... | --all  [--apply]");
		process.exit(2);
	}
	for (const v of versions) {
		const notes = releaseNotes(v);
		if (args.includes("--apply")) apply(v, notes);
		else console.log(`${versions.length > 1 ? `===== ${v}\n\n` : ""}${notes}`);
	}
}
