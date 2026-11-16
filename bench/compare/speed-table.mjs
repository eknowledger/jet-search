// Builds the speed tables from the results in .work/out, or the average of several runs (copy .work/out to .work/out-run1 and so on).
//   node speed-table.mjs [n10000,n1000] [out,out-run2 ...]
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORK } from "./lib.mjs";
const j = (f) => (existsSync(join(WORK, f)) ? JSON.parse(readFileSync(join(WORK, f), "utf8")) : null);
const vaultList = (process.argv[2] ?? "n10000,n1000").split(",");
const dirList = process.argv.slice(3).length ? process.argv.slice(3) : ["out"];
const order = [
	["jet", "Jet"],
	["aqs", "Another Quick Switcher"],
	["core-switcher", "Obsidian Quick Switcher"],
	["qs-plus", "Quick Switcher++"],
	["core", "Obsidian Search"],
	["omnisearch", "Omnisearch"],
];
const fmt = (ms) =>
	ms >= 1000
		? `${(ms / 1000).toFixed(1)} s`
		: ms >= 100
			? `${Math.round(ms)} ms`
			: `${ms.toFixed(ms < 10 ? 1 : 0)} ms`;
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
let md = "";
for (const [vault, dirs] of vaultList.map((v) => [v, dirList])) {
	md += `\n### ${vault}\n\n| Tool | First results | Settled, median | Settled, 95th percentile | Settled, slowest | Index build | First search after launch |\n|---|---:|---:|---:|---:|---:|---:|\n`;
	for (const [t, label] of order) {
		const rs = dirs.map((d) => j(`${d}/${t}-${vault}-speed.json`)).filter(Boolean);
		const rd = dirs.map((d) => j(`${d}/${t}-${vault}-ready.json`)).filter(Boolean);
		if (!rs.length) continue;
		const s = (k) => avg(rs.map((r) => r.summary[k]));
		const build = rd[0]?.buildMs ? fmt(avg(rd.map((r) => r.buildMs))) : "no index";
		md += `| ${label} | ${fmt(s("firstP50"))} | ${fmt(s("finalP50"))} | ${fmt(s("finalP95"))} | ${fmt(Math.max(...rs.map((r) => r.summary.finalMax)))} | ${build} | ${fmt(avg(rs.map((r) => r.cold.finalMs)))} |\n`;
	}
}
mkdirSync(join(WORK, "out"), { recursive: true });
writeFileSync(join(WORK, "out/speed.md"), md);
console.log(md);
