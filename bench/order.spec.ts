/**
 * Words typed in order: does lifting notes that hold the typed words side by side, in that order, find
 * the right note sooner? Jet's engine on the demo vault, with and without `boostSequences`' scoring.
 *   npm run bench:order -- demo-vault
 *
 * Four parts:
 *   A. The generated searches of the in-Obsidian comparison (20 seeds x 25 per group), with the phrase
 *      group typed WITHOUT quotes. Only the phrase group should move; the others are the check for harm.
 *   B. Two and three words that sit side by side in a note, where at least four notes hold all the words
 *      and some hold them in order. The right notes are those that hold them in order.
 *   C. The same pairs typed in the opposite order: the top result should hardly ever change.
 *   D. What the check costs on the first 20 hits, with the texts already in memory.
 */
import { performance } from "node:perf_hooks";
import { fieldsFromMarkdown, type NoteInput } from "../src/engine/fields";
import { JetEngine, type Hit } from "../src/engine/jet-engine";
import { parseQuery } from "../src/engine/query";
import { hasPhrase } from "../src/excerpt/excerpt";
import { SEQUENCE_CHECK_LIMIT, applySequenceBoost } from "../src/rank";
import { autoQuality } from "./compare/queries.mjs";
import type { BenchNote } from "./engine";
import { readNotes } from "./notes.spec";

const [dir] = process.argv.slice(2);
if (!dir) throw new Error("usage: npm run bench:order -- <demo-vault-dir>");

type Case = { group: string; q: string; want: string[] };

const notes = readNotes(dir);
const texts = new Map(notes.map((n) => [n.path, n.text]));
const input = (n: BenchNote): NoteInput => ({ path: n.path, mtime: n.mtime, ...fieldsFromMarkdown(n.path, n.text) });
const engine = new JetEngine();
engine.configure({ stemming: ["en"] });
engine.build(notes.map(input));
const now = Date.now();

const run = (q: string): Hit[] => engine.query(parseQuery(q), { now, limit: 50 }).hits;
/** The boost as the plugin applies it: the first hits are checked, the rest keep their score. */
const boost = (hits: Hit[], q: string, limit = SEQUENCE_CHECK_LIMIT): Hit[] => {
	const head = applySequenceBoost(hits.slice(0, limit), q, (p) => texts.get(p) ?? null);
	return [...head, ...hits.slice(limit)].sort((a, b) => b.matched - a.matched || b.score - a.score);
};
const rankOf = (hits: Hit[], want: ReadonlySet<string>): number => {
	const i = hits.findIndex((h) => want.has(h.path));
	return i < 0 ? 0 : i + 1;
};
const tally = (ranks: number[]): string => {
	const n = ranks.length;
	const r1 = ranks.filter((r) => r === 1).length;
	const r3 = ranks.filter((r) => r >= 1 && r <= 3).length;
	const mrr = ranks.reduce((s, r) => s + (r ? 1 / r : 0), 0) / Math.max(n, 1);
	const pct = (k: number): string => `${((100 * k) / Math.max(n, 1)).toFixed(1)}%`;
	return `top 1 ${String(r1).padStart(3)} (${pct(r1).padStart(5)})  top 3 ${String(r3).padStart(3)} (${pct(r3).padStart(5)})  MRR ${mrr.toFixed(3)}  of ${n}`;
};

// ---- A. the generated groups
const SEEDS = 20;
const groups = new Map<string, { base: number[]; seq: number[] }>();
let moved = 0;
let total = 0;
for (let seed = 1; seed <= SEEDS; seed++) {
	for (const c of autoQuality(dir, 25, seed) as Case[]) {
		const q = c.q.replaceAll('"', "");
		const want = new Set(c.want);
		const hits = run(q);
		const boosted = boost(hits, q);
		const g = groups.get(c.group) ?? { base: [], seq: [] };
		g.base.push(rankOf(hits, want));
		g.seq.push(rankOf(boosted, want));
		groups.set(c.group, g);
		total++;
		if (hits[0]?.path !== boosted[0]?.path) moved++;
	}
}
console.log(`A. generated searches, ${SEEDS} seeds x 25 per group, the phrase group typed without quotes`);
for (const [name, g] of groups) {
	console.log(`  ${name.padEnd(12)} without ${tally(g.base)}`);
	console.log(`  ${"".padEnd(12)} with    ${tally(g.seq)}`);
}
console.log(`  the first result changed for ${moved} of ${total} searches\n`);

// ---- B. words side by side in a note
let state = 12345;
const rand = (): number => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;
const wordsOf = (q: string): string[] => q.split(" ");
const holdsAll = (text: string, ws: string[]): boolean =>
	ws.every((w) => new RegExp(`(?:^|[^\\p{L}])${w}`, "u").test(text.toLowerCase()));
const seen = new Set<string>();
const pairs: Case[] = [];
for (const n of notes) {
	for (const line of n.text.replace(/^---[\s\S]*?\n---\n/, "").split("\n")) {
		const toks = line
			.toLowerCase()
			.split(/[^\p{L}'-]+/u)
			.filter((x) => x.length >= 4);
		for (const len of [2, 3]) {
			for (let i = 0; i + len <= toks.length; i++) {
				if (rand() > 0.06) continue;
				const q = toks.slice(i, i + len).join(" ");
				if (seen.has(q) || !line.toLowerCase().includes(q)) continue;
				seen.add(q);
				const all = notes.filter((m) => holdsAll(m.text, wordsOf(q)));
				const ordered = all.filter((m) => hasPhrase(m.text, q)).map((m) => m.path);
				if (all.length >= 4 && ordered.length >= 1 && ordered.length < all.length)
					pairs.push({ group: `${len} words`, q, want: ordered });
			}
		}
	}
}
console.log("B. words side by side in a note, at least 4 notes hold the words and some hold them in order");
for (const g of ["2 words", "3 words"]) {
	const cs = pairs.filter((c) => c.group === g);
	const ranks = (f: (hits: Hit[], q: string) => Hit[]): number[] =>
		cs.map((c) => rankOf(f(run(c.q), c.q), new Set(c.want)));
	console.log(`  ${g.padEnd(12)} without ${tally(ranks((h) => h))}`);
	console.log(`  ${"".padEnd(12)} with    ${tally(ranks(boost))}`);
}

// ---- C. the opposite order
{
	const cs = pairs.filter((c) => c.group === "2 words");
	let changed = 0;
	for (const c of cs) {
		const q = wordsOf(c.q).reverse().join(" ");
		const hits = run(q);
		if (hits[0]?.path !== boost(hits, q)[0]?.path) changed++;
	}
	console.log(
		`\nC. the same pairs typed the other way round: the first result changed for ${changed} of ${cs.length}\n`,
	);
}

// ---- D. cost
{
	const qs = pairs.slice(0, 200).map((c) => c.q);
	const hs = qs.map((q) => run(q));
	for (const [i, q] of qs.entries()) boost(hs[i] ?? [], q);
	const t = performance.now();
	const reps = 5;
	for (let k = 0; k < reps; k++) for (const [i, q] of qs.entries()) boost(hs[i] ?? [], q);
	const mean = notes.reduce((s, n) => s + n.text.length, 0) / notes.length;
	console.log(
		`D. the check on the first ${SEQUENCE_CHECK_LIMIT} hits, texts in memory: ${((performance.now() - t) / (reps * qs.length)).toFixed(3)} ms per search (notes average ${Math.round(mean)} characters)`,
	);
}
