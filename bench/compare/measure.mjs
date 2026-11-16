// Measures one search tool in a running Obsidian (see launch.mjs), through its real window.
//   node measure.mjs <adapter> <vault> speed|quality|mem [--count N] [--gap MS]
// speed:   each typed query, one key every GAP ms; time from the last key to the last change of the result list (painted),
//          the longest main-thread freeze while typing, and the first search after launch, on its own.
// quality: each case typed the same way; the top results are read and compared with the right answer.
import { execFileSync } from "node:child_process";
import { pids } from "./launch.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { ADAPTERS } from "./adapters.mjs";
import { connect } from "./cdp.mjs";
import { REPO, WORK, sleep, typeChar } from "./lib.mjs";
import { QUALITY, autoQuality, speedQueries } from "./queries.mjs";

const [name, vault, mode, ...rest] = process.argv.slice(2);
const opt = (k, d) => (rest.includes(k) ? Number(rest[rest.indexOf(k) + 1]) : d);
const COUNT = opt("--count", 30);
const GAP = opt("--gap", 110);
const QUIET = opt("--quiet", 700);
const A = ADAPTERS[name];
if (!A || !["speed", "quality", "quality-auto", "mem"].includes(mode))
	throw new Error("usage: measure.mjs <adapter> <vault> speed|quality|quality-auto|mem");

const cdp = await connect();
const ev = (s) => cdp.evaluate(s);

const INSTALL = (root) => `
  if (window.__cmp?.mo) window.__cmp.mo.disconnect();
  const S = (window.__cmp = { muts: [], paints: [], keys: [], long: [] });
  const sel = ${JSON.stringify(root)};
  S.mo = new MutationObserver((ms) => {
    if (!ms.some((m) => (m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest?.(sel))) return;
    S.muts.push(performance.now());
    requestAnimationFrame(() => S.paints.push(performance.now()));
  });
  S.mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener("keydown", (e) => S.keys.push(e.timeStamp), true);
  if (!window.__cmpLong) { window.__cmpLong = true; new PerformanceObserver((l) => l.getEntries().forEach((e) => S.long.push([e.startTime, e.duration]))).observe({ type: "longtask" }); }
  return 1;`;

const open = async () => {
	await ev(`const f = app.vault.getMarkdownFiles()[0]; const l = app.workspace.getLeaf(false); await l.openFile(f); app.workspace.setActiveLeaf(l, { focus: true }); await new Promise((r) => setTimeout(r, 300));
	  app.commands.executeCommandById(${JSON.stringify(A.open)});
	  for (let i = 0; i < 100 && !document.querySelector(${JSON.stringify(A.input)}); i++) await new Promise((r) => setTimeout(r, 50));
	  const el = document.querySelector(${JSON.stringify(A.input)}); if (!el) throw new Error("no input for ${name}"); el.focus(); return 1;`);
	await sleep(400);
	await ev(INSTALL(A.root));
};
const clear = async () => {
	if (A.api) return;
	await ev(
		`const el = document.querySelector(${JSON.stringify(A.input)}); el.focus(); el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); return 1;`,
	);
	await sleep(QUIET + 300);
};
const settle = (t0) =>
	ev(`const S = window.__cmp; const start = performance.now();
	  await new Promise((res) => { const tick = () => { const last = S.paints.at(-1) ?? 0; const now = performance.now(); if (now - Math.max(last, ${t0}) > ${QUIET} || now - start > 9000) res(); else setTimeout(tick, 40); }; tick(); });
	  return { keys: S.keys.slice(), paints: S.paints.slice(), muts: S.muts.slice(), long: S.long.slice(), rows: ${A.rows}, capped: performance.now() - start > 8900 };`);

const reset = () =>
	ev(
		`const S = window.__cmp; S.muts.length = 0; S.paints.length = 0; S.keys.length = 0; S.long.length = 0; return 1;`,
	);

const typeQuery = async (q) => {
	await reset();
	for (const ch of q) {
		await typeChar(cdp, ch);
		await sleep(GAP);
	}
	const t0 = await ev(`return window.__cmp.keys.at(-1) ?? 0;`);
	const r = await settle(t0);
	const first = r.keys[0] ?? t0;
	const after = r.paints.filter((t) => t >= t0);
	const mafter = r.muts.filter((t) => t >= t0);
	const long = r.long.filter(([s]) => s >= first - 60);
	return {
		q,
		finalMs: after.length ? after.at(-1) - t0 : null,
		firstMs: after.length ? after[0] - t0 : null,
		engineMs: mafter.length ? mafter.at(-1) - t0 : null,
		freezeMs: long.length ? Math.max(...long.map(([, d]) => d)) : 0,
		freezes: long.length,
		top: r.rows.slice(0, 10),
		count: r.rows.length,
		capped: r.capped,
	};
};

