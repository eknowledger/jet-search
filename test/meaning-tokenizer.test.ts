import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { basicTokens, tokenize, wordPiece } from "../src/meaning/tokenizer";

const FIXTURE = JSON.parse(readFileSync(join(__dirname, "fixtures/potion-base-8M.json"), "utf8")) as {
	sentences: string[];
	ids: number[][];
};
// The model's own tokenizer.json, when it is on this machine (it is not in the repo).
const TOKENIZER = process.env.JET_TOKENIZER ?? "models/minishlab/potion-base-8M/tokenizer.json";

describe("BERT WordPiece", () => {
	it("normalizes like BertNormalizer and splits like BertPreTokenizer", () => {
		expect(basicTokens("Café crème, naïve!")).toEqual(["cafe", "creme", ",", "naive", "!"]);
		// Accents go as BERT strips them: the dakuten of で too.
		expect(basicTokens("東京で")).toEqual(["東", "京", "て"]);
		expect(basicTokens("  a\tb\nc  ")).toEqual(["a", "b", "c"]);
		expect(basicTokens("don't")).toEqual(["don", "'", "t"]);
	});

	it("longest pieces first, ## inside a word, unknown when any part is", () => {
		const v = new Map([
			["[UNK]", 1],
			["play", 2],
			["##ing", 3],
			["##s", 4],
			["un", 5],
			["##play", 6],
		]);
		expect(wordPiece("playing", v, 1)).toEqual([2, 3]);
		expect(wordPiece("unplays", v, 1)).toEqual([5, 6, 4]);
		expect(wordPiece("xyz", v, 1)).toEqual([1]);
		expect(wordPiece("p".repeat(101), v, 1)).toEqual([1]);
	});

	it.skipIf(!existsSync(TOKENIZER))("gives Hugging Face's ids for the fixture sentences", () => {
		const t = JSON.parse(readFileSync(TOKENIZER, "utf8")) as { model: { vocab: Record<string, number> } };
		const vocab = new Map(Object.entries(t.model.vocab));
		const unk = vocab.get("[UNK]") ?? 1;
		FIXTURE.sentences.forEach((s, i) => expect(tokenize(s, vocab, unk)).toEqual(FIXTURE.ids[i]));
	});
});
