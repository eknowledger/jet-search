// Waits until the tool's index is complete and prints how long that took from the moment the plugin was enabled (ms).
//   node ready.mjs <adapter> [timeoutSeconds]
import { connect } from "./cdp.mjs";
const [name, to = "1500"] = process.argv.slice(2);
const SCRIPTS = {
	jet: `const p = app.plugins.plugins["jet-search"]; await p.feeder.ensure();
	  for (let i = 0; i < ${Number(to) * 20} && (p.feeder.progress || p.data.indexedAt === null); i++) await new Promise((r) => setTimeout(r, 50));
	  return p.feeder.progress || p.data.indexedAt === null ? null : performance.now() - (window.__enableAt ?? performance.now());`,
	"jet-meaning": `const p = app.plugins.plugins["jet-search"]; await p.feeder.ensure();
	  for (let i = 0; i < 1200 && (p.feeder.progress || p.data.indexedAt === null); i++) await new Promise((r) => setTimeout(r, 50));
	  if (!p.meaning.available()) await p.meaning.install();
	  for (let i = 0; i < 1800 && (p.feeder.meaningProgress || !p.meaning.available()); i++) await new Promise((r) => setTimeout(r, 100));
	  Object.assign(p.data.settings, { preview: true, excerpts: true, answers: true, questionShows: "both", bothLayout: "groups", meaning: true, meaningLong: false });
	  await p.save(); await new Promise((r) => setTimeout(r, 500));
	  return p.meaning.available() ? performance.now() - (window.__enableAt ?? 0) : null;`,
	"smart-connections": `const e = app.plugins.plugins["smart-connections"].env; const t0 = performance.now();
	  for (let i = 0; i < ${Number(to) * 5}; i++) { const it = Object.values(e.smart_sources?.items ?? {}); if (it.length > 0 && it.filter((s) => s.vec).length >= it.length - 2) { await new Promise((r) => setTimeout(r, 2000)); return performance.now(); } await new Promise((r) => setTimeout(r, 200)); }
	  return null;`,
	omnisearch: `const o = app.plugins.plugins.omnisearch; const total = app.vault.getMarkdownFiles().length; let stable = 0, prev = -1;
	  for (let i = 0; i < ${Number(to) * 10}; i++) {
	    const n = o.searchEngine.minisearch.documentCount;
	    if (n >= total && n === prev) { if (++stable >= 10) return performance.now() - (window.__enableAt ?? 0) - 1000; } else stable = 0;
	    prev = n; await new Promise((r) => setTimeout(r, 100));
	  }
	  return null;`,
};
const c = await connect();
const ms = SCRIPTS[name] ? await c.evaluate(SCRIPTS[name]) : 0;
console.log(JSON.stringify({ adapter: name, buildMs: ms }));
c.close();
