import { describe, expect, it } from "vitest";
import { cutExcerpt, excerptCacheStats, findHits, frontmatterEnd, hasPhrase } from "../src/excerpt/excerpt";
import type { Excerpt } from "../src/excerpt/excerpt";
import { budget } from "./budget";

/** A seeded random generator (mulberry32), so failures repeat. */
const rng = (seed: number) => () => {
	seed |= 0;
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** The highlighted words of an excerpt. */
const marked = (x: Excerpt | null): string[] => (x ? x.marks.map(([a, b]) => x.text.slice(a, b)) : []);

const cut = (text: string, terms: string[], width?: number): Excerpt => {
	const x = cutExcerpt(text, terms, width === undefined ? {} : { width });
	if (!x) throw new Error(`no excerpt for ${terms.join(" ")}`);
	return x;
};

describe("the best hit", () => {
	it("picks the line with the most of the words, the first among equals", () => {
		const text = "The stone path.\nA bridge.\nThe river runs past the stone bridge.\nThe river again.";
		const x = cut(text, ["stone", "river"]);
		expect(x.line).toBe(2);
		expect(marked(x)).toEqual(["river", "stone"]);
		expect(x.more).toBe(3);
		expect(cut("A river.\nAnother river.", ["river"]).line).toBe(0);
	});

	it("counts a word as typed above a word form or a typo of it", () => {
		const text = "It would take words.\nThe world.";
		const x = cutExcerpt(text, ["would", "words", "world"], { exact: ["world"] });
		expect(x?.text).toBe("The world.");
		const y = cutExcerpt("Her studies.\nOne study, done.", ["studies", "study"], { exact: ["study"] });
		expect(y?.line).toBe(1);
	});

	it("picks the first hit in the text when it is as good as any, whichever term it is", () => {
		const text = "Garden notes.\nThe river runs past the stone bridge.\nA stone wall.";
		const x = cut(text, ["stone", "river"]);
		expect(x.offset).toBe(text.indexOf("river"));
		expect(x.line).toBe(1);
		expect(x.text).toBe("The river runs past the stone bridge.");
		expect(marked(x)).toEqual(["river", "stone"]);
		expect(x.more).toBe(2);
	});

	it("is null when no term occurs, or there are no terms", () => {
		expect(cutExcerpt("A quiet garden.", ["river"])).toBeNull();
		expect(cutExcerpt("A quiet garden.", [])).toBeNull();
		expect(cutExcerpt("", ["river"])).toBeNull();
	});

	it("starts hits at word starts only", () => {
		expect(cutExcerpt("concatenate the scatter", ["cat"])).toBeNull();
		expect(marked(cut("concatenate a cat", ["cat"]))).toEqual(["cat"]);
	});

	it("gives the line and offset of the hit in the whole note", () => {
		const text = ["# Title", "", "first line", "second line with a lantern", "lantern again"].join("\n");
		const x = cut(text, ["lantern"]);
		expect([x.line, x.offset]).toEqual([3, text.indexOf("lantern")]);
		expect(x.more).toBe(1);
		const crlf = text.replace(/\n/g, "\r\n");
		const y = cut(crlf, ["lantern"]);
		expect([y.line, y.offset, y.text]).toEqual([3, crlf.indexOf("lantern"), "second line with a lantern"]);
	});
});

describe("marks", () => {
	it("cover whole words and follow the '…' of a cut line", () => {
		const r = rng(1);
		const words = ["river", "stone", "garden", "window", "paper", "light", "orange", "cloud", "table", "music"];
		const filler = (n: number) => Array.from({ length: n }, () => words[Math.floor(r() * words.length)]).join(" ");
		const text = `${filler(60)} the lantern shines over the lanterns ${filler(60)}`;
		const x = cut(text, ["lantern"]);
		expect(x.text.startsWith("…")).toBe(true);
		expect(x.text.endsWith("…")).toBe(true);
		expect(x.text.length).toBeLessThanOrEqual(160 + 2);
		expect(x.text.length).toBeGreaterThan(120);
		expect(marked(x)).toEqual(["lantern", "lanterns"]);
		// About a third of the width before the hit, starting at a word.
		const at = x.text.indexOf("lantern");
		expect(at).toBeGreaterThan(30);
		expect(at).toBeLessThan(70);
		expect(x.text[1]).not.toBe(" ");
		expect(text.includes(x.text.slice(1, -1))).toBe(true);
	});

	it("follow Markdown simplified for display", () => {
		const x = cut("## The **lantern** and [[Lamps/Old lantern|the lantern page]] or [a lantern](https://x.org/l)", [
			"lantern",
		]);
		expect(x.text).toBe("The lantern and the lantern page or a lantern");
		expect(marked(x)).toEqual(["lantern", "lantern", "lantern"]);
		const y = cut("- [ ] buy a ==lantern== today", ["lantern"]);
		expect(y.text).toBe("buy a lantern today");
		expect(marked(y)).toEqual(["lantern"]);
		const q = cut("> quoted **bold** lantern", ["lantern"]);
		expect([q.text, marked(q)]).toEqual(["quoted bold lantern", ["lantern"]]);
	});

	it("keep a link as written when the hit is in its hidden part", () => {
		const x = cut("see [[Lantern Notes|the page]] here", ["lantern"]);
		expect(x.text).toBe("see [[Lantern Notes|the page]] here");
		expect(marked(x)).toEqual(["Lantern"]);
		const y = cut("see [the page](https://lantern.org) here", ["lantern"]);
		expect(marked(y)).toEqual(["lantern"]);
	});

	it("drop hits hidden by the simplification", () => {
		const x = cut("a lantern and [[Lantern Shop|the shop]]", ["lantern"]);
		expect(x.text).toBe("a lantern and the shop");
		expect(marked(x)).toEqual(["lantern"]);
		expect(x.more).toBe(1);
	});

	it("never split a surrogate pair, an emoji sequence or a combining sequence when cutting", () => {
		const unit = "\u{1f642}\u{1f389}\u{1f469}\u200d\u{1f4bb}";
		const emoji = unit.repeat(40);
		const x = cut(`${emoji}lantern${emoji}`, ["lantern"]);
		expect(marked(x)).toEqual(["lantern"]);
		const [left = "", right = ""] = x.text.slice(1, -1).split("lantern");
		const whole = /^(?:\u{1f642}|\u{1f389}|\u{1f469}\u200d\u{1f4bb})*$/u;
		expect([whole.test(left), whole.test(right)]).toEqual([true, true]);
		const nfd = "e\u0301".repeat(200);
		expect(cutExcerpt(`${nfd}lantern`, ["lantern"])).toBeNull();
		const y = cut(`${nfd}-lantern-${nfd}`, ["lantern"], 40);
		expect(marked(y)).toEqual(["lantern"]);
		expect([y.text.charCodeAt(1), y.text.charCodeAt(y.text.length - 2)]).toEqual([0x65, 0x301]);
	});
});

describe("accents, case and compound parts", () => {
	it("matches accented and upper-case forms of normalized terms", () => {
		const x = cut("My Résumé, the CAFÉ and the Straße.", ["resume", "cafe", "strasse"]);
		expect(marked(x)).toEqual(["Résumé", "CAFÉ", "Straße"]);
		expect(marked(cut("Die GROSSE Straße", ["strasse", "grosse"]))).toEqual(["GROSSE", "Straße"]);
		expect(marked(cut("Ñandú y la Ciudad de México", ["nandu", "mexico"]))).toEqual(["Ñandú", "México"]);
	});

	it("matches decomposed text (combining accents) too", () => {
		const text = "My résumé here";
		const x = cut(text, ["resume"]);
		expect(marked(x)).toEqual(["résumé"]);
		expect(x.offset).toBe(3);
	});

	it("matches a prefix term across a folded pair (stras → Straße)", () => {
		expect(marked(cut("Die Straße", ["stras"]))).toEqual(["Straße"]);
	});

	it("finds camelCase and letter–digit parts", () => {
		expect(marked(cut("Using the NebulaSDK today", ["sdk"]))).toEqual(["SDK"]);
		expect(marked(cut("Using the NebulaSDK today", ["nebula", "sdk"]))).toEqual(["Nebula", "SDK"]);
		expect(marked(cut("the HTMLParser class", ["parser"]))).toEqual(["Parser"]);
		expect(marked(cut("the HTMLParser class", ["html"]))).toEqual(["HTML"]);
		expect(marked(cut("Atlas2026 plans", ["2026"]))).toEqual(["2026"]);
		expect(cutExcerpt("version 12026", ["2026"])).toBeNull();
		expect(cutExcerpt("nebulasdk", ["sdk"])).toBeNull();
	});

	it("highlights a prefix term to the end of its word part", () => {
		expect(marked(cut("The speech was long", ["spee"]))).toEqual(["speech"]);
		expect(marked(cut("SpeechToText and speeches", ["spee"]))).toEqual(["Speech", "speeches"]);
		expect(marked(cut("the SDKs list", ["sdk"]))).toEqual(["SDKs"]);
	});

	it("treats Greek final sigma as sigma", () => {
		expect(marked(cut("ΟΔΟΣ και οδός", ["οδος"]))).toEqual(["ΟΔΟΣ", "οδός"]);
	});
});

describe("scripts", () => {
	it("matches Chinese and Japanese pairs anywhere in a run", () => {
		const x = cut("这是一个语音模型的例子", ["语音"]);
		expect(marked(x)).toEqual(["语音"]);
		expect(x.offset).toBe(4);
		expect(marked(cut("这是一个语音模型的例子", ["语音", "模型"]))).toEqual(["语音", "模型"]);
		expect(marked(cut("日本語のテキスト", ["テキ"]))).toEqual(["テキ"]);
	});

	it("matches Arabic with short vowels, letter variants and the article", () => {
		expect(marked(cut("مُحَمَّد رسول", ["محمد"]))).toEqual(["مُحَمَّد"]);
		expect(marked(cut("قال أحمد", ["احمد"]))).toEqual(["أحمد"]);
		const x = cut("هذا هو الْكِتَابُ الجديد", ["كتاب"]);
		expect(marked(x)).toEqual(["كِتَابُ"]);
		expect(marked(cut("قرأت والكتاب", ["كتاب"]))).toEqual(["كتاب"]);
		expect(cutExcerpt("زكتاب", ["كتاب"])).toBeNull();
	});

	it("matches Thai words from the segmenter inside a run", () => {
		expect(marked(cut("ภาษาไทยง่าย", ["ไทย"]))).toEqual(["ไทย"]);
	});
});

describe("frontmatter, counts and the scan cap", () => {
	it("skips the frontmatter but keeps lines and offsets of the whole note", () => {
		const text = "---\ntitle: lantern\ntags: [lantern]\n---\n# Notes\nA lantern here.";
		const x = cut(text, ["lantern"]);
		expect([x.line, x.offset, x.text]).toEqual([5, text.indexOf("A lantern") + 2, "A lantern here."]);
		expect(x.more).toBe(0);
		expect(cutExcerpt("---\ntitle: lantern\n---\nnothing", ["lantern"])).toBeNull();
		expect(frontmatterEnd("---\na: 1\n---\nbody")).toBe(13);
		expect(frontmatterEnd("---\n---\nbody")).toBe(8);
		expect(frontmatterEnd("---\nnot closed")).toBe(0);
		expect(frontmatterEnd("text\n---\n")).toBe(0);
	});

	it("counts further hits up to 99", () => {
		expect(cut("lantern ".repeat(5), ["lantern"]).more).toBe(4);
		expect(cut("lantern ".repeat(150), ["lantern"]).more).toBe(99);
	});

	it("never reads past the scan limit", () => {
		const text = `${"plain words here ".repeat(2000)}lantern`;
		expect(cutExcerpt(text, ["lantern"], { scanLimit: 10_000 })).toBeNull();
		expect(cut(text, ["lantern"]).offset).toBe(text.length - 7);
		expect(findHits(text, ["lantern"], { scanLimit: 10_000 })).toEqual([]);
		expect(hasPhrase(text, "lantern", { scanLimit: 10_000 })).toBe(false);
		expect(hasPhrase(text, "here lantern")).toBe(true);
	});
});

describe("phrases", () => {
	it("finds consecutive words with any punctuation or space between them", () => {
		expect(hasPhrase("an event-driven, text-to-image model", "text to image")).toBe(true);
		expect(hasPhrase("text\nto   image", "text to image")).toBe(true);
		expect(hasPhrase("text_to_image", "text to image")).toBe(true);
		expect(hasPhrase("the **old** [[lantern]]", "old lantern")).toBe(true);
	});

	it("ignores case and accents", () => {
		expect(hasPhrase("My RÉSUMÉ — writing tips", "resume writing")).toBe(true);
		expect(hasPhrase("Die Straße frei", "strasse frei")).toBe(true);
		expect(hasPhrase("Using NebulaSDK docs", "nebula sdk docs")).toBe(true);
	});

	it("needs the order and whole words", () => {
		expect(hasPhrase("speech to text", "text to speech")).toBe(false);
		expect(hasPhrase("concatenate", "cat")).toBe(false);
		expect(hasPhrase("a black category", "black cat")).toBe(false);
		expect(hasPhrase("the cats ate", "cat ate")).toBe(false);
		expect(hasPhrase("a black cat!", "black cat")).toBe(true);
		expect(hasPhrase("speech, to", "speech to")).toBe(true);
		expect(hasPhrase("speech then to", "speech to")).toBe(false);
	});

	it("keeps one-letter words and handles other scripts", () => {
		expect(hasPhrase("Plan B works", "plan b")).toBe(true);
		expect(hasPhrase("plan c works", "plan b")).toBe(false);
		expect(hasPhrase("这是一个语音模型的例子", "语音模型")).toBe(true);
		expect(hasPhrase("这是一个语音的模型", "语音模型")).toBe(false);
		expect(hasPhrase("Python编程入门", "python 编程")).toBe(true);
		expect(hasPhrase("قال مُحَمَّد اليوم", "محمد اليوم")).toBe(true);
	});

	it("asks nothing of a phrase without words", () => {
		expect(hasPhrase("anything", "!!!")).toBe(true);
	});
});

describe("hit list", () => {
	it("lists every hit with word-part ends, frontmatter included", () => {
		const text = "---\nt: lantern\n---\nLantern, lanterns; LANTERN";
		expect(findHits(text, ["lantern"])).toEqual([
			[7, 14],
			[19, 26],
			[28, 36],
			[38, 45],
		]);
	});

	it("stops at the limit", () => {
		const text = "lantern ".repeat(50);
		expect(findHits(text, ["lantern"], { limit: 3 })).toEqual([
			[0, 7],
			[8, 15],
			[16, 23],
		]);
		expect(findHits(text, ["lantern"])).toHaveLength(50);
		expect(findHits(text, ["lantern"], { limit: 0 })).toEqual([]);
	});
});

describe("pattern cache", () => {
	it("compiles a term set once for all rows, and keeps at most 16 sets", () => {
		const notes = Array.from({ length: 20 }, (_, i) => `note ${i} about the beacon and the harbor`);
		const terms = ["beacon", "harbor", `n${Math.random()}`];
		cutExcerpt(notes[0] ?? "", terms);
		const before = excerptCacheStats().builds;
		for (const n of notes) cutExcerpt(n, terms);
		for (const n of notes) findHits(n, terms);
		expect(excerptCacheStats().builds).toBe(before);
		cutExcerpt(notes[0] ?? "", ["beacon"]);
		expect(excerptCacheStats().builds).toBe(before + 1);
		for (let i = 0; i < 40; i++) cutExcerpt("x", [`t${i}`]);
		expect(excerptCacheStats().size).toBeLessThanOrEqual(16);
	});

	it("compiles one more pattern for a note with accents, then reuses it", () => {
		const terms = ["resume", `r${Math.random()}`];
		cutExcerpt("plain resume", terms);
		const before = excerptCacheStats().builds;
		expect(marked(cut("a Résumé", terms))).toEqual(["Résumé"]);
		expect(excerptCacheStats().builds).toBe(before + 1);
		expect(marked(cut("another résumé, Résumé", terms))).toEqual(["résumé", "Résumé"]);
		expect(marked(cut("plain resume", terms))).toEqual(["resume"]);
		expect(excerptCacheStats().builds).toBe(before + 1);
	});
});

const WORDS = [
	"river",
	"stone",
	"garden",
	"window",
	"paper",
	"light",
	"orange",
	"cloud",
	"table",
	"music",
	"planet",
	"silver",
	"forest",
	"market",
	"bridge",
	"summer",
	"letter",
	"engine",
	"harbor",
	"pencil",
	"to",
	"the",
	"and",
	"of",
	"in",
	"with",
	"over",
	"under",
	"plan",
	"model",
];

/** Generated Markdown notes of 5–20 KB: headings, lists, bold, links, dashes; a few accented words in some. */
const notes = (seed: number, count: number, plant: readonly string[]): string[] => {
	const r = rng(seed);
	const word = () => WORDS[Math.floor(r() * WORDS.length)] as string;
	return Array.from({ length: count }, (_, n) => {
		const size = 5000 + Math.floor(r() * 15_000);
		const lines = ["---", "tags: [notes, plan]", "---"];
		let length = 0;
		for (let i = 0; length < size; i++) {
			const ws = Array.from({ length: 8 + Math.floor(r() * 30) }, () => {
				const w = word();
				const p = r();
				if (p < 0.02) return `**${w}**`;
				if (p < 0.03) return `[[${w}|${word()}]]`;
				if (p < 0.04) return `${w[0]?.toUpperCase()}${w.slice(1)}`;
				if (n % 5 === 0 && p < 0.042) return "café";
				return w;
			});
			const line = (i % 9 === 0 ? "## " : i % 4 === 0 ? "- " : "") + ws.join(" ") + (r() < 0.3 ? " — ok." : ".");
			lines.push(line);
			length += line.length + 1;
		}
		for (const p of plant) {
			const at = 3 + Math.floor(r() * (lines.length - 3));
			lines[at] = `${lines[at]} ${p}`;
		}
		return lines.join("\n");
	});
};

/**
 * The fastest quarter's bound (p25): these run while the suite's other files share the CPU, which
 * inflates a median at random; a real slowdown moves p25 as well.
 */
const p50 = (times: number[]): number => [...times].sort((a, b) => a - b)[Math.floor(times.length / 4)] ?? 0;

describe("performance (20 rows ≤ 2 ms in Obsidian)", () => {
	const rows = notes(11, 20, ["speech", "text to image", "the Speechless voice"]);
	const queries = [["speech"], ["speech", "to"], ["speech", "voice"], ["spee"], ["voice", "model", "planet"]];

	it("cuts 20 excerpts from 5–20 KB notes in ≤ 1 ms p25, a new query each round", () => {
		const times: number[] = [];
		for (let round = 0; round < 60; round++) {
			// A fresh term set per round: the pattern is compiled within the timed 20 rows, as on a keystroke.
			const terms = [...(queries[round % queries.length] ?? []), `zq${round}`];
			const t0 = performance.now();
			for (const text of rows) cutExcerpt(text, terms);
			if (round >= 10) times.push(performance.now() - t0);
		}
		expect(p50(times), `p25 ${p50(times).toFixed(3)} ms`).toBeLessThanOrEqual(budget(1));
		for (const text of rows) expect(cutExcerpt(text, ["speech"])).not.toBeNull();
	});

	it("checks a phrase in 20 notes in ≤ 1 ms p25", () => {
		const times: number[] = [];
		for (let round = 0; round < 40; round++) {
			const t0 = performance.now();
			for (const text of rows) hasPhrase(text, "text to image");
			if (round >= 10) times.push(performance.now() - t0);
		}
		expect(p50(times), `p25 ${p50(times).toFixed(3)} ms`).toBeLessThanOrEqual(budget(1));
		expect(rows.every((text) => hasPhrase(text, "text to image"))).toBe(true);
	});

	it("gives up on a 750 KB note at the scan cap in ≤ 2 ms", () => {
		const r = rng(5);
		const parts: string[] = [];
		for (let n = 0; n < 750 * 1024;) {
			const w = WORDS[Math.floor(r() * WORDS.length)] as string;
			parts.push(w);
			n += w.length + 1;
		}
		const big = `${parts.join(" ")} lantern`;
		const times: number[] = [];
		for (let round = 0; round < 15; round++) {
			const t0 = performance.now();
			expect(cutExcerpt(big, ["lantern", "beacon"])).toBeNull();
			times.push(performance.now() - t0);
		}
		expect(p50(times), `p25 ${p50(times).toFixed(3)} ms`).toBeLessThanOrEqual(budget(2));
		expect(cutExcerpt(big, ["lantern"], { scanLimit: big.length })?.offset).toBe(big.length - 7);
	});
});
