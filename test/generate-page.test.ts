import { describe, expect, it } from "vitest";
import { App } from "obsidian";
import type { NoteFacts } from "../src/scopes/members";
import type { Scope } from "../src/scopes/model";
import { emptyConfig, type Snapshot } from "../src/scopes/snapshot";
import { createGeneratePage } from "../src/settings/generate-page";

/** A small PARA-like vault: two projects of 6 notes, each project note linked by project:. */
const vault = (): Snapshot => {
	const notes: NoteFacts[] = [];
	for (const p of ["Garden", "Lyon"]) {
		notes.push({ path: `Projects/${p}/${p}.md`, props: {}, links: {}, tags: [] });
		for (let i = 0; i < 5; i++)
			notes.push({
				path: `Projects/${p}/Note ${p} ${i}.md`,
				props: { project: `[[${p}]]` },
				links: { project: [`Projects/${p}/${p}.md`] },
				tags: [],
			});
	}
	for (let i = 0; i < 4; i++) notes.push({ path: `Inbox ${i}.md`, props: {}, links: {}, tags: [] });
	return { notes, files: notes.map((n) => n.path), config: emptyConfig() };
};

const make = (scopes: Scope[] = []) => {
	const state = { scopes, saved: 0, changed: 0 };
	const page = createGeneratePage({
		app: new App() as never,
		scopes: () => state.scopes,
		setScopes: (s) => {
			state.scopes = s;
		},
		save: () => state.saved++,
		changed: () => state.changed++,
		snapshot: () => Promise.resolve(vault()),
	}) as unknown as { display(): void; containerEl: HTMLElement; title: string };
	return { page, state };
};

const settle = () => new Promise((r) => setTimeout(r, 0));
const texts = (el: HTMLElement, cls: string): string[] =>
	[...el.querySelectorAll(`.${cls}`)].map((e) => e.textContent ?? "");

describe("the Generate page", () => {
	it("shows what it found, the proposals with their rules and a toggle each, and adds the ticked ones", async () => {
		const { page, state } = make();
		page.display();
		await settle();
		const names = texts(page.containerEl, "setting-item-name");
		expect(names[0]).toBe("2 of 2 selected");
		expect(names.some((n) => n.startsWith("Garden"))).toBe(true);
		expect(
			texts(page.containerEl, "setting-item-description").some((d) => d.includes("folder Projects/Garden")),
		).toBe(true);
		const add = page.containerEl.querySelector("button.mod-cta");
		expect(add?.textContent).toBe("Add 2 scopes");
		(add as HTMLButtonElement).click();
		expect(state.scopes.map((s) => [s.name, s.source])).toEqual([
			["Garden", "generated"],
			["Lyon", "generated"],
		]);
		expect(state.saved).toBe(1);
		expect(state.changed).toBe(1);
	});

	it("generating again lists nothing new when nothing changed", async () => {
		const first = make();
		first.page.display();
		await settle();
		(first.page.containerEl.querySelector("button.mod-cta") as HTMLButtonElement).click();
		const again = make(first.state.scopes);
		again.page.display();
		await settle();
		expect(again.page.title).toBe("Find new scopes");
		expect(texts(again.page.containerEl, "setting-item-name")[0]).toBe("0 of 0 selected");
		expect(texts(again.page.containerEl, "setting-item-name").some((n) => n.startsWith("Unchanged · 2"))).toBe(
			true,
		);
	});
});
