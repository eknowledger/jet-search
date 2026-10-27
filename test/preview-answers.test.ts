import { describe, expect, it, vi } from "vitest";
import { App, MarkdownRenderer, TFile } from "obsidian";
import { Preview } from "../src/preview/preview";

const TEXT = "## Sales\n- Other line here\n- **Kiosk screens** are ~20-30% of the sales\n";

describe("the preview outlines the answer line (experiment)", () => {
	it("outlines and labels the block holding the line, colours its figures, and starts at its hit", async () => {
		const app = new App();
		(app.vault as unknown as { cachedRead: () => Promise<string> }).cachedRead = async () => TEXT;
		const render = vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_a, _md, el: HTMLElement) => {
			el.innerHTML =
				"<h2>Sales</h2><ul><li>Other line here, the sales</li><li><strong>Kiosk screens</strong> are ~20-30% of the sales</li></ul>";
		});
		const p = new Preview(app as never, document.body, () => {});
		await p.show(new TFile("Handoff.md"), ["sales"], TEXT.indexOf("- **Kiosk"), {
			line: "- **Kiosk screens** are ~20-30% of the sales",
			question: "what share of the sales has screens?",
		});
		const li = [...p.el.querySelectorAll("li")];
		expect(li[0]?.classList.contains("jet-answer")).toBe(false);
		expect(li[1]?.classList.contains("jet-answer")).toBe(true);
		expect(li[1]?.querySelector(".jet-alabel")?.textContent).toBe("Closest to your question");
		expect(li[1]?.querySelector(".jet-num")?.textContent).toBe("~20-30%");
		// The hit walk starts at the outlined line's hit, not the first one in the note.
		expect(li[1]?.querySelector("mark.jet-pmark.is-current")?.textContent).toBe("sales");
		render.mockRestore();
		p.destroy();
	});

	it("finds a numbered list item's line, its number not rendered as text", async () => {
		const app = new App();
		(app.vault as unknown as { cachedRead: () => Promise<string> }).cachedRead = async () =>
			"5. **Stock checks** are handled by the kiosk.\n";
		const render = vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_a, _md, el: HTMLElement) => {
			el.innerHTML = '<ol start="5"><li><strong>Stock checks</strong> are handled by the kiosk.</li></ol>';
		});
		const p = new Preview(app as never, document.body, () => {});
		await p.show(new TFile("N.md"), ["kiosk"], 0, {
			line: "5. **Stock checks** are handled by the kiosk.",
			question: "who handles stock checks?",
		});
		expect(p.el.querySelector("li")?.classList.contains("jet-answer")).toBe(true);
		render.mockRestore();
		p.destroy();
	});
});
