/**
 * The scope generator on a corpus of vaults: for each vault with ground truth, the
 * generator's ticked proposals against `_truth/<vault>/expected-scopes.json` (its ticked scopes), and
 * how long reading and generating took.
 *   node <bundle> <corpus dir> [vault …]
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generate } from "../src/scopes/generate";
import { fold } from "../src/scopes/names";
import { readSnapshot } from "./vault-snapshot";

type Truth = { scopes: Array<{ name: string; default?: string; signal?: string; members?: number }> };

const [corpus = "corpus", ...only] = process.argv.slice(2);
const vaults = readdirSync(corpus).filter(
	(v) =>
		!v.startsWith("_") &&
		existsSync(join(corpus, "_truth", v, "expected-scopes.json")) &&
		(!only.length || only.includes(v)),
);
const rows: string[] = [];
for (const v of vaults.sort()) {
	const truth = JSON.parse(readFileSync(join(corpus, "_truth", v, "expected-scopes.json"), "utf8")) as Truth;
	const t0 = performance.now();
	const snap = readSnapshot(join(corpus, v));
	const t1 = performance.now();
	const got = generate(snap);
	const t2 = performance.now();
	const want = new Map(
		truth.scopes.filter((s) => (s.default ?? "ticked") === "ticked").map((s) => [fold(s.name), s]),
	);
	const ticked = got.proposals.filter((p) => p.ticked);
	const have = new Map(ticked.map((p) => [fold(p.name), p]));
	const hit = [...want.keys()].filter((k) => have.has(k));
	const missed = [...want.values()].filter((s) => !have.has(fold(s.name)));
	const extra = ticked.filter((p) => !want.has(fold(p.name)));
	const recall = want.size ? hit.length / want.size : 1;
	const precision = ticked.length ? hit.length / ticked.length : want.size ? 0 : 1;
	rows.push(
		`${v.padEnd(14)} notes ${String(snap.notes.length).padStart(6)}  expected ${String(want.size).padStart(3)}  ticked ${String(ticked.length).padStart(3)}  recall ${recall.toFixed(2)}  precision ${precision.toFixed(2)}  read ${(t1 - t0).toFixed(0)} ms  generate ${(t2 - t1).toFixed(0)} ms`,
	);
	const list = (xs: string[]): string =>
		`${xs.slice(0, 14).join(", ")}${xs.length > 14 ? ` … ${xs.length - 14} more` : ""}`;
	if (missed.length)
		rows.push(`   missed: ${list(missed.map((s) => `${s.name}${s.signal ? ` (${s.signal})` : ""}`))}`);
	if (extra.length)
		rows.push(`   extra:  ${list(extra.map((p) => `${p.name} (${p.origins[0]?.signal}: ${p.group})`))}`);
}
console.log(rows.join("\n"));
