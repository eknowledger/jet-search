import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { normalizeData } from "../src/data";
import { FilterSets } from "../src/filters/sets";
import { JetHost } from "../src/host";
import { trace } from "../src/diag/trace";
import type { Search } from "../src/search";

const setup = () => {
	const app = new App();
	const data = normalizeData(null);
	let saved = 0;
	const search = { list: () => {}, warm: () => {}, idle: () => {} } as unknown as Search;
	const host = new JetHost(
		app as never,
		() => data,
		() => {
			saved++;
		},
		() => false,
		() => search,
		undefined,
		undefined,
		new FilterSets(app as never),
	);
	const popover = (): HTMLElement => {
		const el = document.createElement("div");
		host.renderSettings(el);
		document.body.append(el);
		return el;
	};
	return { host, data, popover, saved: () => saved };
};

const row = (el: HTMLElement): HTMLElement =>
	[...el.querySelectorAll<HTMLElement>(".jet-si2")].find((r) => r.textContent?.startsWith("Trace")) as HTMLElement;
const control = (el: HTMLElement, text: string): HTMLElement | undefined =>
	[...row(el).querySelectorAll<HTMLElement>("[role=button]")].find((b) => b.textContent === text);

beforeEach(() => {
	vi.useFakeTimers();
	trace.reset();
});
afterEach(() => {
	trace.reset();
	vi.useRealTimers();
	document.body.replaceChildren();
});

describe("the trace in the search settings", () => {
	it("offers the five lengths and a Record button, with the length the settings keep", () => {
		const { data, popover } = setup();
		data.settings.traceMinutes = 30;
		const el = popover();
		const sel = row(el).querySelector("select") as HTMLSelectElement;
		expect([...sel.options].map((o) => o.value)).toEqual(["5", "10", "15", "30", "60"]);
		expect(sel.value).toBe("30");
		expect(control(el, "Record")).toBeDefined();
		expect(row(el).textContent).toContain("Capture debug events");
	});

	it("keeps a length chosen here, and records for it", () => {
		const { data, popover, saved } = setup();
		const el = popover();
		const sel = row(el).querySelector("select") as HTMLSelectElement;
		sel.value = "10";
		sel.dispatchEvent(new Event("change"));
		expect(data.settings.traceMinutes).toBe(10);
		expect(saved()).toBe(1);
		control(el, "Record")?.click();
		expect(trace.on).toBe(true);
		expect(trace.state().minutes).toBe(10);
	});

	it("turns into a Stop that says how long is left, and stops the trace", () => {
		const { popover } = setup();
		const el = popover();
		control(el, "Record")?.click();
		expect(row(el).querySelector("select")).toBeNull();
		expect(row(el).textContent).toContain("Recording");
		expect(row(el).textContent).toContain("15 min left");
		control(el, "Stop")?.click();
		expect(trace.on).toBe(false);
		expect(control(el, "Record")).toBeDefined();
	});

	it("opens already recording when a trace is running", () => {
		const { popover } = setup();
		trace.start(5);
		const el = popover();
		expect(control(el, "Stop")).toBeDefined();
		expect(control(el, "Record")).toBeUndefined();
	});
});
