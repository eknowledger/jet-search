import { describe, expect, it } from "vitest";
import type { RawNote } from "../src/engine/fields";
import type { AnswerPoolReply, AnswersReply } from "../src/worker/protocol";
import { Router } from "../src/worker/router";
import { memoryStore } from "../src/worker/store";

const timers = {
	set: (fn: () => void, ms: number) => setTimeout(fn, ms),
	clear: (h: unknown) => clearTimeout(h as number),
};
const raw = (path: string, text: string): RawNote => ({
	path,
	mtime: 1000,
	text,
	bodyStart: 0,
	aliases: [],
	headings: [],
	tags: [],
	links: [],
	inLinks: 0,
});
const NOTES = [
	raw("Handoff.md", "# Handoff\n## Sales\n- Kiosk screens are ~20-30% of the sales\n- Unrelated planning line"),
	raw("Sync.md", "The kiosk team met about the sales and the kiosk plan."),
	raw("Lunch.md", "Soup and bread for lunch."),
];

const router = async (): Promise<Router> => {
	const r = new Router(() => memoryStore(), timers);
	await r.handle({ op: "open", vaultId: "v", stemming: ["en"] });
	await r.handle({ op: "batch", notes: NOTES, last: true });
	return r;
};

describe("answers in the worker (experiment)", () => {
	it("pools the notes with some of the question's content words, inside the allowed ones", async () => {
		const r = await router();
		const pool = (await r.handle({
			op: "answers:pool",
			text: "what share of the kiosk sales has screens?",
			k: 10,
		})) as AnswerPoolReply;
		expect(pool.words).toContain("Handoff.md");
		expect(pool.words).toContain("Sync.md");
		expect(pool.words).not.toContain("Lunch.md");
		// Meaning is off: no list by meaning.
		expect(pool.meaning).toEqual([]);
		const inside = (await r.handle({
			op: "answers:pool",
			text: "what share of the kiosk sales has screens?",
			k: 10,
			allow: ["Sync.md"],
		})) as AnswerPoolReply;
		expect(inside.words).toEqual(["Sync.md"]);
	});

	it("re-ranks the notes sent by their best line and gives the order to show", async () => {
		const r = await router();
		const reply = (await r.handle({
			op: "answers:rank",
			seq: 7,
			text: "what share of the kiosk sales has screens?",
			notes: [
				{ path: "Sync.md", title: "Sync", text: NOTES[1]?.text ?? "", bodyStart: 0, from: "words" },
				{ path: "Handoff.md", title: "Handoff", text: NOTES[0]?.text ?? "", bodyStart: 0, from: "both" },
			],
			meaning: [],
		})) as AnswersReply;
		expect(reply.seq).toBe(7);
		expect(reply.order[0]).toBe("Handoff.md");
		expect(reply.ranked[0]?.line?.text).toBe("- Kiosk screens are ~20-30% of the sales");
		expect(reply.ranked[0]?.from).toBe("both");
	});
});
