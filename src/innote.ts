import { type App, type MarkdownView, type TFile } from "obsidian";
import { normalize, tokenize } from "./engine/analyzer";
import { clusterEnd, clusterStart } from "./excerpt/chars";
import { findHits } from "./excerpt/excerpt";
import type { Entry, ModalHost, OpenHow } from "./modal/jet-modal";

const MAX_LINES = 100;
const WIDTH = 140;

type Item = Extract<Entry, { type: "item" }>;

/**
 * Search in the open note: its matching lines, ranked by how many of the typed words
 * each holds, then by position; Enter jumps to the line with the match selected. With no text, the
 * note's headings. Runs on the note's text as it is in the editor (unsaved edits included).
 */
export class InNoteHost implements ModalHost {
	readonly placeholder = "Search in this note…";

	constructor(
		private readonly app: App,
		private readonly file: TFile,
		private readonly view: MarkdownView,
		private readonly later: (fn: () => void) => void = (fn) => window.setTimeout(fn, 30),
	) {}

	list(text: string, paint: (entries: Entry[], status?: string) => void): void {
		const body = this.view.editor.getValue();
		const lines = body.split("\n");
		if (!text.trim()) {
			const heads = this.app.metadataCache.getFileCache(this.file)?.headings ?? [];
			paint(
				heads.length
					? [
							{ type: "header", label: "Headings", count: heads.length },
							...heads.map((h) =>
								this.row(`${"#".repeat(h.level)} ${h.heading}`, [], h.position.start.line, 0, 0),
							),
						]
					: [{ type: "notice", title: "Type to search this note" }],
			);
			return;
		}
		const words = tokenize(text);
		if (!words.length) {
			paint([]);
			return;
		}
		const found: Array<{ line: number; matched: number; hits: Array<[number, number]> }> = [];
		lines.forEach((l, i) => {
			const hits = findHits(l, words, { limit: 20 });
			if (!hits.length) return;
			const got = new Set<string>();
			for (const [a, b] of hits) {
				const w = normalize(l.slice(a, b));
				for (const t of words) if (w.startsWith(t)) got.add(t);
			}
			found.push({ line: i, matched: got.size, hits });
		});
		found.sort((a, b) => b.matched - a.matched || a.line - b.line);
		const top = found.slice(0, MAX_LINES);
		paint(
			top.length
				? [
						{ type: "header", label: "Lines", count: found.length },
						...top.map((f) => {
							const first = f.hits[0] as [number, number];
							return this.row(lines[f.line] ?? "", f.hits, f.line, first[0], first[1] - first[0]);
						}),
					]
				: [{ type: "notice", title: `No lines with “${text.trim()}” in this note` }],
		);
	}

	/** A line as a row: cut to about 140 characters around the first hit, marks shifted to match. */
	private row(
		line: string,
		hits: ReadonlyArray<readonly [number, number]>,
		n: number,
		ch: number,
		len: number,
	): Item {
		const t = line.trim() ? line : " ";
		const lead = t.length - t.trimStart().length;
		let from = Math.max(lead, ch - Math.floor(WIDTH / 3));
		if (t.length - from < WIDTH) from = Math.max(lead, t.length - WIDTH);
		// Never inside a character: an emoji cut in half shows as �.
		from = clusterStart(t, from);
		const to = clusterEnd(t, Math.min(t.length, from + WIDTH));
		const pre = from > lead ? "…" : "";
		const shown = pre + t.slice(from, to) + (to < t.length ? "…" : "");
		const shift = pre.length - from;
		return {
			type: "item",
			path: this.file.path,
			title: shown,
			titleRanges: hits
				.filter(([a, b]) => a >= from && b <= to)
				.map(([a, b]): [number, number] => [a + shift, b + shift]),
			crumb: `Line ${n + 1}`,
			meta: "",
			icon: "text",
			at: { line: n, ch, len },
		};
	}

	open(_path: string, _how: OpenHow, at?: { line: number; ch: number; len: number }): void {
		if (!at) return;
		const ed = this.view.editor;
		const from = { line: at.line, ch: at.ch };
		const to = { line: at.line, ch: at.ch + at.len };
		// After the modal has closed and given the editor its focus back, which would reset the selection.
		this.later(() => {
			ed.focus();
			ed.setSelection(from, to);
			ed.scrollIntoView({ from, to }, true);
		});
	}

	hints(): Array<[string, string]> {
		return [
			["↵", "Jump"],
			["↑↓", "Choose"],
			["Esc", "Close"],
		];
	}

	closed(): void {}
	previewOn(): boolean {
		return false;
	}
	setPreviewOn(): void {}
	copyLink(): void {}
	insertLink(): void {}
	create(): void {}
}
