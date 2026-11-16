// Builds the quality table from the results of "measure.mjs <tool> n239 quality".  usage: node report.mjs
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORK } from "./lib.mjs";
const j = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null);
const order = ["jet-meaning", "jet", "omnisearch", "smart-connections", "core", "core-switcher", "qs-plus", "aqs"];
const names = {
	"jet-meaning": "Jet, meaning on",
	jet: "Jet",
	omnisearch: "Omnisearch",
	"smart-connections": "Smart Connections",
	core: "Obsidian Search",
	"core-switcher": "Obsidian Quick Switcher",
	"qs-plus": "Quick Switcher++",
	aqs: "Another Quick Switcher",
};
const nameOnly = new Set(["core-switcher", "qs-plus", "aqs"]);
const q = Object.fromEntries(order.map((t) => [t, j(join(WORK, `out/${t}-n239-quality.json`))?.quality]));
const cases = q.jet;
let md = "| Case | " + order.map((t) => names[t]).join(" | ") + " |\n|---|" + order.map(() => "---").join("|") + "|\n";
const tot = Object.fromEntries(order.map((t) => [t, 0]));
for (const [i, c] of cases.entries()) {
	md +=
		`| ${c.q} | ` +
		order
			.map((t) => {
				if (nameOnly.has(t) && c.group !== "names") return "n/a";
				const r = q[t]?.[i];
				if (!r) return "?";
				if (r.pass) tot[t]++;
				return r.pass ? `✓ ${r.rank}` : r.rank ? `${r.rank}` : "✗";
			})
			.join(" | ") +
		" |\n";
}
md +=
	"| **Found in the top 3** | " +
	order
		.map((t) => `${tot[t]} of ${nameOnly.has(t) ? cases.filter((c) => c.group === "names").length : cases.length}`)
		.join(" | ") +
	" |\n";
mkdirSync(join(WORK, "out"), { recursive: true });
writeFileSync(join(WORK, "out/quality.md"), md);
console.log(md);
