import { describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";
import { Explainer, type ExplainRequest } from "../src/explain/explainer";
import { fieldsFromMarkdown, type NoteInput } from "../src/engine/fields";
import { JetEngine } from "../src/engine/jet-engine";
import { parseQuery } from "../src/engine/query";
import type { JetClient } from "../src/worker/jet-client";

const NOW = Date.now();
const note = (path: string, text: string): NoteInput => ({
	path,
	mtime: NOW - 3 * 86_400_000,
	...fieldsFromMarkdown(path, text),
});

/** A client whose worker is a real engine, so the facts are real. */
const rig = (
	texts: Record<string, string>,
	over: { exclude?: string[]; progress?: { done: number; total: number } | null } = {},
) => {
	const engine = new JetEngine();
	engine.build(Object.entries(texts).map(([p, t]) => note(p, t)));
	const app = new App();
	for (const p of Object.keys(texts)) app.vault.files.set(p, new TFile(p));
	(app.vault as unknown as { cachedRead: (f: TFile) => Promise<string> }).cachedRead = (f) =>
		Promise.resolve(texts[f.path] ?? "");
	const asked: Array<Record<string, unknown>> = [];
	const client = {
		explain: (o: { text: string; path: string | null; limit: number; allow?: string[]; scope?: unknown }) => {
			asked.push(o);
			const allow = o.allow ? new Set(o.allow) : undefined;
			return Promise.resolve(
				engine.explain(parseQuery(o.text), o.path, {
					limit: o.limit,
					now: NOW,
					allow: allow ? (p) => allow.has(p) : undefined,
				}),
			);
		},
	} as unknown as JetClient;
	let ensured = 0;
	const explainer = new Explainer({
		app,
		client,
		ensure: () => {
			ensured++;
			return Promise.resolve();
		},
		progress: () => over.progress ?? null,
		excluded: () => over.exclude ?? [],
	});
	return { explainer, asked, ensured: () => ensured };
};

const req = (over: Partial<ExplainRequest> = {}): ExplainRequest => ({
	text: "walnut kiosk",
	mode: "words",
	filters: [],
	sort: "Best match",
	byRelevance: true,
	path: null,
	name: "",
	shown: null,
	inScope: null,
	narrowed: null,
	...over,
});

const texts = {
	"Projects/Walnut kiosk pilot.md": "walnut kiosk pilot notes",
	"Projects/Kiosk rollout.md": "the kiosk goes to six shops",
	"Private/Kiosk secrets.md": "walnut kiosk codes",
};

describe("the explainer", () => {
	it("opens the index first, then asks the worker once", async () => {
		const { explainer, asked, ensured } = rig(texts);
		const x = await explainer.run(req());
		expect(ensured()).toBe(1);
		expect(asked).toHaveLength(1);
		expect(x.note).toBeNull();
		expect(x.search.head).toMatch(/hold every word/);
	});

	it("explains a note left out for a missing word", async () => {
		const { explainer } = rig(texts);
		const x = await explainer.run(req({ path: "Projects/Kiosk rollout.md", name: "Kiosk rollout" }));
		expect(x.note?.head).toBe('Left out: it has "kiosk" but not "walnut".');
	});

	it("says a note in an exclude rule is left out by it", async () => {
		const { explainer } = rig(texts, { exclude: ["Private"] });
		const x = await explainer.run(req({ path: "Private/Kiosk secrets.md", name: "Kiosk secrets" }));
		expect(x.note?.head).toMatch(/exclude rule/);
	});

	it("passes the scope to the worker, or the notes the filters kept in its place", async () => {
		const a = rig(texts);
		await a.explainer.run(req({ scope: "s1" }));
		expect(a.asked[0]?.scope).toBe("s1");
		expect(a.asked[0]?.allow).toBeUndefined();
		const b = rig(texts);
		await b.explainer.run(req({ scope: "s1", narrowed: new Set(["Projects/Walnut kiosk pilot.md"]) }));
		expect(b.asked[0]?.scope).toBeUndefined();
		expect(b.asked[0]?.allow).toEqual(["Projects/Walnut kiosk pilot.md"]);
	});

	it("says a note outside the scope is outside it, and one the filters drop is dropped by them", async () => {
		const { explainer } = rig(texts);
		const inside = new Set(["Projects/Walnut kiosk pilot.md"]);
		const x = await explainer.run(
			req({ path: "Projects/Kiosk rollout.md", name: "Kiosk rollout", scope: "s1", inScope: inside }),
		);
		expect(x.note?.head).toMatch(/outside the scope/);
		const y = await explainer.run(
			req({ path: "Projects/Kiosk rollout.md", name: "Kiosk rollout", narrowed: inside }),
		);
		expect(y.note?.head).toMatch(/filters do not keep/);
	});

	it("says a note without the quoted phrase is left out for it", async () => {
		const { explainer } = rig({ "A.md": "walnut here and kiosk there", "B.md": "walnut kiosk together" });
		const x = await explainer.run(req({ text: '"walnut kiosk"', path: "A.md", name: "A" }));
		expect(x.note?.head).toBe("Left out: it does not hold the quoted phrase.");
		const y = await explainer.run(req({ text: '"walnut kiosk"', path: "B.md", name: "B" }));
		expect(y.note?.tone).toBe("ok");
	});

	it("says the index is still being built, for a note it does not have yet", async () => {
		const { explainer } = rig(texts, { progress: { done: 10, total: 100 } });
		const x = await explainer.run(req({ path: "Elsewhere/New.md", name: "New" }));
		expect(x.note?.head).toBe("Left out: Jet has not indexed this note yet.");
		expect(x.note?.detail).toMatch(/10 of 100/);
	});

	it("gives report lines with tags for the words and the note, and the words only when allowed", async () => {
		const { explainer } = rig(texts);
		const x = await explainer.run(req({ path: "Projects/Kiosk rollout.md", name: "Kiosk rollout" }));
		const tagged = x.lines(false).join("\n");
		expect(tagged).not.toMatch(/walnut|kiosk|rollout/i);
		expect(tagged).toContain("word#");
		expect(x.lines(true).join("\n")).toContain('search "walnut kiosk"');
		expect(x.lines(true).join("\n")).toContain('"walnut"');
	});
});
