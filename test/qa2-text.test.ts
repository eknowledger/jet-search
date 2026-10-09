/**
 * QA, text analysis and matching across languages: the analyzer, stemmers, typos,
 * Tier 0 folding and names, excerpts and phrases, and what goes in each field. Every test here fails
 * on the code as it is, for the reason its name gives.
 * Tests with several symptoms of one cause check them all (expect.soft), so a partial fix still fails.
 */
import { describe, expect, it, vi } from "vitest";
import { fieldsFromMarkdown, type NoteInput } from "../src/engine/fields";
import { JetEngine } from "../src/engine/jet-engine";
import { parseQuery } from "../src/engine/query";
import { cutExcerpt, hasPhrase } from "../src/excerpt/excerpt";
import { NameIndex } from "../src/tier0/names";

const note = (path: string, text: string): NoteInput => ({ path, mtime: 0, ...fieldsFromMarkdown(path, text) });
/** Notes that share no word with the tests, so idf and the typo gate behave as in a real vault. */
const FILLER = [note("x/one.md", "nothing here"), note("x/two.md", "other words"), note("x/three.md", "more text")];
const engine = (notes: NoteInput[]): JetEngine => {
	const e = new JetEngine();
	e.build([...notes, ...FILLER]);
	return e;
};
/** Paths found for a query, as the worker runs it (default settings: English word forms only). */
const found = (notes: NoteInput[], query: string): string[] =>
	engine(notes)
		.query(parseQuery(query), { now: 0 })
		.hits.map((h) => h.path);
const names = (list: string[]): NameIndex =>
	new NameIndex(list.map((name, i) => ({ id: i + 1, name, aliases: [], path: `${name}.md` })));

// ── High ───────────────────────────────────────────────────────────────────────

describe("a quoted phrase that starts with a character outside the Basic Plane loops forever", () => {
	it("hasPhrase answers for '\"𠮷田 部長\"' on a note with 𠮷田 not followed by 部長 (it never returns)", () => {
		// The loop is endless (Obsidian's main thread freezes in filterPhrases); a guard on the regular
		// expression steps turns it into a failure here instead of a hung test run.
		const exec = RegExp.prototype.exec;
		let steps = 0;
		const guard = vi.spyOn(RegExp.prototype, "exec").mockImplementation(function (this: RegExp, s: string) {
			if (++steps > 100_000) throw new Error("stuck: 100,000 regular expression steps on a one-line note");
			return exec.call(this, s);
		});
		try {
			// 𠮷 (U+20BB7) is the usual spelling in 𠮷田 (Yoshida) and 𠮷野家 (Yoshinoya).
			expect.soft(() => hasPhrase("𠮷田さんと部長の会議", "𠮷田 部長")).not.toThrow();
			steps = 0;
			expect.soft(() => hasPhrase("𠮷野家で食べた。𠮷野家 渋谷店に行った", "𠮷野家 渋谷店")).not.toThrow();
			// Excerpts and the hit list loop the same way on a letter outside the Basic Plane inside a word.
			steps = 0;
			expect.soft(() => cutExcerpt("𞤀𞤢𞤤 𞤢𞤤", ["𞤢𞤤"])).not.toThrow();
		} finally {
			guard.mockRestore();
		}
	});
});

describe("words written with a hyphen or a dot are not found when typed joined", () => {
	it("'email' finds the body text 'e-mail' (as the instant name matching already does)", () => {
		// The instant name matching joins across the hyphen: this already works.
		expect(
			names(["E-mail templates"])
				.match("email")
				.map((h) => h.text),
		).toEqual(["E-mail templates"]);
		expect.soft(found([note("a.md", "Send the e-mail today")], "email ")).toEqual(["a.md"]);
		expect.soft(found([note("a.md", "The Wi-Fi password is on the fridge")], "wifi ")).toEqual(["a.md"]);
		expect.soft(found([note("a.md", "COVID-19 vaccine appointment")], "covid19 ")).toEqual(["a.md"]);
		expect.soft(found([note("a.md", "The site is built with Node.js")], "nodejs ")).toEqual(["a.md"]);
		// And the other way round: typing the hyphen finds the joined spelling.
		expect.soft(found([note("a.md", "Send the email today")], "e-mail ")).toEqual(["a.md"]);
	});
});

