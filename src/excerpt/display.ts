import { clusterEnd, clusterStart } from "./chars";

/** A piece of a line as shown: Markdown noise removed, and where each raw offset lands in it. */
export type Shown = { text: string; at: (raw: number) => number };

/** Line-start noise: indentation, quote markers, a heading's `#`s, a list marker and its task box. */
const LEAD = /[ \t]*(?:>[ \t]*)*(?:#{1,6}[ \t]+|(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[^\]\n]\][ \t]+)?)?/y;
/** `[[target|alias]]` and embeds, `[label](url)` and images, and emphasis delimiters. */
const INLINE = /(!?)\[\[([^[\]\n]+)\]\]|(!?)\[([^[\]\n]+)\]\(([^()\s]*)\)|\*\*|__|~~|==/g;
const SPACE = /\s/;

type Cut = [number, number];

/**
 * `s` (part of one line) with Markdown noise removed for display: line-start markers when `lineStart`,
 * link syntax (`[[a|b]]` → `b`, `[text](url)` → `text`) and paired `**`, `__`, `~~`, `==`. A construct
 * whose removed part touches `keep` (the hit) stays as written, so the hit is always shown.
 */
export const simplify = (s: string, lineStart: boolean, keep: readonly [number, number]): Shown => {
	const cuts: Cut[] = [];
	const add = (parts: Cut[]): void => {
		if (!parts.some(([a, b]) => a < keep[1] && b > keep[0])) cuts.push(...parts);
	};
	if (lineStart) {
		LEAD.lastIndex = 0;
		const n = LEAD.exec(s)?.[0].length ?? 0;
		if (n > 0) add([[0, n]]);
	}
	const closers = new Set<number>();
	INLINE.lastIndex = 0;
	for (let m = INLINE.exec(s); m; m = INLINE.exec(s)) {
		const a = m.index;
		const b = a + m[0].length;
		const [, bang1, target, bang2, label] = m;
		if (target !== undefined) {
			const open = a + (bang1?.length ?? 0) + 2;
			const pipe = target.indexOf("|");
			add([
				[a, pipe < 0 ? open : open + pipe + 1],
				[b - 2, b],
			]);
		} else if (label !== undefined) {
			const open = a + (bang2?.length ?? 0) + 1;
			add([
				[a, open],
				[open + label.length, b],
			]);
		} else if (!closers.delete(a)) {
			const close = s.indexOf(m[0], b);
			if (close > b && !SPACE.test(s[b] ?? " ") && !SPACE.test(s[close - 1] ?? " ")) {
				closers.add(close);
				add([
					[a, b],
					[close, close + 2],
				]);
			}
		}
	}
	cuts.sort((x, y) => x[0] - y[0]);
	const merged: Cut[] = [];
	for (const c of cuts) {
		const last = merged[merged.length - 1];
		if (last && c[0] <= last[1]) last[1] = Math.max(last[1], c[1]);
		else merged.push([c[0], c[1]]);
	}
	let text = "";
	let from = 0;
	for (const [a, b] of merged) {
		text += s.slice(from, a);
		from = b;
	}
	text += s.slice(from);
	const at = (raw: number): number => {
		let shift = 0;
		for (const [a, b] of merged) {
			if (raw < b) return raw > a ? a - shift : raw - shift;
			shift += b - a;
		}
		return raw - shift;
	};
	return { text, at };
};

const isSpace = (t: string, i: number): boolean => SPACE.test(t[i] ?? "");

/**
 * The window `[start, end)` of `t` to show around the hit `[h0, h1)`: about `width` characters, starting
 * about a third of the width before the hit at a word start, ending at a word end, never cutting the hit
 * or inside a character cluster (surrogate pair, combining sequence, emoji).
 */
export const cutWindow = (t: string, h0: number, h1: number, width: number): [number, number] => {
	const n = t.length;
	let start = 0;
	let end = n;
	if (n > width) {
		start = Math.max(0, Math.min(h0 - Math.floor(width / 3), n - width));
		if (start > 0 && !isSpace(t, start - 1)) {
			let i = start;
			while (i < h0 && !isSpace(t, i)) i++;
			start = i < h0 ? i + 1 : clusterStart(t, start);
		}
		end = Math.max(h1, Math.min(n, start + width));
		if (end < n && !isSpace(t, end)) {
			let i = end - 1;
			while (i >= h1 && !isSpace(t, i)) i--;
			end = i >= h1 ? i : clusterEnd(t, end);
		}
	}
	while (start < h0 && isSpace(t, start)) start++;
	while (end > h1 && isSpace(t, end - 1)) end--;
	return [start, end];
};
