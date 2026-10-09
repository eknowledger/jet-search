/**
 * The part of a note the preview renders: the section around the hit (from its heading
 * to the next heading of the same or a higher level), capped, so a long note is never rendered whole.
 * Without a hit in the text, the note from the top. Pure, for tests.
 */
export const PREVIEW_CAP = 8000;

/**
 * Whether an offset is inside a fenced code block (a `# comment` there is not a heading). The
 * fences are found once per note, then each heading is a count over them, not a scan of the text
 * before it (that made a long note's preview slow).
 */
const fenceTest = (text: string): ((i: number) => boolean) => {
	const fences: number[] = [];
	for (const m of text.matchAll(/^(```|~~~)/gm)) fences.push(m.index ?? 0);
	return (i) => {
		let n = 0;
		while (n < fences.length && (fences[n] as number) < i) n++;
		return n % 2 === 1;
	};
};

export const sectionAround = (
	text: string,
	bodyStart: number,
	offset: number | undefined,
	cap = PREVIEW_CAP,
): { from: number; to: number } => {
	// No hit in the text (the note matched by its title, a heading or a property): the note from the
	// top. A section would end at its first heading, often right after the properties: an empty body.
	if (offset === undefined) return { from: bodyStart, to: capAt(text, bodyStart, cap) };
	const at = Math.max(bodyStart, Math.min(offset, text.length));
	const inFence = fenceTest(text);
	// The heading this offset sits under (or the body start).
	const before = text.slice(bodyStart, at);
	const re = /^(#{1,6})[ \t]/gm;
	let from = bodyStart;
	let level = 7;
	for (const m of before.matchAll(re)) {
		if (inFence(bodyStart + (m.index ?? 0))) continue;
		from = bodyStart + (m.index ?? 0);
		level = m[1]?.length ?? 7;
	}
	// Too far above the hit: start a little before it instead, at a line start.
	if (at - from > cap / 2) from = Math.max(bodyStart, text.lastIndexOf("\n", at - Math.floor(cap / 4)) + 1);
	let to = text.length;
	const after = /^(#{1,6})[ \t]/gm;
	after.lastIndex = Math.min(text.length, at + 1);
	for (let m = after.exec(text); m; m = after.exec(text))
		if ((m[1]?.length ?? 7) <= level && !inFence(m.index)) {
			to = m.index;
			break;
		}
	return { from, to: Math.min(to, capAt(text, from, cap)) };
};

/** The end of `cap` characters from `from`, at the end of a line. */
const capAt = (text: string, from: number, cap: number): number => {
	if (text.length - from <= cap) return text.length;
	const nl = text.indexOf("\n", from + cap);
	return nl < 0 ? text.length : nl;
};
