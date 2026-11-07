import { describe, expect, it } from "vitest";
import { normalize, noTypos, tokenize } from "../src/engine/analyzer";

const notes = (s: string): string[] => tokenize(s, { parts: true });

describe("tokenize", () => {
	it("cuts runs of letters and digits and lower-cases them", () => {
		expect(tokenize("garden-plan, v2 Orchid")).toEqual(["garden", "plan", "v2", "orchid"]);
	});

	it("drops one-letter words but keeps digits", () => {
		expect(tokenize("a 7 I x go")).toEqual(["7", "go"]);
	});

	it("removes accents only when needed, so résumé matches resume", () => {
		expect(tokenize("Café résumé ÉLAN")).toEqual(["cafe", "resume", "elan"]);
		expect(tokenize("Größe Straße")).toEqual(["grosse", "strasse"]);
		expect(tokenize("Ελληνικά ΚΑΦΕ")).toEqual(["ελληνικα", "καφε"]);
		expect(normalize("Ñandú")).toBe("nandu");
	});

	it("adds compound parts for notes, not for queries", () => {
		expect(notes("NebulaSDK Atlas2026 camelCase")).toEqual([
			"nebulasdk",
			"nebula",
			"sdk",
			"atlas2026",
			"atlas",
			"2026",
			"camelcase",
			"camel",
			"case",
		]);
		expect(tokenize("NebulaSDK")).toEqual(["nebulasdk"]);
	});

	it("keeps words in any script", () => {
		expect(tokenize("Привет мир")).toEqual(["привет", "мир"]);
		expect(tokenize("Γειά σου")).toEqual(["γεια", "σου"]);
	});

	it("folds Arabic marks and letter variants, and peels the article for notes", () => {
		expect(tokenize("مُحَمَّد")).toEqual(["محمد"]);
		expect(tokenize("أحمد")).toEqual(tokenize("احمد"));
		expect(notes("المشروع")).toEqual(["المشروع", "مشروع"]);
		expect(notes("والكتاب")).toEqual(["والكتاب", "كتاب"]);
	});

	it("cuts Chinese and Japanese into two-character pairs", () => {
		expect(tokenize("语音模型")).toEqual(["语音", "音模", "模型"]);
		expect(tokenize("東京")).toEqual(["東京"]);
		expect(tokenize("会")).toEqual(["会"]);
		expect(tokenize("コンピューター")).toEqual(["コン", "ンピ", "ピュ", "ュー", "ータ", "ター"]);
		expect(tokenize("新しいAPIの設計")).toEqual(["新し", "しい", "api", "の設", "設計"]);
	});

	it("segments Thai with the word segmenter", () => {
		const t = tokenize("สวัสดีครับ");
		expect(t.length).toBeGreaterThan(1);
		expect(t.join("")).toBe("สวัสดีครับ");
	});

	it("says which terms take no typos", () => {
		expect(noTypos("语音")).toBe(true);
		expect(noTypos("orchid")).toBe(false);
	});
});
