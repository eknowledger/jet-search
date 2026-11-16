// Runs the comparison: for each tool and vault, a fresh Obsidian with only that tool, readiness, then the measurements.
//   node run.mjs --tools jet,omnisearch --vaults n239,n1000 --modes speed,quality [--count 30]
// Vaults: n239 is the demo vault as it is; nN is a vault of N notes made from it (gen-vault.mjs).
// Tools: core (Obsidian Search), core-switcher, qs-plus, aqs, omnisearch, jet, jet-meaning, smart-connections (quality only).
// jet-meaning needs the packed model: set JET_MEANING_BIN to a meaning-potion-base-8M.bin, or let Jet download it.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_FOR } from "./adapters.mjs";
import { HERE, REPO, WORK, sleep } from "./lib.mjs";
import { start, stop } from "./launch.mjs";

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const tools = arg("--tools", "core,core-switcher,qs-plus,aqs,omnisearch,jet").split(",");
const vaults = arg("--vaults", "n239").split(",");
const modes = arg("--modes", "speed").split(",");
const extra = ["--count", "--gap", "--quiet"].flatMap((k) => (process.argv.includes(k) ? [k, arg(k)] : []));
const node = (script, args) =>
	spawnSync(process.execPath, [join(HERE, script), ...args], {
		cwd: HERE,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
	});
const stamp = Date.now().toString(36);

const ensureVault = (name) => {
	const dir = join(WORK, "vaults", name);
	if (existsSync(dir)) return;
	const demo = join(REPO, "demo-vault");
	if (name === "n239") cpSync(demo, dir, { recursive: true, filter: (p) => !p.includes(".obsidian") });
	else node("gen-vault.mjs", [demo, name.slice(1), dir]);
};

for (const vault of vaults) {
	ensureVault(vault);
	for (const tool of tools) {
		const plug = PLUGIN_FOR[tool];
		console.log(`\n== ${tool} on ${vault} ${new Date().toTimeString().slice(0, 8)}`);
		await stop();
		node("prep.mjs", [vault, plug]);
		if (tool === "jet-meaning" && process.env.JET_MEANING_BIN) {
			cpSync(
				process.env.JET_MEANING_BIN,
				join(WORK, "vaults", vault, ".obsidian/plugins/jet-search/meaning-potion-base-8M.bin"),
			);
		}
		const id = `cmp0${tool}0${vault}0${stamp}`;
		await start(vault, id);
		node("trust.mjs", []);
		const ready = JSON.parse(node("ready.mjs", [tool, "1800"]).stdout.trim().split("\n").pop());
		console.log("ready", JSON.stringify(ready));
		mkdirSync(join(WORK, "out"), { recursive: true });
		writeFileSync(join(WORK, "out", `${tool}-${vault}-ready.json`), JSON.stringify(ready));
		await sleep(2000);
		if (modes.includes("mem")) {
			// Second launch on the same vault id: the index saved by the first launch is loaded, not rebuilt.
			await stop();
			await start(vault, id);
			node("trust.mjs", []);
			await sleep(12000);
		}
		for (const mode of modes) {
			const r = node("measure.mjs", [tool, vault, mode, ...extra]);
			console.log(r.stdout.trim().split("\n").slice(-1)[0]);
			if (r.status !== 0) console.log(`FAILED ${tool} ${vault} ${mode}`);
		}
	}
}
await stop();
