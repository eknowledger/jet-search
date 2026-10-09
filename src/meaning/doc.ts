/**
 * The text a note's vector is made from: its title, aliases, summary
 * property, headings, then the first 2,000 characters of its body as plain text. A static model
 * averages its pieces, so more text would only blur it.
 */
import type { RawNote } from "../engine/fields";

const BODY = 2000;

const plain = (md: string): string =>
	md
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/<[^>]+>/g, " ")
		.replace(/[#*_`>|~=-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();

export const docText = (n: RawNote): string => {
	const title = (n.path.split("/").pop() ?? n.path).replace(/\.md$/i, "");
	const front = n.text.slice(0, n.bodyStart);
	const summary = /^summary:\s*"?(.*?)"?\s*$/m.exec(front)?.[1] ?? "";
	const headings = n.headings.map((h) => h.text).join(". ");
	return [title, n.aliases.join(", "), summary, headings, plain(n.text.slice(n.bodyStart)).slice(0, BODY)]
		.filter(Boolean)
		.join("\n");
};
