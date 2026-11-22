/**
 * The link that opens a new bug report on GitHub with the form already filled in. Jet opens it in the
 * browser and does nothing else: the person reads the page and presses Submit. A link can only be so
 * long (GitHub refuses about 7,000 characters), so the report goes into it only when it fits.
 */

import { num } from "./format";
import type { Snapshot } from "./report";

export const REPO_URL = "https://github.com/eknowledger/jet-search";

/** The longest link Jet makes. GitHub answers 302 up to 6,500 characters and an error from 7,000. */
export const URL_BUDGET = 6000;

export type IssueFields = {
	versions: string;
	size: string;
	/** The person's own sentence. */
	what: string;
	/** The report. */
	support: string;
};

export type IssueLink = {
	url: string;
	/** What went into the link (the rest is left for the clipboard). */
	filled: { what: boolean; support: boolean };
};

/** The form's short fields, from what the report already says. */
export const issueFacts = (s: Snapshot): Pick<IssueFields, "versions" | "size"> => ({
	versions: `Jet ${s.jet.version}, Obsidian ${s.obsidian.version}, ${s.obsidian.platform}`,
	size: `${num(s.vault.notes)} notes`,
});

const build = (fields: Array<[string, string]>): string => {
	const q = new URLSearchParams([["template", "bug_report.yml"], ...fields]);
	return `${REPO_URL}/issues/new?${q.toString()}`;
};

export const issueLink = (f: IssueFields, budget = URL_BUDGET): IssueLink => {
	const fields: Array<[string, string]> = [
		["versions", f.versions],
		["size", f.size],
	];
	const filled = { what: false, support: false };
	// In turn, the sentence and then the report: each goes in only if the link stays short enough.
	const what = f.what.trim();
	if (what && build([...fields, ["what", what]]).length <= budget) {
		fields.push(["what", what]);
		filled.what = true;
	}
	if (f.support.trim() && build([...fields, ["support", f.support]]).length <= budget) {
		fields.push(["support", f.support]);
		filled.support = true;
	}
	return { url: build(fields), filled };
};
