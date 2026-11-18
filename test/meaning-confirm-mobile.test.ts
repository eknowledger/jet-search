import { afterEach, describe, expect, it } from "vitest";
import { App, Platform } from "obsidian";
import { MODEL } from "../src/meaning/model";
import { MeaningConfirm } from "../src/settings/meaning-settings";

const downloadRow = (): string => {
	const m = new MeaningConfirm(new App() as never, { busy: null, install: async () => {} } as never, 2, () => {});
	(m as unknown as { titleEl: HTMLElement }).titleEl = document.createElement("div");
	m.open();
	const cells = [...m.contentEl.querySelectorAll("tr")].find((r) => r.firstElementChild?.textContent === "Download");
	return cells?.lastElementChild?.textContent ?? "";
};

describe("the model download row", () => {
	afterEach(() => {
		Platform.isMobile = false;
		document.body.replaceChildren();
	});

	it("says the size, and nothing about data, on a computer", () => {
		expect(downloadRow()).toBe(`~${MODEL.downloadMB} MB, once · kept as about 8 MB`);
	});

	it("asks for Wi-Fi on a phone or tablet, where the download counts against mobile data", () => {
		Platform.isMobile = true;
		expect(downloadRow()).toBe(
			`~${MODEL.downloadMB} MB, once · kept as about 8 MB. Use Wi-Fi: it counts against mobile data.`,
		);
	});
});
