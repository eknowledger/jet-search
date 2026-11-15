import { afterEach, describe, expect, it, vi } from "vitest";
import { App, MarkdownRenderer, TFile } from "obsidian";
import { Preview } from "../src/preview/preview";

describe("the preview's hit rail", () => {
	afterEach(() => vi.restoreAllMocks());

	it("measures every hit before it draws any tick, so the page lays out once, not once per hit", async () => {
		const app = new App();
		(app.vault as unknown as { cachedRead: () => Promise<string> }).cachedRead = async () => "x";
		vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_a, _md, el: HTMLElement) => {
			el.innerHTML = "<p>one hit, two hit, three hit</p>";
		});
		const p = new Preview(app as never, document.body, () => {});
		// Reading a position forces the page to lay out; a tick written between two reads makes it lay out again.
		let ticksWhenMeasured = 0;
		let measured = 0;
		Object.defineProperty(HTMLElement.prototype, "offsetTop", {
			configurable: true,
			get(this: HTMLElement) {
				if (this.classList.contains("jet-pmark")) {
					measured++;
					ticksWhenMeasured += document.querySelectorAll(".jet-tick").length;
					return measured * 10;
				}
				return 0;
			},
		});
		Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 100 });
		try {
			await p.show(new TFile("N.md"), ["hit"]);
			expect(measured).toBe(3);
			expect(ticksWhenMeasured).toBe(0);
			expect([...p.el.querySelectorAll<HTMLElement>(".jet-tick")].map((t) => t.style.top)).toEqual([
				"10%",
				"20%",
				"30%",
			]);
		} finally {
			delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetTop;
			delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
			p.destroy();
		}
	});
});

describe("the preview's rendering", () => {
	afterEach(() => vi.restoreAllMocks());

	it("renders off the page and puts the result in, so Obsidian's style reads do not lay the page out", async () => {
		const app = new App();
		(app.vault as unknown as { cachedRead: () => Promise<string> }).cachedRead = async () => "x";
		const seen: boolean[] = [];
		vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_a, _md, el: HTMLElement) => {
			seen.push(el.isConnected);
			el.innerHTML = "<p>shown</p>";
		});
		const p = new Preview(app as never, document.body, () => {});
		await p.show(new TFile("A.md"), []);
		await p.show(new TFile("B.md"), []);
		expect(seen).toEqual([false, false]);
		// One body in the pane, with the latest render in it and the same classes the styles use.
		expect(p.el.querySelectorAll(".jet-pin")).toHaveLength(1);
		expect(p.el.querySelector(".jet-pin")?.classList.contains("markdown-rendered")).toBe(true);
		expect(p.el.querySelector(".jet-pin")?.textContent).toBe("shown");
		p.clear();
		expect(p.el.querySelector(".jet-pin")?.textContent).toBe("");
		p.destroy();
	});

	it("shows nothing of an older note when a newer one has been chosen while it rendered", async () => {
		const app = new App();
		(app.vault as unknown as { cachedRead: () => Promise<string> }).cachedRead = async () => "x";
		let release: () => void = () => {};
		let calls = 0;
		vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_a, _md, el: HTMLElement) => {
			const n = ++calls;
			if (n === 1) await new Promise<void>((r) => (release = r));
			el.innerHTML = `<p>note ${n}</p>`;
		});
		const p = new Preview(app as never, document.body, () => {});
		const first = p.show(new TFile("A.md"), []);
		await new Promise((r) => setTimeout(r, 0));
		await p.show(new TFile("B.md"), []);
		release();
		await first;
		expect(p.el.querySelector(".jet-pin")?.textContent).toBe("note 2");
		p.destroy();
	});
});
