// Downloads the release files of the other plugins, at the versions in tools.json, into .work/plugins.
//   node fetch.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { HERE, WORK } from "./lib.mjs";

const tools = JSON.parse(readFileSync(join(HERE, "tools.json"), "utf8"));
for (const [key, t] of Object.entries(tools)) {
	const dir = join(WORK, "plugins", t.id);
	mkdirSync(dir, { recursive: true });
	for (const file of ["main.js", "manifest.json", "styles.css"]) {
		const res = await fetch(`https://github.com/${t.repo}/releases/download/${t.version}/${file}`);
		if (res.ok) writeFileSync(join(dir, file), Buffer.from(await res.arrayBuffer()));
		else if (file !== "styles.css") throw new Error(`${key}: ${file} ${res.status}`);
	}
	console.log(`${key} ${t.version}`);
}
