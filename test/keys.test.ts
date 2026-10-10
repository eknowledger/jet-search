import { afterEach, describe, expect, it } from "vitest";
import { App } from "obsidian";
import { normalizeData } from "../src/data";
import { comboLabel, comboOf, keyMap, refusal, setMac, tapLabel } from "../src/keys/keymap";
import { type Entry, JetModal, type ModalHost } from "../src/modal/jet-modal";
import { DoubleTap } from "../src/shift";

describe("the keymap", () => {
	afterEach(() => setMac(true));

	it("your keys over the defaults; labels as macOS and other systems write them", () => {
		const m = keyMap({ copyLink: { mods: ["Mod"], key: "C" } });
		expect(m.copyLink).toEqual({ mods: ["Mod"], key: "c" });
		expect(m.preview).toEqual({ mods: ["Mod"], key: "." });
		expect(comboLabel(m.copyLink)).toBe("⌘C");
		expect(comboLabel(m.sort)).toBe("⌘⇧S");
		expect(comboLabel(m.create)).toBe("⇧↵");
		expect(comboLabel(m.accept)).toBe("⇥");
		setMac(false);
		expect(comboLabel(m.sort)).toBe("Ctrl+Shift+S");
		expect(comboLabel(m.insertLink)).toBe("Alt+↵");
	});

	it("refuses a key another action has (naming it), a key Jet keeps, and a key that types text", () => {
		const m = keyMap();
		expect(refusal(m, "copyLink", { mods: ["Mod"], key: "k" })).toContain("The note's actions");
		expect(refusal(m, "copyLink", { mods: [], key: "Escape" })).toContain("kept for Esc");
		expect(refusal(m, "copyLink", { mods: ["Shift"], key: "c" })).toContain("for typing");
		expect(refusal(m, "copyLink", { mods: ["Mod"], key: "c" })).toBeNull();
		// Its own key again is fine.
		expect(refusal(m, "copyLink", { mods: ["Mod"], key: "l" })).toBeNull();
	});

	it("reads a key press by its place, so ⌥L is L; a modifier alone is no key", () => {
		const e = { key: "¬", code: "KeyL", metaKey: false, ctrlKey: false, altKey: true, shiftKey: false };
		expect(comboOf(e)).toEqual({ mods: ["Alt"], key: "l" });
		expect(comboOf({ ...e, key: "Meta", code: "MetaLeft", altKey: false, metaKey: true })).toBeNull();
		expect(
			comboOf({ key: "Enter", code: "Enter", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true }),
		).toEqual({
			mods: ["Mod", "Shift"],
			key: "Enter",
		});
	});

	it("the double tap as hints write it, or none when off", () => {
		expect(tapLabel("Shift")).toBe("⇧⇧");
		expect(tapLabel("Control")).toBe("⌃⌃");
		expect(tapLabel("off")).toBeNull();
	});
});

describe("the double tap's key and saved keys", () => {
	it("migrates the old double-Shift switch, and keeps only sound saved keys", () => {
		expect(normalizeData({ settings: { doubleShift: false } }).settings.tapKey).toBe("off");
		expect(normalizeData({ settings: { doubleShift: true } }).settings.tapKey).toBe("Shift");
		expect(normalizeData(null).settings.tapKey).toBe("Shift");
		expect(normalizeData({ settings: { tapKey: "Control", doubleShift: false } }).settings.tapKey).toBe("Control");
		expect(normalizeData({ settings: { tapKey: "Hyper" } }).settings.tapKey).toBe("Shift");
		const keys = normalizeData({
			settings: {
				keys: {
					copyLink: { mods: ["Mod"], key: "c" },
					nope: { mods: [], key: "x" },
					preview: { mods: ["Super"], key: "p" },
					sort: { key: "s" },
				},
			},
		}).settings.keys;
		expect(keys).toEqual({ copyLink: { mods: ["Mod"], key: "c" } });
	});

	it("counts taps of the chosen key only", () => {
		let key = "Control";
		const t = new DoubleTap(
			() => 350,
			() => key,
		);
		t.keydown("Shift", false, 0);
		expect(t.keyup("Shift", 50)).toBe(false);
		t.keydown("Shift", false, 100);
		expect(t.keyup("Shift", 150)).toBe(false);
		t.keydown("Control", false, 200);
		expect(t.keyup("Control", 250)).toBe(false);
		t.keydown("Control", false, 300);
		expect(t.keyup("Control", 350)).toBe(true);
		key = "Shift";
		t.keydown("Shift", false, 400);
		t.keyup("Shift", 450);
		t.keydown("Shift", false, 500);
		expect(t.keyup("Shift", 550)).toBe(true);
	});
});

describe("the window follows your keys", () => {
	afterEach(() => document.body.replaceChildren());
	const item: Entry = {
		type: "item",
		path: "a.md",
		title: "a",
		titleRanges: [],
		crumb: "",
		meta: "",
		icon: "file-text",
	};
	const host = (copied: string[], keys: ModalHost["keys"]): ModalHost => ({
		placeholder: "Search notes…",
		list: (_t, paint) => paint([{ type: "header", label: "Results", count: 1 }, item]),
		open: () => {},
		hints: () => [],
		closed: () => {},
		previewOn: () => false,
		setPreviewOn: () => {},
		copyLink: (p) => copied.push(p),
		keys,
	});
	const press = (m: JetModal, key: string, mods: string[] = []) =>
		(m.scope as unknown as { press(k: string, m: unknown[]): boolean }).press(key, mods);

	it("an action moved to another key runs there and no longer on its default", () => {
		const copied: string[] = [];
		const m = new JetModal(
			new App() as never,
			host(copied, () => ({ map: keyMap({ copyLink: { mods: ["Mod"], key: "c" } }), tap: "⌃⌃" })),
		);
		m.open();
		expect(press(m, "l", ["Mod"])).toBe(false);
		expect(press(m, "c", ["Mod"])).toBe(true);
		expect(copied).toEqual(["a.md"]);
	});

	it("open moved off ↵: the new key opens; ↵ still takes a value from the list", () => {
		const opened: string[] = [];
		const h = host([], () => ({ map: keyMap({ open: { mods: ["Mod"], key: "o" } }), tap: null }));
		h.open = (p) => opened.push(p);
		const m = new JetModal(new App() as never, h);
		m.open();
		expect(press(m, "Enter")).toBe(false);
		expect(press(m, "o", ["Mod"])).toBe(true);
		expect(opened).toEqual(["a.md"]);
	});
});