describe("letters that NFKD does not split are not folded (œ æ ø ł đ ı)", () => {
	it("'coeur' finds 'cœur', 'oeuvre' finds 'œuvre', 'isik' finds 'ışık', 'ışık' finds 'IŞIK'", () => {
		expect.soft(found([note("a.md", "Le cœur a ses raisons")], "coeur ")).toEqual(["a.md"]);
		expect.soft(found([note("a.md", "Une œuvre majeure du siècle")], "oeuvre ")).toEqual(["a.md"]);
		expect.soft(found([note("a.md", "Æsthetic choices in the design")], "aesthetic ")).toEqual(["a.md"]);
		expect.soft(found([note("a.md", "Ferry to Øresund")], "oresund ")).toEqual(["a.md"]);
		expect.soft(found([note("a.md", "Wyjazd do Łodzi w maju")], "lodzi ")).toEqual(["a.md"]);
		expect.soft(found([note("a.md", "Con đường này dài")], "duong ")).toEqual(["a.md"]);
		expect.soft(found([note("a.md", "Odada ışık yok")], "isik ")).toEqual(["a.md"]);
		// Turkish: the word typed exactly as written does not find its upper-case form.
		expect.soft(found([note("a.md", "## IŞIK AYARLARI")], "ışık ")).toEqual(["a.md"]);
	});
});

describe("English word forms are missed when the stem has three letters", () => {
	it("'use' finds 'using', 'try' finds 'trying', 'fly' finds 'flying', 'sky' finds 'skies'", () => {
		expect.soft(found([note("a.md", "I am using the new tool")], "use ")).toEqual(["a.md"]);
		expect.soft(found([note("a.md", "Still trying to fix the build")], "try ")).toEqual(["a.md"]);
		expect.soft(found([note("a.md", "We are flying tomorrow")], "fly ")).toEqual(["a.md"]);
		expect.soft(found([note("a.md", "The aging servers need care")], "age ")).toEqual(["a.md"]);
		expect.soft(found([note("a.md", "Clear skies all week")], "sky ")).toEqual(["a.md"]);
		expect.soft(found([note("a.md", "I will try again later")], "trying ")).toEqual(["a.md"]);
	});
});

// ── Medium ─────────────────────────────────────────────────────────────────────

describe("an English word inside Thai text without spaces is not indexed", () => {
	it("'python' finds ฉันใช้Pythonเขียนโปรแกรม ('I use Python to write programs')", () => {
		const notes = [note("a.md", "ฉันใช้Pythonเขียนโปรแกรม")];
		expect.soft(found(notes, "python ")).toEqual(["a.md"]);
		// The Thai words glued to it are lost too (the segmenter returns ใช้Pythonเขียน as one word).
		expect.soft(found(notes, "เขียน ")).toEqual(["a.md"]);
	});
});

describe("excluding a word that the analyzer cuts into several terms excludes each piece", () => {
	it("'工作 -北京大学' keeps notes about Beijing or a university that do not mention 北京大学", () => {
		const notes = [note("a.md", "我在北京工作"), note("b.md", "我在北京大学工作"), note("c.md", "我在大学工作")];
		expect.soft(found(notes, "工作 -北京大学").sort()).toEqual(["a.md", "c.md"]);
		expect
			.soft(found([note("a.md", "東京旅行の計画"), note("b.md", "東京タワー旅行の計画")], "計画 -東京タワー"))
			.toEqual(["a.md"]);
		// Latin text has the same cause: `-covid-19` excludes every note with the number 19.
		expect
			.soft(found([note("a.md", "Plan for 19 people"), note("b.md", "COVID-19 plan")], "plan -covid-19"))
			.toEqual(["a.md"]);
	});
});

describe("a Korean noun is not found with a particle or inside a compound", () => {
	it("'검색' finds 검색을 ('search' + object particle) and '엔진' finds 검색엔진", () => {
		expect.soft(found([note("a.md", "검색을 빠르게 합니다")], "검색 ")).toEqual(["a.md"]);
		expect.soft(found([note("a.md", "새 검색엔진 설계")], "엔진 ")).toEqual(["a.md"]);
	});
});

describe("an Arabic word typed with the article does not find it without", () => {
	it("'المكتبة' finds مكتبة and بالمكتبة with the default settings", () => {
		const notes = [note("a.md", "زرت مكتبة جديدة"), note("b.md", "ذهبت بالمكتبة أمس")];
		// The other way works: 'مكتبة' finds المكتبة (notes get an article-less form).
		expect(found([note("c.md", "ذهبت إلى المكتبة")], "مكتبة ")).toEqual(["c.md"]);
		expect(found(notes, "المكتبة ").sort()).toEqual(["a.md", "b.md"]);
	});
});

describe("the emoji variation selector (U+FE0F) is kept as if it were an accent", () => {
	it("'settings' is an exact match for '⚙️ Settings', and 'done' finds '✔️Done'", () => {
		const hits = names(["Settings backup", "⚙️ Settings"]).match("settings");
		expect.soft(hits[0]?.text).toBe("⚙️ Settings");
		expect.soft(hits.find((h) => h.text === "⚙️ Settings")?.exact).toBe(true);
		expect.soft(found([note("a.md", "✔️Done with the quarterly report")], "done ")).toEqual(["a.md"]);
	});
});

