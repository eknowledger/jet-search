import { describe, expect, it } from "vitest";
import {
	type AnswerCandidate,
	answerKind,
	answerOrder,
	answerShapes,
	contentTerms,
	fuseOrders,
	linesOf,
	questionWordSpans,
	rankAnswers,
	SURE_COVER,
} from "../src/answers/answers";

/** Rarity as a vault of 1,000 notes would have it: the words named here are rare, the rest common. */
const rare = (words: Record<string, number>) => ({
	rarity: async (terms: readonly string[]) => ({ notes: 1000, df: terms.map((t) => words[t] ?? 400) }),
});
const note = (path: string, text: string, from: AnswerCandidate["from"] = "words"): AnswerCandidate => ({
	path,
	title: path.replace(/\.md$/, ""),
	text,
	bodyStart: 0,
	from,
});

describe("a note's lines (answers experiment)", () => {
	it("reads list items, table rows and sentences, each with its heading and where it starts", () => {
		const text = [
			"Intro line that is long enough.",
			"## Sales",
			"- Walk-in customers are 70% of the sales",
			"| Order | Share |",
			"|---|---|",
			"| Screens | 20-30% |",
			"```",
			"code that is not prose at all",
			"```",
			`${"A first sentence about rollout. ".repeat(14)}The last sentence says 5% first.`,
		].join("\n");
		const lines = linesOf(text);
		expect(lines.map((l) => l.text)).toContain("- Walk-in customers are 70% of the sales");
		expect(lines.map((l) => l.text)).not.toContain("code that is not prose at all");
		expect(lines.map((l) => l.text)).not.toContain("|---|---|");
		const share = lines.find((l) => l.text.includes("Screens"));
		expect(share?.heading).toBe("Sales");
		expect(text.slice(share?.offset, (share?.offset ?? 0) + 9)).toBe("| Screens");
		// A long paragraph is cut at its sentences, each found where it is.
		const last = lines.find((l) => l.text.startsWith("The last sentence"));
		expect(last && text.slice(last.offset, last.offset + 8)).toBe("The last");
		expect(lines[0]?.heading).toBe("");
	});

	it("starts at the body: the properties are not lines", () => {
		const text = "---\nsummary: a summary that is long\n---\nThe body line is here.";
		const lines = linesOf(text, text.indexOf("The body"));
		expect(lines.map((l) => l.text)).toEqual(["The body line is here."]);
		expect(lines[0]?.offset).toBe(text.indexOf("The body"));
	});
});

describe("what a question asks for", () => {
	it("keeps the words that name the answer, as the index reads them", () => {
		expect(contentTerms("What is the percentage of online orders scoped for Atlas?")).toEqual([
			"percentage",
			"online",
			"orders",
			"scoped",
			"atlas",
		]);
	});

	it("knows a number, a name, a date or a reason is wanted, and the shape of the answer", () => {
		expect(answerKind("what share of traffic goes through the kiosk?")).toBe("number");
		expect(answerKind("who owns the billing service?")).toBe("who");
		expect(answerKind("when is the launch?")).toBe("when");
		expect(answerKind("why did the build fail?")).toBe("why");
		expect(answerKind("how do we handle delays mid-shift")).toBeNull();
		const pct = answerShapes("what percentage of orders are walk-in?");
		expect(pct.some((r) => r.test("about 70% of them"))).toBe(true);
		const ms = answerShapes("what is the latency of the first call?");
		expect(ms.some((r) => r.test("adds 200 ms"))).toBe(true);
	});
});

