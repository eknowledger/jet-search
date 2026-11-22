import "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HintBar } from "../src/modal/hint-strip";

const KEYS: Array<[string, string]> = [
	["↵", "Open"],
	["⌘↵", "New tab"],
	["⌘⇧E", "Explain"],
];

const rig = (widths?: { scroll: number; client: number }) => {
	const foot = document.createElement("div");
	document.body.append(foot);
	const bar = new HintBar(foot);
	bar.set(KEYS);
	const track = foot.querySelector(".jet-ftrack") as HTMLElement;
	if (widths) {
		Object.defineProperty(track, "scrollWidth", { value: widths.scroll, configurable: true });
		Object.defineProperty(track, "clientWidth", { value: widths.client, configurable: true });
		bar.update();
	}
	return { foot, bar, strip: bar.el, track };
};

afterEach(() => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

describe("the key hints bar", () => {
	it("holds every hint, in order, whether or not they fit", () => {
		const { track } = rig();
		expect([...track.querySelectorAll(".jet-ht")].map((h) => h.textContent)).toEqual([
			"↵Open",
			"⌘↵New tab",
			"⌘⇧EExplain",
		]);
	});

	it("changes only the hints: the bar and its edges stay", () => {
		const { bar, foot, track } = rig();
		const edges = [...foot.querySelectorAll(".jet-fedge")];
		bar.set([["Esc", "Close"]]);
		expect([...track.querySelectorAll(".jet-ht")].map((h) => h.textContent)).toEqual(["EscClose"]);
		expect([...foot.querySelectorAll(".jet-fedge")]).toEqual(edges);
		expect(foot.querySelectorAll(".jet-fstrip")).toHaveLength(1);
	});

	it("measures in the next frame, not in the call that changed the hints", () => {
		const frames: Array<() => void> = [];
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((f) => frames.push(f as () => void));
		const { bar } = rig();
		const measure = vi.spyOn(bar, "update");
		bar.set(KEYS);
		bar.set(KEYS);
		expect(measure).not.toHaveBeenCalled();
		// Two changes in one frame ask for one measure.
		expect(frames).toHaveLength(1);
		frames[0]?.();
		expect(measure).toHaveBeenCalledTimes(1);
	});

	it("shows no edge marker when everything fits", () => {
		const { strip } = rig({ scroll: 300, client: 300 });
		expect(strip.classList.contains("more-left")).toBe(false);
		expect(strip.classList.contains("more-right")).toBe(false);
	});

	it("marks the right edge when more is hidden there, and the left once it has slid", () => {
		const { strip, track, bar } = rig({ scroll: 500, client: 300 });
		expect(strip.classList.contains("more-right")).toBe(true);
		expect(strip.classList.contains("more-left")).toBe(false);
		track.scrollLeft = 100;
		bar.update();
		expect(strip.classList.contains("more-left")).toBe(true);
		expect(strip.classList.contains("more-right")).toBe(true);
		track.scrollLeft = 200;
		bar.update();
		expect(strip.classList.contains("more-right")).toBe(false);
	});

	it("slides while the pointer is on an edge, and stops when it leaves", () => {
		const frames: Array<() => void> = [];
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((f) => frames.push(f as () => void));
		vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
		const { track, foot } = rig({ scroll: 500, client: 300 });
		const right = foot.querySelector(".jet-fedge.is-right") as HTMLElement;
		right.dispatchEvent(new Event("mouseenter"));
		frames.shift()?.();
		frames.shift()?.();
		expect(track.scrollLeft).toBeGreaterThan(0);
		right.dispatchEvent(new Event("mouseleave"));
		expect(window.cancelAnimationFrame).toHaveBeenCalled();
	});

	it("stops by itself when the bar is gone (the window closed while the pointer was on an edge)", () => {
		const frames: Array<() => void> = [];
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((f) => frames.push(f as () => void));
		const { foot } = rig({ scroll: 500, client: 300 });
		frames.length = 0;
		foot.querySelector(".jet-fedge.is-right")?.dispatchEvent(new Event("mouseenter"));
		foot.replaceChildren();
		frames.shift()?.();
		expect(frames).toHaveLength(0);
	});

	it("keeps the typing focus: a press on an edge is not a focus change", () => {
		const { foot } = rig();
		const e = new MouseEvent("mousedown", { cancelable: true, bubbles: true });
		foot.querySelector(".jet-fedge.is-left")?.dispatchEvent(e);
		expect(e.defaultPrevented).toBe(true);
	});
});
