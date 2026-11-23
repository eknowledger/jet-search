import { afterEach, describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";
import { normalizeData } from "../src/data";
import { FilterSets } from "../src/filters/sets";
import { JetHost } from "../src/host";
import { Explainer, type ExplainRequest } from "../src/explain/explainer";
import { SUGGESTIONS } from "../src/modal/explain-pane";
import type { Search } from "../src/search";
import type { JetClient } from "../src/worker/jet-client";

afterEach(() => document.body.replaceChildren());

describe("the note finder of the Explain pane", () => {
	it("hands over no more notes than the pane draws", () => {
		const app = new App();
		for (let i = 0; i < 12; i++) app.vault.files.set(`Race ${i}.md`, new TFile(`Race ${i}.md`));
		const host = new JetHost(
			app as never,
			() => normalizeData(null),
			() => {},
			() => false,
			() => ({}) as Search,
			undefined,
			undefined,
			new FilterSets(app as never),
			{} as Explainer,
		);
		expect(host.explain?.find("race")).toHaveLength(SUGGESTIONS);
	});
});

const req = (over: Partial<ExplainRequest> = {}): ExplainRequest => ({
	text: "walnut kiosk",
	mode: "words",
	filters: [{ kind: "title" } as never],
	sort: "Best match",
	byRelevance: true,
	path: null,
	name: "",
	shown: null,
	inScope: null,
	narrowed: null,
	...over,
});

describe("explaining a Title only search", () => {
	const rig = () => {
		let asked = 0;
		const client = {
			explain: () => {
				asked++;
				throw new Error("the text index must not be asked");
			},
		} as unknown as JetClient;
		const app = new App();
		app.vault.files.set("Kiosk.md", new TFile("Kiosk.md"));
		const explainer = new Explainer({
			app: app as never,
			client,
			ensure: () => Promise.resolve(),
			progress: () => null,
			excluded: () => ["Private"],
		});
		return { explainer, asked: () => asked };
	};

	it("does not ask the text index, and says only names were searched", async () => {
		const { explainer, asked } = rig();
		const x = await explainer.run(req());
		expect(asked()).toBe(0);
		expect(x.search.head).toBe("Title only is on: only note names are searched.");
		expect(x.search.detail).toMatch(/not their text/);
	});

	it("still says an exclude rule leaves a note out, and otherwise that the text is not looked at", async () => {
		const { explainer } = rig();
		const out = await explainer.run(req({ path: "Private/Kiosk.md", name: "Kiosk" }));
		expect(out.note?.head).toMatch(/exclude rule/);
		const plain = await explainer.run(req({ path: "Kiosk.md", name: "Kiosk" }));
		expect(plain.note?.head).toBe("Title only is on: only note names are searched.");
		expect(plain.lines(false).join("\n")).toMatch(/Title only is on/);
	});
});