describe("re-ranking notes by their best line", () => {
	it("puts first the note whose line holds the rare words and the answer's shape, and shows that line", async () => {
		const notes = [
			// Many common words of the question, no answer.
			note("Weekly sync.md", "The orders team talked about orders scoped for the release.\nDevices again."),
			note(
				"Handoff.md",
				[
					"# Handoff",
					"## Key numbers",
					"- Sales: online screens are ~20-30% of orders",
					"- Other line here",
				].join("\n"),
			),
		];
		const r = await rankAnswers(
			"what is the percentage of online orders scoped?",
			notes,
			rare({ online: 3, percentage: 40 }),
		);
		expect(r[0]?.path).toBe("Handoff.md");
		expect(r[0]?.line?.text).toBe("- Sales: online screens are ~20-30% of orders");
		expect(r[0]?.line?.heading).toBe("Key numbers");
		expect(r[0]?.cover).toBeGreaterThan(0);
		expect(r[0]?.from).toBe("words");
	});

	it("meets a word's other forms (orders, order) and counts the heading's words for less", async () => {
		const notes = [
			note("A.md", "## Rollout plan\n- The order count is 40 by spring"),
			note("B.md", "## Notes\n- The order count is 40 by spring"),
		];
		const r = await rankAnswers("how many orders in the rollout?", notes, rare({ rollout: 5, orders: 20 }));
		expect(r[0]?.path).toBe("A.md");
		expect(r.every((x) => x.line?.text.includes("order count"))).toBe(true);
	});

	it("counts the title as a line when no line answers", async () => {
		const r = await rankAnswers(
			"what is the gamma budget?",
			[note("Other.md", "Nothing related to the question here."), note("Gamma budget.md", "Just a stub.")],
			rare({ gamma: 2, budget: 30 }),
		);
		expect(r[0]?.path).toBe("Gamma budget.md");
		expect(r[0]?.line).toBeNull();
		expect(r[0]?.cover).toBe(1);
	});

	it("weighs each note's best lines by the model's closeness, in one call", async () => {
		let calls = 0;
		const notes = [
			note("Near.md", "- kiosk capacity is 120 TPS in total"),
			note("Far.md", "- kiosk capacity is 120 TPS in total!"),
		];
		const deps = {
			...rare({ kiosk: 5, capacity: 9 }),
			closeness: async (_q: string, lines: readonly string[]) => {
				calls++;
				return lines.map((l) => (l.endsWith("!") ? 0.9 : 0.1));
			},
		};
		const r = await rankAnswers("what is the kiosk capacity?", notes, deps);
		expect(calls).toBe(1);
		expect(r[0]?.path).toBe("Far.md");
	});

	it("keeps the first order for ties, and answers a question with no content words with nothing", async () => {
		const notes = [note("One.md", "- same line about kiosks"), note("Two.md", "- same line about kiosks")];
		const r = await rankAnswers("what about kiosks?", notes, rare({ kiosks: 4 }));
		expect(r.map((x) => x.path)).toEqual(["One.md", "Two.md"]);
		const none = await rankAnswers("what is it?", notes, rare({}));
		expect(none.every((x) => x.line === null && x.score === 0)).toBe(true);
	});

	it("reads a note again when its text changed", async () => {
		const q = "what is the kiosk quota?";
		const deps = rare({ kiosk: 4, quota: 4 });
		const first = await rankAnswers(q, [note("N.md", "- the kiosk quota is 10 per day")], deps);
		expect(first[0]?.line?.text).toContain("10 per day");
		const again = await rankAnswers(q, [note("N.md", "- the kiosk quota is 20 per day")], deps);
		expect(again[0]?.line?.text).toContain("20 per day");
	});
});

describe("the words a row marks", () => {
	it("marks only the forms of the question's words that counted", () => {
		const text = "Keyboard keys: the key orders";
		const spans = questionWordSpans("which key orders?", text).map(([a, b]) => text.slice(a, b));
		expect(spans).toEqual(["keys", "key", "orders"]);
	});
});

describe("a re-rank no longer wanted", () => {
	it("pauses between slices of notes and stops with nothing when told", async () => {
		const notes = Array.from({ length: 20 }, (_, i) => note(`N${i}.md`, `- kiosk line ${i} here`));
		let pauses = 0;
		const r = await rankAnswers("what about kiosks?", notes, {
			...rare({ kiosks: 4 }),
			pause: async () => ++pauses >= 2,
		});
		expect(r).toBeNull();
		expect(pauses).toBe(2);
		const all = await rankAnswers("what about kiosks?", notes, {
			...rare({ kiosks: 4 }),
			pause: async () => false,
		});
		expect(all).toHaveLength(20);
	});
});

describe("the order shown", () => {
	const ranked = (paths: string[], cover: number) =>
		paths.map((path, i) => ({ path, score: 10 - i, line: null, cover, from: "words" as const }));

	it("is the lines' for a fact question or a sure first line, fused with meaning's otherwise", () => {
		const meaning = ["M.md", "B.md"];
		expect(answerOrder("how much does it cost?", ranked(["A.md", "B.md"], 0.2), meaning)).toEqual(["A.md", "B.md"]);
		expect(answerOrder("kiosk design choices", ranked(["A.md", "B.md"], SURE_COVER), meaning)).toEqual([
			"A.md",
			"B.md",
		]);
		expect(answerOrder("kiosk design choices", ranked(["A.md", "B.md"], 0.3), meaning)).toEqual(
			fuseOrders([["A.md", "B.md"], meaning]),
		);
		expect(fuseOrders([["A.md", "B.md"], meaning])[0]).toBe("B.md");
	});
});
