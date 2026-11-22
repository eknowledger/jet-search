import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Notice, Platform } from "obsidian";
import { buttonNamed, goTo, tabOf } from "./settings-ui";
import JetSearchPlugin from "../src/main";
import { diag } from "../src/diag/diag";
import { recorder } from "../src/diag/recorder";
import { KIND, trace } from "../src/diag/trace";

const manifest = { id: "jet-search", name: "Jet Search", version: "0.7.1" };

type Cmd = { id: string; name: string; callback?: () => unknown; checkCallback?: (checking: boolean) => boolean };
type Mocked = JetSearchPlugin & { commands: Cmd[] };

const make = (): Mocked => new JetSearchPlugin(new App() as never, manifest as never) as Mocked;
const modal = (): HTMLElement => document.querySelector<HTMLElement>(".jet-support-modal") as HTMLElement;
const box = (): HTMLElement => modal().querySelector<HTMLElement>(".jet-trace-box") as HTMLElement;
const report = (): string =>
	[...modal().querySelectorAll(".jet-support-line")].map((l) => l.textContent ?? "").join("\n");

beforeEach(() => {
	vi.useFakeTimers();
	trace.reset();
	diag.reset();
	recorder.reset();
	Notice.shown.length = 0;
	vi.stubGlobal("Worker", class {});
});
afterEach(() => {
	trace.reset();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	document.body.replaceChildren();
	Platform.isMobile = false;
});

describe("starting and stopping a trace", () => {
	it("starts nothing at Obsidian's start, and makes no status item", async () => {
		const plugin = make();
		await plugin.onload();
		expect(trace.on).toBe(false);
		expect(trace.state().events).toBe(0);
		expect(document.querySelector(".status-bar-item")).toBeNull();
	});

	it("has commands to start and stop, each offered only when it can be used", async () => {
		const plugin = make();
		await plugin.onload();
		const start = plugin.commands.find((c) => c.id === "trace-start");
		const stop = plugin.commands.find((c) => c.id === "trace-stop");
		expect([start?.name, stop?.name]).toEqual(["Start recording a trace", "Stop recording a trace"]);
		expect(start?.checkCallback?.(true)).toBe(true);
		expect(stop?.checkCallback?.(true)).toBe(false);
		start?.checkCallback?.(false);
		expect(trace.on).toBe(true);
		expect(trace.state().minutes).toBe(15);
		expect(start?.checkCallback?.(true)).toBe(false);
		expect(stop?.checkCallback?.(true)).toBe(true);
		stop?.checkCallback?.(false);
		expect(trace.on).toBe(false);
	});

	it("says when it starts and when it stops, and shows a status item while it runs (desktop)", async () => {
		const plugin = make();
		await plugin.onload();
		plugin.commands.find((c) => c.id === "trace-start")?.checkCallback?.(false);
		expect(Notice.shown.at(-1)).toContain("Jet is recording a trace");
		expect(Notice.shown.at(-1)).toContain("15 minutes");
		const item = document.querySelector<HTMLElement>(".status-bar-item");
		expect(item?.textContent).toContain("Jet trace");
		expect(item?.textContent).toContain("15 min");
		trace.add(KIND.search, 5);
		vi.advanceTimersByTime(15 * 60_000);
		expect(trace.on).toBe(false);
		expect(Notice.shown.at(-1)).toContain("Jet stopped recording");
		expect(Notice.shown.at(-1)).toContain("3 events");
		expect(document.querySelector(".status-bar-item")).toBeNull();
	});

	it("opens the support info when the status item is clicked", async () => {
		const plugin = make();
		await plugin.onload();
		plugin.commands.find((c) => c.id === "trace-start")?.checkCallback?.(false);
		document.querySelector<HTMLElement>(".status-bar-item")?.click();
		expect(modal()).not.toBeNull();
	});

	it("makes no status item on a phone, which has no status bar", async () => {
		Platform.isMobile = true;
		const plugin = make();
		await plugin.onload();
		plugin.commands.find((c) => c.id === "trace-start")?.checkCallback?.(false);
		expect(trace.on).toBe(true);
		expect(document.querySelector(".status-bar-item")).toBeNull();
	});

	it("stops, and removes its status item, when Jet is turned off", async () => {
		const plugin = make();
		await plugin.onload();
		plugin.commands.find((c) => c.id === "trace-start")?.checkCallback?.(false);
		plugin.onunload();
		expect(trace.on).toBe(false);
		expect(trace.state().stopped).toBe("unload");
		expect(document.querySelector(".status-bar-item")).toBeNull();
	});
});