describe("invisible joiners inside a word split it in the index (not in names)", () => {
	it("'donaudampfschiff' finds Donau\\u00ADdampf\\u00ADschiff, 'کتابها' finds کتاب\\u200Cها", () => {
		// Names join across the soft hyphens: this already works.
		expect(names(["Donau­dampf­schiff"]).match("donaudampfschiff")[0]?.exact).toBe(true);
		expect.soft(found([note("a.md", "Das Donau­dampf­schiff fährt")], "donaudampfschiff ")).toEqual(["a.md"]);
		expect.soft(found([note("a.md", "کتاب‌ها روی میز است")], "کتابها ")).toEqual(["a.md"]);
	});
});

describe("names written decomposed (NFD, half-width kana) are missed by the instant name matching", () => {
	it("'검색' finds an NFD Korean name and 'データ' an NFD or half-width Japanese one", () => {
		expect.soft(names(["검색 엔진".normalize("NFD")]).match("검색").length).toBe(1);
		expect.soft(names(["データ整理".normalize("NFD")]).match("データ").length).toBe(1);
		expect.soft(names(["ﾃﾞｰﾀ整理"]).match("データ").length).toBe(1);
		// The full-text index composes them, so the two tiers disagree on the same note.
		expect
			.soft(found([note("검색 엔진".normalize("NFD") + ".md", "")], "검색 "))
			.toEqual(["검색 엔진".normalize("NFD") + ".md"]);
	});
});

describe("quoted phrases and excerpts fail on decomposed Hangul and kana the index matched", () => {
	it("hasPhrase finds 검색 엔진 in NFD text, データ in NFD and half-width text; the excerpt marks them", () => {
		const ko = "검색 엔진을 만든다".normalize("NFD");
		// The index finds the note…
		expect(found([note("a.md", ko)], "검색 ")).toEqual(["a.md"]);
		// …but the phrase check (which drops notes from "quoted" results) and the excerpt do not.
		expect.soft(hasPhrase(ko, "검색 엔진")).toBe(true);
		expect.soft(cutExcerpt(ko, ["검색"])).not.toBeNull();
		expect.soft(hasPhrase("データの整理".normalize("NFD"), "データ")).toBe(true);
		expect.soft(hasPhrase("ﾃﾞｰﾀﾍﾞｰｽの設計", "データベース")).toBe(true);
		const ja = cutExcerpt("データの整理".normalize("NFD"), ["デー", "ータ"]);
		// The excerpt shows the text composed (as it looks); the whole word is marked.
		const jm = ja?.marks[0] ?? [0, 0];
		expect.soft(ja?.marks.length).toBe(1);
		expect.soft(ja?.text.slice(jm[0], jm[1])).toBe("データ");
	});
});

describe("Persian and Arabic forms of yeh and kaf are not folded together", () => {
	it("'علي' finds علی (Farsi yeh) and 'كتاب' finds کتاب (keheh)", () => {
		expect.soft(found([note("a.md", "علی به خانه رفت")], "علي ")).toEqual(["a.md"]);
		expect.soft(found([note("a.md", "این کتاب خوب است")], "كتاب ")).toEqual(["a.md"]);
		expect.soft(found([note("a.md", "كتاب جديد")], "کتاب ")).toEqual(["a.md"]);
	});
});

// ── Low ────────────────────────────────────────────────────────────────────────

describe("three-letter ligatures (ﬃ, ﬄ) defeat excerpts and phrases", () => {
	it("'office' gets an excerpt and a phrase match in text with the ﬃ ligature", () => {
		const text = "The oﬃce is closed on Friday";
		// The index finds it (NFKD) …
		expect(found([note("a.md", text)], "office ")).toEqual(["a.md"]);
		// … the excerpt and the phrase check do not.
		// The excerpt shows the ligature spelled out (as NFKC has it); the word is marked.
		const ex = cutExcerpt(text, ["office"]);
		const m = ex?.marks[0] ?? [0, 0];
		expect.soft(ex?.text.slice(m[0], m[1])).toBe("office");
		expect.soft(hasPhrase(text, "office is closed")).toBe(true);
	});
});

describe("Greek final sigma in upper-case names breaks the instant name matching", () => {
	it("'σημειώσεις' is an exact match for the name ΣΗΜΕΙΩΣΕΙΣ", () => {
		const hit = names(["ΣΗΜΕΙΩΣΕΙΣ"]).match("σημειώσεις")[0];
		expect(hit?.exact).toBe(true);
	});
});

describe("one Chinese character outside the Basic Plane is not found inside pairs", () => {
	it("'𨋢' (lift, Cantonese) finds 我哋坐𨋢上去 as '吉' finds 吉野家", () => {
		expect(found([note("b.md", "吉野家で食べた")], "吉 ")).toEqual(["b.md"]);
		expect(found([note("a.md", "我哋坐𨋢上去")], "𨋢 ")).toEqual(["a.md"]);
	});
});
