import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fieldsFromMarkdown, type NoteInput } from "../src/engine/fields";
import { JetEngine } from "../src/engine/jet-engine";
import { parseQuery } from "../src/engine/query";

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;
const note = (path: string, text: string, ageDays = 100): NoteInput => ({
	path,
	mtime: NOW - ageDays * DAY,
	...fieldsFromMarkdown(path, text),
});

const corpus = (): NoteInput[] => [
	note(
		"Projects/Walnut kiosk pilot.md",
		"# Walnut kiosk pilot\nThe walnut panels arrive after the kiosk frame is bolted down.",
		3,
	),
	note("Projects/Kiosk cabinet build.md", "# Build\nSand the walnut and oil the kiosk cabinet.", 14),
	note("Projects/Kiosk rollout.md", "# Rollout\nThe kiosk goes to six shops. Kiosk kiosk kiosk.", 20),
	note("Inbox/Workshop order list.md", "Order walnut boards. The kiosk needs two sheets.", 35),
	note("Journal/Lunch.md", "Sandwich and soup."),
	note("Journal/Gardening.md", "Tomatoes, trips and basil. Trips to the market."),
	note("Journal/Rare find.md", "A zanzibar chest in the attic."),
];

const engine = (notes = corpus()): JetEngine => {
	const e = new JetEngine();
	e.build(notes);
	return e;
};

const opts = { limit: 50, now: NOW };
const explain = (
	e: JetEngine,
	text: string,
	path: string | null,
	over: Partial<typeof opts> & { allow?: (p: string) => boolean } = {},
) => e.explain(parseQuery(text), path, { ...opts, ...over });

describe("explaining a search", () => {
	it("says how each word was read, and how many notes each kind of match reaches", () => {
		const x = explain(engine(), "walnut kiosk", null);
		expect(x.words.map((w) => w.word)).toEqual(["walnut", "kiosk"]);
		expect(x.words[0]?.notes.exact).toBe(3);
		expect(x.words[1]?.notes.exact).toBe(4);
		expect(x.words[0]?.prefix).toBe(false);
		expect(x.words[1]?.prefix).toBe(true);
		expect(x.note).toBeNull();
	});

	it("counts the notes that hold every word, and the list before the cut", () => {
		const x = explain(engine(), "walnut kiosk", null);
		expect(x.list.withAll).toBe(3);
		expect(x.list.total).toBe(3);
		expect(x.list.relaxed).toBe(false);
		expect(x.list.limit).toBe(50);
	});

	it("says when no note holds every word: the list is of notes with some", () => {
		const x = explain(engine(), "walnut zanzibar", null);
		expect(x.list.withAll).toBe(0);
		expect(x.list.relaxed).toBe(true);
		expect(x.list.total).toBeGreaterThan(0);
	});

	it("reads the last word as the start of longer words, and not the others", () => {
		const x = explain(engine(), "walnu kiosk", null);
		expect(x.words[0]?.prefix).toBe(false);
		const y = explain(engine(), "kiosk wal", null);
		expect(y.words[1]?.prefix).toBe(true);
		expect(y.words[1]?.notes.prefix).toBe(3);
	});

	it("tries typos only for a word the vault barely has", () => {
		const x = explain(engine(), "zanzibar kiosk", null);
		expect(x.words[0]?.typos).toBe(true);
		expect(x.words[0]?.rare).toBe(true);
		expect(x.words[1]?.typos).toBe(false);
		const typo = explain(engine(), "zanzibr", null);
		expect(typo.words[0]?.typos).toBe(true);
		expect(typo.words[0]?.notes.typo).toBe(1);
	});

	it("counts word forms when stemming reaches them", () => {
		const x = explain(engine(), "trip ", null);
		expect(x.words[0]?.notes.form).toBe(1);
	});
});

