import { describe, expect, it } from "vitest";
import { osaDistance, prefixRange, typoBudget, typoMatches } from "../src/engine/typos";

/** A seeded random generator (mulberry32), so failures repeat. */
const rng = (seed: number) => () => {
	seed |= 0;
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const randomWord = (r: () => number, alphabet = "abcde", min = 1, max = 9): string => {
	const n = min + Math.floor(r() * (max - min + 1));
	let s = "";
	for (let i = 0; i < n; i++) s += alphabet[Math.floor(r() * alphabet.length)];
	return s;
};

describe("typo budget", () => {
	it("allows none under 4 letters, 1 for 4–8, 2 for 9+", () => {
		expect([typoBudget("abc"), typoBudget("abcd"), typoBudget("abcdefgh"), typoBudget("abcdefghi")]).toEqual([
			0, 1, 1, 2,
		]);
	});
});

describe("prefix range", () => {
	it("finds every term starting with the prefix", () => {
		const terms = ["speak", "speech", "speech2text", "speechless", "speed", "spell"];
		const [a, b] = prefixRange(terms, "spee");
		expect(terms.slice(a, b)).toEqual(["speech", "speech2text", "speechless", "speed"]);
	});
});

describe("typo walk", () => {
	it("finds one-edit and swapped-letter matches with the first letter fixed", () => {
		const terms = ["mustard", "nebulasdk", "mustord", "mutard", "nustard", "speech"].sort();
		const found = typoMatches(terms, "msutard", 1).map((m) => [terms[m.index], m.edits]);
		expect(found).toEqual(
			expect.arrayContaining([
				["mustard", 1],
				["mutard", 1],
			]),
		);
		expect(found.map(([t]) => t)).not.toContain("nustard");
	});

	it("matches a brute-force edit distance on 10,000 random pairs", () => {
		const r = rng(42);
		for (let round = 0; round < 50; round++) {
			const terms = [...new Set(Array.from({ length: 200 }, () => randomWord(r)))].sort();
			for (let q = 0; q < 4; q++) {
				const word = randomWord(r, "abcde", 1, 10);
				const budget = 1 + Math.floor(r() * 2);
				const got = new Map(
					typoMatches(terms, word, budget, { limit: 10_000 })
						.filter((m) => !m.prefix)
						.map((m) => [terms[m.index], m.edits]),
				);
				for (const t of terms) {
					if (t === word || t[0] !== word[0]) continue;
					const d = osaDistance(t, word);
					if (d <= budget) expect([t, got.get(t)]).toEqual([t, d]);
					else expect(got.has(t)).toBe(false);
				}
			}
		}
	});

	it("finds fuzzy prefixes: terms beginning within one edit of the typed word", () => {
		const r = rng(7);
		for (let round = 0; round < 50; round++) {
			const terms = [...new Set(Array.from({ length: 200 }, () => randomWord(r, "abcd", 1, 10)))].sort();
			const word = randomWord(r, "abcd", 4, 6);
			const got = typoMatches(terms, word, 1, { fuzzyPrefix: true, limit: 10_000 });
			const hit = new Set(got.map((m) => terms[m.index]));
			for (const t of terms) {
				if (t === word || t[0] !== word[0]) continue;
				const full = osaDistance(t, word) <= 1;
				let pre = false;
				for (let k = 1; k <= t.length && !pre; k++) pre = osaDistance(t.slice(0, k), word) <= 1;
				expect([t, hit.has(t)]).toEqual([t, full || pre]);
			}
		}
	});
});
