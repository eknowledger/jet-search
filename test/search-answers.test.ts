import { describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";
import { normalizeData } from "../src/data";
import type { Feeder } from "../src/index/feeder";
import type { Entry } from "../src/modal/jet-modal";
import { Search } from "../src/search";
import type { JetClient } from "../src/worker/jet-client";
import type { AnswersReply } from "../src/worker/protocol";

type Item = Extract<Entry, { type: "item" }>;
/** Past the pause before answers are looked for, and the promises after it. */
const settle = async (): Promise<void> => {
	await new Promise((r) => setTimeout(r, 300));
	for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

const TEXTS: Record<string, string> = {
	"Handoff.md": "---\ntype: doc\n---\n## Sales\n- **Kiosk screens** are ~20-30% of the sales\n",
	"Sync.md": "The kiosk team met about the sales.\n",
	"Ideas.md": "Ideas for the kiosk.\n",
};

/** Words find Sync and Handoff; meaning finds Ideas and Handoff; the re-rank puts Handoff first. */
const setup = (answersOn = true) => {
	const app = new App();
	const files = (app.vault as unknown as { files: Map<string, TFile> }).files;
	for (const p of Object.keys(TEXTS)) files.set(p, new TFile(p));
	(app.vault as unknown as { cachedRead: (f: TFile) => Promise<string> }).cachedRead = async (f) =>
		TEXTS[f.path] ?? "";
	const caches = (app.metadataCache as unknown as { caches: Map<string, unknown> }).caches;
	caches.set("Handoff.md", { frontmatterPosition: { end: { offset: TEXTS["Handoff.md"]?.indexOf("## Sales") } } });
	const sent: { notes?: Array<{ path: string; bodyStart: number; from: string }>; meaning?: string[] } = {};
	const client = {
		query: async () => ({
			seq: 1,
			terms: ["kiosk"],
			hits: ["Sync.md", "Handoff.md"].map((path) => ({ path, score: 1, matched: 1, edits: 0 })),
			ms: 0,
		}),
		nearest: async () => ({
			seq: 1,
			near: ["Ideas.md", "Handoff.md"].map((path) => ({ path, score: 0.5 })),
			ms: 0,
		}),
		answerPool: async () => ({ words: ["Sync.md", "Handoff.md"], meaning: ["Ideas.md", "Handoff.md"] }),
		answers: async (_t: string, notes: typeof sent.notes, meaning: string[]): Promise<AnswersReply> => {
			sent.notes = notes;
			sent.meaning = meaning;
			const line = TEXTS["Handoff.md"]?.match(/- \*\*Kiosk.*$/m)?.[0] ?? "";
			return {
				seq: 1,
				ms: 1,
				order: ["Handoff.md", "Sync.md", "Ideas.md"],
				ranked: [
					{
						path: "Handoff.md",
						score: 3,
						cover: 0.9,
						from: "both",
						line: { text: line, heading: "Sales", offset: TEXTS["Handoff.md"]?.indexOf(line) ?? 0 },
					},
					{ path: "Sync.md", score: 1, cover: 0.3, from: "words", line: null },
					{ path: "Ideas.md", score: 0.5, cover: 0.1, from: "meaning", line: null },
				],
			};
		},
	} as unknown as JetClient;
	const feeder = {
		progress: null,
		meaningProgress: null,
		ensure: () => Promise.resolve(),
		ensureMeaning: () => Promise.resolve(),
	} as unknown as Feeder;
	const data = normalizeData(null);
	data.indexedAt = 1;
	data.settings.answers = answersOn;
	return { s: new Search(app, client, feeder, () => data), sent };
};

describe("answers in the search (experiment)", () => {
	it("re-ranks a question asked both ways by its lines, shows each line, and paints nothing older after", async () => {
		const { s, sent } = setup();
		const paints: Entry[][] = [];
		s.list("what share of the kiosk sales has screens?", (e) => paints.push(e), undefined, [], {
			on: true,
			offered: false,
			both: true,
		});
		await settle();
		const last = paints.at(-1) ?? [];
		expect(last[0]).toMatchObject({ type: "header", label: "Answers", answers: true, count: 3 });
		const items = last.filter((e): e is Item => e.type === "item");
		expect(items.map((i) => i.path)).toEqual(["Handoff.md", "Sync.md", "Ideas.md"]);
		expect(items.map((i) => i.badge)).toEqual(["both", "by words", "by meaning"]);
		const first = items[0];
		expect(first?.excerpt?.text).toBe("Kiosk screens are ~20-30% of the sales");
		const nums = first?.answer?.nums ?? [];
		expect(nums.map(([a, b]) => first?.excerpt?.text.slice(a, b))).toEqual(["~20-30%"]);
		expect(first?.answer?.cover).toBe(0.9);
		expect(first?.hit?.offset).toBe(TEXTS["Handoff.md"]?.indexOf("- **Kiosk"));
		// The notes went to the worker with their text, where their body starts, and which list had them.
		expect(sent.notes?.map((n) => [n.path, n.from])).toEqual([
			["Sync.md", "words"],
			["Handoff.md", "both"],
			["Ideas.md", "meaning"],
		]);
		expect(sent.notes?.find((n) => n.path === "Handoff.md")?.bodyStart).toBe(
			TEXTS["Handoff.md"]?.indexOf("## Sales"),
		);
		expect(sent.meaning).toEqual(["Ideas.md", "Handoff.md"]);
		// Nothing older paints over the answers.
		const at = paints.findIndex((p) => p[0]?.type === "header" && p[0].answers);
		expect(at).toBe(paints.length - 1);
	});

	it("leaves a search by words, a search that is not a question, and the experiment turned off alone", async () => {
		for (const [text, meaning, on] of [
			["what share of the kiosk sales has screens?", { on: false, offered: true }, true],
			["kiosk sales screens", { on: true, offered: false }, true],
			["what share of the kiosk sales has screens?", { on: true, offered: false, both: true }, false],
		] as const) {
			const { s } = setup(on);
			const paints: Entry[][] = [];
			s.list(text, (e) => paints.push(e), undefined, [], meaning);
			await settle();
			expect(paints.some((p) => p.some((e) => e.type === "header" && e.answers))).toBe(false);
		}
	});
});
