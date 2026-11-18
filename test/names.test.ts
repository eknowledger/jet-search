import { describe, expect, it } from "vitest";
import { type NameHit, type NameItem, NameIndex } from "../src/tier0/names";

/** A seeded random generator (mulberry32), so failures repeat. */
const rng = (seed: number) => () => {
	seed |= 0;
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Items from names (ids from 1, path `Notes/<name>.md`), with optional aliases or paths. */
const items = (...defs: Array<string | (Partial<NameItem> & { name: string })>): NameItem[] =>
	defs.map((d, i) => {
		const def = typeof d === "string" ? { name: d } : d;
		return { id: i + 1, aliases: [], path: `Notes/${def.name}.md`, ...def };
	});

const names = (hits: readonly NameHit[]): string[] => hits.map((h) => h.text);

/** The highlighted parts of a hit, as text. */
const marked = (hit: NameHit | undefined): string[] => (hit ? hit.ranges.map(([a, b]) => hit.text.slice(a, b)) : []);

const top = (index: NameIndex, query: string): NameHit => {
	const hit = index.match(query)[0];
	if (!hit) throw new Error(`no hit for ${query}`);
	return hit;
};

describe("fuzzy names", () => {
	it("ptspec finds Pattern Spec first among notes with spec", () => {
		const index = new NameIndex(
			items(
				"Spec Template",
				"Product Spec",
				"API Spec Review",
				"Inspection Spec",
				"Speculative ideas",
				"Kiln — Pattern Spec",
				"Platform notes",
			),
		);
		const hit = top(index, "ptspec");
		expect(hit.text).toBe("Kiln — Pattern Spec");
		expect(hit.ranges).toEqual([
			[7, 8],
			[9, 10],
			[15, 19],
		]);
		expect(marked(hit)).toEqual(["P", "t", "Spec"]);
		expect(hit.exact).toBe(false);
	});

	it("rsplan finds Rover Setup Plan by its word starts", () => {
		const index = new NameIndex(
			items("Release plan", "Spring plan", "Roadmap", "Research Sprint Plan", "Rover Setup Plan", "Plan"),
		);
		const hits = index.match("rsplan");
		expect(names(hits).slice(0, 2)).toEqual(["Rover Setup Plan", "Research Sprint Plan"]);
		expect(marked(hits[0])).toEqual(["R", "S", "Plan"]);
		expect(names(hits)).not.toContain("Release plan");
	});

	it("ranks exact, then the name starting with the word, then the name containing it", () => {
		const index = new NameIndex(items("Rooftop garden ideas", "Garden Journal", "Gardening basics", "Garden"));
		const hits = index.match("garden");
		expect(names(hits).slice(0, 3)).toEqual(["Garden", "Garden Journal", "Rooftop garden ideas"]);
		expect(names(hits)).toContain("Gardening basics");
		expect(hits.map((h) => h.exact)).toEqual([true, false, false, false]);
		expect(hits.map(marked)).toEqual([["Garden"], ["Garden"], ["garden"], ["Garden"]]);
		expect((hits[2] as NameHit).ranges).toEqual([[8, 14]]);
	});

	it("matches words in any order, each in the same field", () => {
		const index = new NameIndex(items("Weekly review template", "Review of the week", "Template library"));
		expect(names(index.match("template review"))).toEqual(["Weekly review template"]);
		expect(marked(top(index, "template review"))).toEqual(["review", "template"]);
	});

	it("matches a contiguous piece inside a word, below word starts", () => {
		const index = new NameIndex(items("Explanation", "Plan", "Lantern"));
		const hits = index.match("lan");
		expect(names(hits)).toEqual(["Lantern", "Plan", "Explanation"]);
		expect(hits.map(marked)).toEqual([["Lan"], ["lan"], ["lan"]]);
	});

	it("is case and accent insensitive, with ranges on the text as written", () => {
		const decomposed = "Résumé draft";
		const index = new NameIndex(items("Résumé", decomposed, "Straße plan", "Café — Élan"));
		const hits = index.match("resume");
		expect(names(hits)).toEqual(["Résumé", decomposed]);
		expect((hits[0] as NameHit).exact).toBe(true);
		expect((hits[0] as NameHit).ranges).toEqual([[0, 6]]);
		expect((hits[1] as NameHit).ranges).toEqual([[0, 8]]);
		expect(marked(top(index, "RÉSUMÉ"))).toEqual(["Résumé"]);
		expect(marked(top(index, "strasse"))).toEqual(["Straße"]);
		expect(marked(top(index, "cafe elan"))).toEqual(["Café", "Élan"]);
		expect(top(index, "cafe elan").exact).toBe(true);
	});

	it("matches Chinese and Japanese as substrings, other scripts as words", () => {
		const index = new NameIndex(items("東京タワー計画", "Привет мир", "مكتبة البيت"));
		expect(marked(top(index, "タワー"))).toEqual(["タワー"]);
		expect(marked(top(index, "京"))).toEqual(["京"]);
		expect(marked(top(index, "мир"))).toEqual(["мир"]);
		expect(marked(top(index, "البيت"))).toEqual(["البيت"]);
	});
});

describe("short queries", () => {
	const index = new NameIndex(
		items("Apple notes", "Banana bread", "Data analysis", "Map", "Daily Notes").map((i) => ({
			...i,
			path: `${i.name}.md`,
		})),
	);

	it("one letter matches word starts only", () => {
		expect(names(index.match("a")).sort()).toEqual(["Apple notes", "Data analysis"]);
		expect(marked(index.match("a").find((h) => h.text === "Data analysis"))).toEqual(["a"]);
		expect(names(index.match("m"))).toEqual(["Map"]);
	});

	it("two letters match at a word start, not across words or inside one", () => {
		expect(names(index.match("an"))).toEqual(["Data analysis"]);
		expect(marked(top(index, "an"))).toEqual(["an"]);
		expect(names(index.match("na"))).toEqual([]);
		expect(names(index.match("dn"))).toEqual([]);
		expect(names(index.match("da"))).toEqual(["Data analysis", "Daily Notes"]);
	});

	it("three letters may match inside a word and fuzzily", () => {
		expect(names(index.match("ana"))).toEqual(["Data analysis", "Banana bread"]);
		expect(marked(top(index, "dno"))).toEqual(["D", "No"]);
	});
});

describe("compounds and typos", () => {
	const index = new NameIndex(
		items("NebulaSDK — Setup", "Nebula observations", "SDK release checklist", "Lantern", "SunHarbor"),
	);

	it("splits compound names: nebula sdk finds NebulaSDK", () => {
		const hit = top(index, "nebula sdk");
		expect(hit.text).toBe("NebulaSDK — Setup");
		expect(hit.ranges).toEqual([[0, 9]]);
		expect(marked(top(index, "sdk nebula"))).toEqual(["NebulaSDK"]);
		expect(marked(top(index, "sunhar"))).toEqual(["SunHar"]);
	});

	it("joins words of the query across the name's words: nebulasdk finds Nebula SDK notes", () => {
		const joined = new NameIndex(items("Nebula SDK notes", "Nebulas", "SDK notes"));
		const hit = top(joined, "nebulasdk");
		expect(hit.text).toBe("Nebula SDK notes");
		expect(hit.ranges).toEqual([
			[0, 6],
			[7, 10],
		]);
		expect(names(index.match("nebulasdk"))).toEqual(["NebulaSDK — Setup"]);
	});

	it("forgives one typo in a word of 4+ letters: nebual sdk, lanern, lamtern, lanttern", () => {
		const hit = top(index, "nebual sdk");
		expect(hit.text).toBe("NebulaSDK — Setup");
		expect(hit.ranges).toEqual([[0, 9]]);
		expect(marked(top(index, "lanern"))).toEqual(["Lan", "ern"]);
		expect(marked(top(index, "lamtern"))).toEqual(["Lantern"]);
		expect(marked(top(index, "lanttern"))).toEqual(["Lantern"]);
		expect(top(index, "nebual").text).toBe("NebulaSDK — Setup");
		expect(marked(top(index, "nebual"))).toEqual(["Nebula"]);
	});

	it("keeps the first letter fixed, needs 4+ letters, and allows one edit up to 8 letters", () => {
		expect(index.match("kantern")).toEqual([]);
		expect(index.match("lnatren")).toEqual([]);
		expect(index.match("lsn")).toEqual([]);
		expect(index.match("sdj")).toEqual([]);
	});

	it("allows two typos from 9 letters", () => {
		const long = new NameIndex(items("Chrysanthemum care", "Christmas list"));
		expect(marked(top(long, "chrysantenum"))).toEqual(["Chrysanthemum"]);
	});

	it("ranks typo matches below other matches", () => {
		const both = new NameIndex(items("Lantern", "Lamb tern notes"));
		const hits = both.match("lamtern");
		expect(names(hits)).toEqual(["Lamb tern notes", "Lantern"]);
		expect((hits[0] as NameHit).score).toBeGreaterThan((hits[1] as NameHit).score);
	});
});

describe("aliases and paths", () => {
	it("an exact alias ranks first and shows the alias", () => {
		const index = new NameIndex(
			items("Ghost stories", { name: "Greenhouse Handbook", aliases: ["GH"] }, "Night shift log"),
		);
		const hits = index.match("gh");
		expect(hits[0]).toMatchObject({ id: 2, field: "alias", text: "GH", exact: true, ranges: [[0, 2]] });
		expect(names(hits)).toEqual(["GH", "Ghost stories"]);
	});

	it("prefers the name to an alias, and an alias to the path, for the same match", () => {
		const index = new NameIndex([
			{ id: 1, name: "Orchard notes", aliases: ["Orchard"], path: "Orchard/Orchard notes.md" },
		]);
		expect(top(index, "orchard")).toMatchObject({ field: "alias", exact: true });
		expect(top(index, "orchard no")).toMatchObject({ field: "name", text: "Orchard notes", exact: false });
	});

	it("matches words across the path: orchid plan", () => {
		const index = new NameIndex([
			{ id: 1, name: "Plan", aliases: [], path: "2.Projects/Orchid/Plan.md" },
			{ id: 2, name: "Plan", aliases: [], path: "2.Projects/Lotus/Plan.md" },
			{ id: 3, name: "Orchid notes", aliases: [], path: "3.Areas/Orchid notes.md" },
		]);
		const hits = index.match("orchid plan");
		expect(hits).toHaveLength(1);
		expect(hits[0]).toMatchObject({ id: 1, field: "path", text: "2.Projects/Orchid/Plan.md", exact: false });
		expect((hits[0] as NameHit).ranges).toEqual([
			[11, 17],
			[18, 22],
		]);
		expect(index.match("md")).toEqual([]);
	});

	it("breaks ties by shorter text, then id", () => {
		const index = new NameIndex([
			{ id: 7, name: "Plan", aliases: [], path: "B/Plan.md" },
			{ id: 3, name: "Plan", aliases: [], path: "A/Plan.md" },
			{ id: 5, name: "Plans", aliases: [], path: "Plans.md" },
		]);
		expect(index.match("plan").map((h) => h.id)).toEqual([3, 7, 5]);
	});
});

describe("word boundaries and text as written", () => {
	it("splits camelCase, acronyms and letter–digit runs", () => {
		const index = new NameIndex(items("XMLParser notes", "Atlas2026 review", "2026-10-07 Daily"));
		expect(marked(top(index, "parser"))).toEqual(["Parser"]);
		expect(marked(top(index, "xml"))).toEqual(["XML"]);
		expect(marked(top(index, "atlas 2026"))).toEqual(["Atlas2026"]);
		expect(names(index.match("2026"))).toEqual(["2026-10-07 Daily", "Atlas2026 review"]);
		expect(marked(top(index, "20261007"))).toEqual(["2026", "10", "07"]);
	});

	it("keeps offsets right around emoji and other astral characters", () => {
		const index = new NameIndex(items("🌱 Garden log", "Notes 𝒜 garden"));
		const hits = index.match("garden");
		expect(hits.map((h) => h.ranges)).toEqual([[[3, 9]], [[9, 15]]]);
		expect(hits.map(marked)).toEqual([["Garden"], ["garden"]]);
	});

	it("matches a file name that differs from the note's name, with offsets into the path", () => {
		const index = new NameIndex([{ id: 1, name: "A Pretty Title", aliases: [], path: "Work/file-name-here.md" }]);
		expect(top(index, "file here")).toMatchObject({
			field: "path",
			ranges: [
				[5, 9],
				[15, 19],
			],
		});
		expect(top(index, "work file")).toMatchObject({
			field: "path",
			ranges: [
				[0, 4],
				[5, 9],
			],
		});
		expect(top(index, "pretty")).toMatchObject({ field: "name" });
		// Every word must match in one field: "work" is only in the path, "pretty" only in the name.
		expect(index.match("work pretty")).toEqual([]);
	});

	it("does not offer the path of a note at the root, whose path is its name", () => {
		const index = new NameIndex([{ id: 1, name: "Plan", aliases: [], path: "Plan.md" }]);
		expect(index.match("plan").map((h) => h.field)).toEqual(["name"]);
		expect(index.match("md")).toEqual([]);
	});

	it("copes with long texts and many words", () => {
		const long = `${"word ".repeat(300)}Lantern`;
		const index = new NameIndex(items(long, "Lantern"));
		expect(index.match("lantern").map((h) => h.text.length)).toEqual([7, long.length]);
		expect(names(index.match("lntrn"))).toEqual(["Lantern"]);
		const many = Array.from({ length: 20 }, () => "word").join(" ");
		expect(index.match(many).map((h) => h.text.length)).toEqual([long.length]);
	});
});

describe("index upkeep", () => {
	it("limits candidates with allow, and results with limit", () => {
		const index = new NameIndex(items("Garden A", "Garden B", "Garden C", "Garden D", "Garden E"));
		expect(index.match("garden", { allow: (id) => id % 2 === 0 }).map((h) => h.id)).toEqual([2, 4]);
		expect(index.match("garden", { limit: 2 }).map((h) => h.id)).toEqual([1, 2]);
		expect(index.match("garden", { limit: 0 })).toEqual([]);
		expect(index.match("   ")).toEqual([]);
		expect(index.match("— · ")).toEqual([]);
	});

	it("answers the same after being filled in several calls and settled", () => {
		const all = items("Lantern", "Harbor log", "Garden plan", "Garden beds", "Beacon", "Signal light notes");
		const whole = new NameIndex(all);
		const parts = new NameIndex();
		parts.fill(all.slice(0, 2));
		parts.fill(all.slice(2, 5));
		parts.fill(all.slice(5));
		parts.settle();
		expect(parts.size).toBe(whole.size);
		for (const q of ["garden", "lamtern", "harbour", "beacon", "signal", "g p", "zzz"])
			expect(parts.match(q)).toEqual(whole.match(q));
		parts.upsert({ id: 99, name: "Lantern oil", aliases: [], path: "Notes/Lantern oil.md" });
		expect(top(parts, "lamtern oil").id).toBe(99);
	});

	it("follows upsert and remove, typos included", () => {
		const index = new NameIndex(items("Lantern", "Harbor log"));
		expect(index.size).toBe(2);
		index.upsert({ id: 1, name: "Beacon", aliases: ["Signal light"], path: "Notes/Beacon.md" });
		expect(index.size).toBe(2);
		expect(index.match("lantern")).toEqual([]);
		expect(index.match("lamtern")).toEqual([]);
		expect(top(index, "beacon")).toMatchObject({ id: 1, exact: true });
		expect(top(index, "bwacon")).toMatchObject({ id: 1, ranges: [[0, 6]] });
		expect(top(index, "signal")).toMatchObject({ id: 1, field: "alias" });
		index.upsert({ id: 9, name: "Lighthouse", aliases: [], path: "Lighthouse.md" });
		expect(index.size).toBe(3);
		expect(top(index, "lighthuose").id).toBe(9);
		index.remove(1);
		index.remove(42);
		expect(index.size).toBe(2);
		expect(index.match("beacon")).toEqual([]);
		expect(index.match("bwacon")).toEqual([]);
		expect(top(index, "harbor").id).toBe(2);
	});

	it("shares folders between notes and frees them when the last note goes", () => {
		const index = new NameIndex([
			{ id: 1, name: "One", aliases: [], path: "Orchid/One.md" },
			{ id: 2, name: "Two", aliases: [], path: "Orchid/Two.md" },
		]);
		expect(index.match("orchid").map((h) => h.id)).toEqual([1, 2]);
		index.remove(1);
		expect(index.match("orchid").map((h) => h.id)).toEqual([2]);
		index.upsert({ id: 2, name: "Two", aliases: [], path: "Lotus/Two.md" });
		expect(index.match("orchid")).toEqual([]);
		index.upsert({ id: 3, name: "Three", aliases: [], path: "Maple/Three.md" });
		expect(index.match("lotus").map((h) => h.id)).toEqual([2]);
		expect(index.match("maple").map((h) => h.id)).toEqual([3]);
		expect(index.match("orchid")).toEqual([]);
	});
});

// --- Performance: generated vaults, timed in this process ---

const VOCAB = (
	"garden journal plan spec platform setup review notes ideas meeting weekly daily project roadmap draft " +
	"design research summary template checklist budget travel recipe reading list archive inbox lantern " +
	"harbor orchard river stone cloud signal beacon market planet rocket studio kitchen library theory " +
	"engine module system network sensor report analysis forecast quarter season winter summer autumn " +
	"spring morning evening pattern sketch outline chapter lesson course guide manual handbook protocol"
).split(" ");

const vault = (count: number, seed: number): NameItem[] => {
	const r = rng(seed);
	const pick = () => VOCAB[Math.floor(r() * VOCAB.length)] as string;
	const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
	const folders = Array.from({ length: 40 }, () => `${Math.floor(r() * 4)}.${cap(pick())}/${cap(pick())}`);
	return Array.from({ length: count }, (_, i) => {
		const words = Array.from({ length: 1 + Math.floor(r() * 4) }, () => (r() < 0.6 ? cap(pick()) : pick()));
		if (r() < 0.15) words[0] = cap(pick()) + cap(pick()).toUpperCase().slice(0, 3);
		if (r() < 0.1) words.push(`2026-${String(1 + Math.floor(r() * 12)).padStart(2, "0")}`);
		const name = words.join(r() < 0.2 ? " — " : " ");
		const aliases = r() < 0.2 ? [cap(pick()).slice(0, 2 + Math.floor(r() * 4))] : [];
		return { id: i, name, aliases, path: `${folders[Math.floor(r() * folders.length)] as string}/${name}.md` };
	});
};

/** Typing-like queries: prefixes of names, abbreviations, typos, several words, misses. */
const queries = (data: readonly NameItem[], seed: number): string[] => {
	const r = rng(seed);
	const out: string[] = [];
	for (let i = 0; i < 300; i++) {
		const name = (data[Math.floor(r() * data.length)] as NameItem).name.toLowerCase();
		const words = name.split(/[\s—]+/).filter(Boolean);
		const kind = i % 6;
		if (kind === 0) out.push(name.slice(0, 1 + Math.floor(r() * 3)));
		else if (kind === 1) out.push(name.slice(0, 3 + Math.floor(r() * 8)));
		else if (kind === 2) out.push(words.map((w) => w.slice(0, 1 + Math.floor(r() * 3))).join(""));
		else if (kind === 3) {
			const w = words[0] as string;
			const k = 1 + Math.floor(r() * Math.max(1, w.length - 2));
			out.push(w.length > 3 ? w.slice(0, k) + (w[k + 1] ?? "") + w[k] + w.slice(k + 2) : w);
		} else if (kind === 4) out.push(words.map((w) => w.slice(0, 2 + Math.floor(r() * 4))).join(" "));
		else out.push(Array.from({ length: 3 + Math.floor(r() * 5) }, () => "qxzvjk"[Math.floor(r() * 6)]).join(""));
	}
	return out;
};

const timeQueries = (index: NameIndex, qs: readonly string[]): { p50: number; p95: number } => {
	for (let round = 0; round < 3; round++) for (const q of qs) index.match(q);
	const times: number[] = [];
	for (let round = 0; round < 3; round++)
		for (const q of qs) {
			const t0 = performance.now();
			index.match(q);
			times.push(performance.now() - t0);
		}
	times.sort((a, b) => a - b);
	const at = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))] as number;
	return { p50: at(0.5), p95: at(0.95) };
};

describe("performance", () => {
	it("answers in ≤ 1 ms p95 for ~2,000 items", () => {
		const data = vault(2000, 1);
		const index = new NameIndex(data);
		const { p50, p95 } = timeQueries(index, queries(data, 2));
		expect(p95, `p50 ${p50.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms`).toBeLessThanOrEqual(1);
	});

	it("answers in ≤ 8 ms p95 for ~20,000 items", () => {
		const data = vault(20_000, 3);
		const index = new NameIndex(data);
		const { p50, p95 } = timeQueries(index, queries(data, 4));
		expect(p95, `p50 ${p50.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms`).toBeLessThanOrEqual(8);
	});
});