describe("explaining a note in a search", () => {
	it("gives the rank and score the real search gives, for every note it lists", () => {
		const e = engine();
		for (const q of ["walnut kiosk", "kiosk", "walnut zanzibar", "trip", "build kiosk walnut"]) {
			const hits = e.query(parseQuery(q), { limit: 50, now: NOW }).hits;
			for (const [i, h] of hits.entries()) {
				const x = explain(e, q, h.path);
				expect(x.note?.rank, `${q} ${h.path}`).toBe(i + 1);
				expect(x.note?.score, `${q} ${h.path}`).toBe(h.score);
				// The words it holds: the same count the engine matched.
				expect(x.note?.matched, `${q} ${h.path}`).toBe(h.matched);
			}
		}
	});

	it("says where each word is in the note: name, other fields, body", () => {
		const x = explain(engine(), "walnut kiosk", "Projects/Walnut kiosk pilot.md");
		const w = x.words.find((f) => f.word === "walnut")?.inNote;
		expect(w?.name).toBe(true);
		// The heading line is part of the body too: the word is in it twice.
		expect(w?.body).toBe(2);
		expect(x.words.find((f) => f.word === "kiosk")?.inNote?.body).toBe(2);
		expect(x.note?.matched).toBe(2);
		expect(x.note?.rank).toBe(1);
		expect(x.note?.factors?.name).toBe("start");
	});

	it("explains a note left out because another note holds every word", () => {
		const x = explain(engine(), "walnut kiosk", "Projects/Kiosk rollout.md");
		expect(x.list.withAll).toBe(3);
		expect(x.note?.indexed).toBe(true);
		expect(x.note?.rank).toBeNull();
		expect(x.note?.matched).toBe(1);
		expect(x.words.find((f) => f.word === "walnut")?.inNote).toBeNull();
		expect(x.words.find((f) => f.word === "kiosk")?.inNote?.body).toBe(4);
	});

	it("says the note's multipliers: its name, how recent it is, who links to it", () => {
		const e = engine();
		const x = explain(e, "kiosk", "Projects/Kiosk cabinet build.md");
		const f = x.note?.factors;
		expect(f?.name).toBe("start");
		expect(f?.nameFactor).toBe(1.5);
		expect(f?.days).toBeCloseTo(14, 5);
		expect(f?.recency).toBeCloseTo(1 + 0.2 * Math.exp(-14 / 45), 6);
		expect(f?.partial).toBe(1);
	});

	it("scales a note by the share of words it holds when no note has them all", () => {
		const x = explain(engine(), "walnut zanzibar", "Journal/Rare find.md");
		expect(x.list.relaxed).toBe(true);
		expect(x.note?.factors?.partial).toBeCloseTo(0.25, 6);
	});

	it("says a note outside the allowed set is outside it", () => {
		const x = explain(engine(), "walnut kiosk", "Projects/Walnut kiosk pilot.md", {
			allow: (p) => !p.startsWith("Projects/"),
		});
		expect(x.note?.allowed).toBe(false);
		expect(x.note?.rank).toBeNull();
	});

	it("says a note that holds an excluded word is dropped for it", () => {
		const x = explain(engine(), "kiosk -cabinet", "Projects/Kiosk cabinet build.md");
		expect(x.note?.holdsExcluded).toEqual(["cabinet"]);
		expect(x.note?.rank).toBeNull();
		expect(x.excluded).toEqual(["cabinet"]);
	});

	it("says a note the index does not have is not indexed", () => {
		const x = explain(engine(), "kiosk", "Elsewhere/New note.md");
		expect(x.note?.indexed).toBe(false);
		expect(x.note?.rank).toBeNull();
	});

	it("says where a note stands when it is below the cut", () => {
		const many: NoteInput[] = Array.from({ length: 70 }, (_, i) =>
			note(`Notes/Note ${i}.md`, `kiosk ${"kiosk ".repeat(70 - i)}`, 200),
		);
		const x = explain(engine(many), "kiosk", "Notes/Note 69.md", { limit: 50 });
		expect(x.note?.rank).toBeGreaterThan(50);
		expect(x.list.total).toBe(70);
	});

	it("finds a note that is not yet in a frozen segment (changed since the index was saved)", () => {
		const e = engine();
		e.upsert(note("Inbox/Fresh.md", "A brand new kiosk idea.", 0));
		const x = explain(e, "kiosk", "Inbox/Fresh.md");
		expect(x.note?.indexed).toBe(true);
		expect(x.note?.rank).not.toBeNull();
	});

	it("reads the same index as a search: nothing it does changes the next search", () => {
		const e = engine();
		const before = JSON.stringify(e.query(parseQuery("walnut kiosk"), opts));
		explain(e, "walnut kiosk", "Projects/Kiosk rollout.md");
		expect(JSON.stringify(e.query(parseQuery("walnut kiosk"), opts))).toBe(before);
	});
});

describe("the search does not know about the explanation", () => {
	const src = readFileSync("src/engine/jet-engine.ts", "utf8");
	const body = src.slice(
		src.indexOf("	query(q: Query"),
		src.indexOf("	/**\n	 * Why a search lists what it does"),
	);

	it("the query code never mentions it", () => {
		expect(body).not.toMatch(/explain/i);
	});

	it("the multipliers it reports are the ones the query applies", () => {
		// If a multiplier changes in the query, the explanation's copy of it must change with it.
		const explainSrc = readFileSync("src/engine/explain.ts", "utf8");
		for (const lit of [
			"0.2 * Math.exp(-days / 45)",
			"0.08 * Math.log2(1 + ",
			"score *= 2",
			"score *= 1.5",
			"score *= 1.4",
		])
			expect(body, lit).toContain(lit);
		expect(explainSrc).toContain("0.2 * Math.exp(-days / 45)");
		expect(explainSrc).toContain("0.08 * Math.log2(1 + inLinks)");
		expect(explainSrc).toContain('kind === "exact" ? 2 : kind === "start" ? 1.5 : kind === "all" ? 1.4 : 1');
		expect(explainSrc).toContain("(hit.matched / n) ** 2");
	});
});
