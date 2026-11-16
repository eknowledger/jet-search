// Gives a vault in .work/vaults exactly one search tool: a clean .obsidian with that tool's files and nothing else.
// usage: node prep.mjs <vault> <tool>      tool = core | jet | omnisearch | qs-plus | aqs | smart-connections
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, WORK } from "./lib.mjs";

const [vault, tool] = process.argv.slice(2);
export const TOOLS = {
	core: null,
	jet: { id: "jet-search", from: process.env.JET_REPO ?? REPO },
	omnisearch: { id: "omnisearch", from: join(WORK, "plugins/omnisearch") },
	"qs-plus": { id: "darlal-switcher-plus", from: join(WORK, "plugins/darlal-switcher-plus") },
	aqs: { id: "obsidian-another-quick-switcher", from: join(WORK, "plugins/obsidian-another-quick-switcher") },
	"smart-connections": { id: "smart-connections", from: join(WORK, "plugins/smart-connections") },
};
if (!(tool in TOOLS)) throw new Error(`unknown tool ${tool}`);
const src = TOOLS[tool];
if (src && !existsSync(join(src.from, "main.js")))
	throw new Error(
		`${src.id} has no main.js in ${src.from}: run "npm run build" for Jet, or "node bench/compare/fetch.mjs" for the others`,
	);
const dir = join(WORK, "vaults", vault, ".obsidian");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "app.json"), "{}");
writeFileSync(join(dir, "appearance.json"), "{}");
writeFileSync(
	join(dir, "core-plugins.json"),
	JSON.stringify(["file-explorer", "global-search", "switcher", "command-palette"]),
);
const t = TOOLS[tool];
writeFileSync(join(dir, "community-plugins.json"), JSON.stringify(t ? [t.id] : []));
if (t) {
	const to = join(dir, "plugins", t.id);
	mkdirSync(to, { recursive: true });
	for (const f of ["main.js", "manifest.json", "styles.css"])
		if (existsSync(join(t.from, f))) cpSync(join(t.from, f), join(to, f));
}
console.log(`${vault}: ${tool}`);
