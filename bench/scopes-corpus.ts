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

type Truth = {
	scopes: Array<{
		name: string;
		default?: string;
		signal?: string;
		members?: number;
		rules?: Array<{ key?: string }>;
	}>;
};

/** Signals the generator does not have yet: a miss from these alone is expected. */
const LATER = new Set([
	"hub-note",
	"index-note",
	"bookmark-group",
	"graph-group",
	"graph-color-group",
	"import",
	"import-root",
	"notion-export",
	"readwise-layout",
	"inline-fields",
	"filename-prefix",
	"lifecycle-container",
]);

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
	// Why each miss: a later signal; a kind (Jet lists its key as kinds of notes, the truth as topics);
	// a level (listed, unticked as a level above or below); else a real miss.
	const kindKeys = new Set(
		got.notProposed
			.filter((x) => x.why.startsWith("kinds of notes") || x.why.startsWith("two values"))
			.map((x) => fold(x.what.replace(/^values of /, ""))),
	);
	const why = (s: Truth["scopes"][number]): string => {
		if ((s.signal ?? "").split("+").every((x) => LATER.has(x))) return "later";
		// Inline fields (`effort:: [[X]]`) are a later signal too.
		if ((s.rules ?? []).some((r) => r.key?.endsWith("::"))) return "later";
		if ((s.rules ?? []).some((r) => r.key && kindKeys.has(fold(r.key)))) return "kind";
		const near = got.proposals.find((p) => fold(p.name) === fold(s.name));
		if (near?.untick.some((u) => u.startsWith("a level"))) return "level";
		return "miss";
	};
	const causes = new Map<string, number>();
	for (const s of missed) causes.set(why(s), (causes.get(why(s)) ?? 0) + 1);
	const real = causes.get("miss") ?? 0;
	const p1 = want.size - (causes.get("later") ?? 0) - (causes.get("kind") ?? 0);
	const p1Recall = p1 ? (p1 - real - (causes.get("level") ?? 0)) / p1 : 1;
	const precision = ticked.length ? hit.length / ticked.length : want.size ? 0 : 1;
	rows.push(
		`${v.padEnd(14)} notes ${String(snap.notes.length).padStart(6)}  expected ${String(want.size).padStart(3)}  ticked ${String(ticked.length).padStart(3)}  recall ${recall.toFixed(2)}  precision ${precision.toFixed(2)}  P1 recall ${p1Recall.toFixed(2)}  read ${(t1 - t0).toFixed(0)} ms  generate ${(t2 - t1).toFixed(0)} ms`,
	);
	const list = (xs: string[]): string =>
		`${xs.slice(0, 14).join(", ")}${xs.length > 14 ? ` … ${xs.length - 14} more` : ""}`;
	if (missed.length)
		rows.push(
			`   missed: ${[...causes].map(([k, n]) => `${n} ${k}`).join(", ")}: ${list(missed.map((s) => `${s.name} (${why(s)}: ${s.signal ?? ""})`))}`,
		);
	if (extra.length)
		rows.push(`   extra:  ${list(extra.map((p) => `${p.name} (${p.origins[0]?.signal}: ${p.group})`))}`);
}
console.log(rows.join("\n"));