describe("the next start", () => {
	it("records from Obsidian's next start once, for the length chosen, and clears the switch", async () => {
		const first = make();
		await first.onload();
		first.data.settings.traceNextStart = true;
		first.data.settings.traceMinutes = 30;
		await first.saveData(first.data);
		first.onunload();
		trace.reset();
		const again = new JetSearchPlugin(first.app as never, manifest as never) as Mocked;
		(again as unknown as { data: unknown }).data = null;
		// The same saved data, as Obsidian hands it back.
		(again as unknown as { saveData: (d: unknown) => Promise<void> }).saveData = first.saveData.bind(first);
		(again as unknown as { loadData: () => Promise<unknown> }).loadData = first.loadData.bind(first);
		await again.onload();
		expect(trace.on).toBe(true);
		expect(trace.state().minutes).toBe(30);
		expect(again.data.settings.traceNextStart).toBe(false);
		expect(trace.list().some((e) => e.label === "plugin loaded")).toBe(true);
	});
});

describe("the trace box in the support info", () => {
	it("offers 5, 10, 15, 30 and 60 minutes, and starts a trace for the one chosen", async () => {
		const plugin = make();
		await plugin.onload();
		plugin.supportInfo();
		const sel = box().querySelector<HTMLSelectElement>("select") as HTMLSelectElement;
		expect([...sel.options].map((o) => o.value)).toEqual(["5", "10", "15", "30", "60"]);
		expect(sel.value).toBe("15");
		sel.value = "30";
		sel.dispatchEvent(new Event("change"));
		expect(plugin.data.settings.traceMinutes).toBe(30);
		buttonNamed(box(), "Record")?.click();
		expect(trace.on).toBe(true);
		expect(trace.state().minutes).toBe(30);
		expect(box().textContent).toContain("Recording");
		expect(report()).toContain("recording, 30 min left");
	});

	it("stops from the box, and the report then says it was stopped by you", async () => {
		const plugin = make();
		await plugin.onload();
		plugin.supportInfo();
		buttonNamed(box(), "Record")?.click();
		buttonNamed(box(), "Stop")?.click();
		expect(trace.on).toBe(false);
		expect(buttonNamed(box(), "Record")).not.toBeNull();
		expect(report()).toContain("stopped by you");
	});

	it("keeps the recorded numbers in the report after it stopped, with the timeline only when ticked", async () => {
		const plugin = make();
		await plugin.onload();
		plugin.supportInfo();
		buttonNamed(box(), "Record")?.click();
		recorder.add(1, 12, 2, 5, 20, 1, 8, 2, 6, 3);
		buttonNamed(box(), "Stop")?.click();
		expect(report()).toContain("searches 1, median 20 ms");
		expect(report()).not.toContain("Timeline:");
		const tick = [...box().querySelectorAll<HTMLInputElement>("input[type=checkbox]")].find((i) =>
			i.parentElement?.textContent?.includes("full timeline"),
		) as HTMLInputElement;
		tick.checked = true;
		tick.dispatchEvent(new Event("change"));
		expect(report()).toContain("Timeline:");
		expect(report()).toContain("search, 20 ms");
	});

	it("keeps the next-start choice", async () => {
		const plugin = make();
		await plugin.onload();
		plugin.supportInfo();
		const tick = [...box().querySelectorAll<HTMLInputElement>("input[type=checkbox]")].find((i) =>
			i.parentElement?.textContent?.includes("next start"),
		) as HTMLInputElement;
		tick.checked = true;
		tick.dispatchEvent(new Event("change"));
		expect(plugin.data.settings.traceNextStart).toBe(true);
	});

	it("does not show the timeline tick before a trace has run", async () => {
		const plugin = make();
		await plugin.onload();
		plugin.supportInfo();
		expect(box().textContent).not.toContain("full timeline");
		expect(report()).not.toContain("Trace:");
	});
});

describe("the trace card in the settings", () => {
	it("starts and stops a trace from the Advanced page", async () => {
		const plugin = make();
		await plugin.onload();
		const el = goTo(tabOf(plugin), "advanced");
		const card = [...el.querySelectorAll<HTMLElement>(".jet-set-card")].find(
			(c) => c.querySelector(".jet-set-name")?.textContent === "Trace",
		) as HTMLElement;
		expect(card).toBeTruthy();
		const sel = card.querySelector<HTMLSelectElement>("select.dropdown") as HTMLSelectElement;
		expect([...sel.options].map((o) => o.value)).toEqual(["5", "10", "15", "30", "60"]);
		buttonNamed(card, "Record")?.click();
		expect(trace.on).toBe(true);
		const again = goTo(tabOf(plugin), "advanced");
		expect(buttonNamed(again, "Stop recording")).not.toBeNull();
		buttonNamed(again, "Stop recording")?.click();
		expect(trace.on).toBe(false);
	});
});