const rssMB = () => {
	const ids = pids();
	const out = execFileSync("ps", ["-o", "rss=", "-p", ids.join(",")])
		.toString()
		.trim()
		.split("\n");
	return out.reduce((a, x) => a + Number(x), 0) / 1024;
};
const footprintMB = () => {
	if (process.platform !== "darwin") return null;
	const ids = pids();
	let total = 0;
	for (const pid of ids) {
		const cmd = execFileSync("ps", ["-o", "command=", "-p", pid]).toString();
		if (!cmd.includes("(Renderer)")) continue;
		const m = execFileSync("footprint", ["-p", pid])
			.toString()
			.match(/phys_footprint:\s+([\d.]+)\s+(KB|MB|GB)/);
		if (m) total += Number(m[1]) * { KB: 1 / 1024, MB: 1, GB: 1024 }[m[2]];
	}
	return total;
};
const pct = (xs, p) => {
	const s = xs.filter((x) => x != null).sort((a, b) => a - b);
	return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null;
};

const result = { adapter: name, label: A.label, vault, mode, gap: GAP, quiet: QUIET };
result.version = await ev(
	`return JSON.stringify({ obsidian: require("electron").ipcRenderer.sendSync("version"), plugins: Object.fromEntries(Object.entries(app.plugins.manifests).map(([k, m]) => [k, m.version])) })`,
);
result.notes = await ev(`return app.vault.getMarkdownFiles().length;`);

if (A.api && !mode.startsWith("quality")) throw new Error(`${name} is measured for quality only`);
if (mode === "speed") {
	const demo = join(REPO, "demo-vault");
	const queries = speedQueries(demo, COUNT + 3);
	await open();
	const rows = [];
	for (const q of queries) {
		rows.push(await typeQuery(q));
		await clear();
	}
	result.cold = rows[0];
	const warm = rows.slice(3);
	result.warm = warm;
	const f = warm.map((x) => x.finalMs);
	result.summary = {
		finalP50: pct(f, 50),
		finalP95: pct(f, 95),
		finalMax: pct(f, 100),
		firstP50: pct(
			warm.map((x) => x.firstMs),
			50,
		),
		freezeMax: Math.max(...warm.map((x) => x.freezeMs)),
		freezeP95: pct(
			warm.map((x) => x.freezeMs),
			95,
		),
		queriesWithFreeze: warm.filter((x) => x.freezes > 0).length,
		cappedQueries: warm.filter((x) => x.capped).length,
		unchanged: warm.filter((x) => x.finalMs == null).length,
	};
	result.rssMB = rssMB();
} else if (mode === "mem") {
	// A relaunch with the index already saved: open the tool, one search, collect garbage, read the memory of every Obsidian process.
	await open();
	await typeQuery("kitchen");
	await clear();
	await cdp.send("HeapProfiler.enable");
	await cdp.send("HeapProfiler.collectGarbage");
	await sleep(4000);
	await cdp.send("HeapProfiler.collectGarbage");
	await sleep(1000);
	result.rssMB = rssMB();
	result.mainHeapMB = (await cdp.send("Runtime.getHeapUsage")).usedSize / 1048576;
	// The renderer process holds the page and Jet's worker: its physical footprint (macOS) is steadier than RSS.
	result.footprintMB = footprintMB();
} else {
	if (!A.api) await open();
	const out = [];
	const walk = (d) =>
		readdirSync(d, { withFileTypes: true }).flatMap((e) =>
			e.name.startsWith(".")
				? []
				: e.isDirectory()
					? walk(join(d, e.name))
					: e.name.endsWith(".md")
						? [join(d, e.name)]
						: [],
		);
	const holding = (text) =>
		walk(join(WORK, "vaults", vault))
			.filter((p) => readFileSync(p, "utf8").toLowerCase().includes(text.toLowerCase()))
			.map((p) => p.slice(join(WORK, "vaults", vault).length + 1));
	const auto = mode === "quality-auto";
	const cases = auto
		? autoQuality(join(WORK, "vaults", vault)).filter((c) => A.kind !== "names" || c.group.startsWith("title"))
		: QUALITY;
	for (const c of cases) {
		const r = A.api ? { top: await ev(A.api(c.q)), count: 10 } : await typeQuery(c.q);
		c.want =
			c.want ??
			(c.wantPrefix
				? walk(join(WORK, "vaults", vault))
						.map((p) => p.slice(join(WORK, "vaults", vault).length + 1))
						.filter((p) => p.startsWith(c.wantPrefix))
				: holding(c.wantText));
		const want = c.want.map((w) => w.normalize("NFC"));
		const rank = r.top.findIndex((k0) => {
			const k = k0.normalize("NFC");
			return want.some((w) => w === k || w.endsWith("/" + k) || k.endsWith("/" + w));
		});
		out.push({
			id: c.id,
			group: c.group,
			q: c.q,
			rank: rank < 0 ? null : rank + 1,
			pass: rank >= 0 && rank < 3,
			top: r.top,
			count: r.count,
		});
		await clear();
	}
	result.quality = out;
}
mkdirSync(join(WORK, "out"), { recursive: true });
const file = join(WORK, "out", `${name}-${vault}-${mode}.json`);
writeFileSync(file, JSON.stringify(result, null, 1));
console.log(file);
console.log(JSON.stringify(result.summary ?? result.quality?.map((x) => `${x.id}:${x.rank ?? "-"}`)));
cdp.close();
