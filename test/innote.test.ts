import { describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";
import { InNoteHost } from "../src/innote";
import type { Entry } from "../src/modal/jet-modal";

const view = (text: string) => {
	const calls: unknown[] = [];
	const editor = {
		getValue: () => text,
		setSelection: (a: unknown, b: unknown) => calls.push(["select", a, b]),
		scrollIntoView: () => calls.push(["scroll"]),
		focus: () => calls.push(["focus"]),
	};
	return { v: { editor, file: new TFile("n.md") }, calls };
};

const list = (h: InNoteHost, q: string): Entry[] => {
	let out: Entry[] = [];
	h.list(q, (e) => (out = e));
	return out;
};

describe("search in this note", () => {
	const text = [
		"# Garden plan",
		"The orchard needs water.",
		"Plan the garden beds and the orchard paths.",
		"nothing here",
	].join("\n");

	it("ranks lines by the words they hold, then by position, with the matches marked", () => {
		const { v } = view(text);
		const h = new InNoteHost(new App() as never, v.file, v as never);
		const rows = list(h, "orchard plan").filter((e) => e.type === "item");
		expect(rows.map((r) => (r.type === "item" ? r.crumb : ""))).toEqual(["Line 3", "Line 1", "Line 2"]);
		const first = rows[0];
		expect(first?.type === "item" && first.titleRanges.length).toBe(2);
	});

	it("jumps to the line and selects the match", () => {
		const { v, calls } = view(text);
		const h = new InNoteHost(new App() as never, v.file, v as never, (fn) => fn());
		const row = list(h, "water").find((e) => e.type === "item");
		if (row?.type !== "item" || !row.at) throw new Error("no row");
		h.open(row.path, "default", row.at);
		expect(calls).toContainEqual(["select", { line: 1, ch: 18 }, { line: 1, ch: 23 }]);
	});

	it("says so when no line matches", () => {
		const { v } = view(text);
		const h = new InNoteHost(new App() as never, v.file, v as never);
		expect(list(h, "zebra")).toEqual([{ type: "notice", title: "No lines with “zebra” in this note" }]);
	});
});
