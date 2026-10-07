/**
 * The part of a note the preview renders: the section around the hit (from its heading
 * to the next heading of the same or a higher level), capped, so a long note is never rendered whole.
 * Pure, for tests.
 */
export const PREVIEW_CAP = 8000;

export const sectionAround = (
	text: string,
	bodyStart: number,
	offset: number | undefined,
	cap = PREVIEW_CAP,
): { from: number; to: number } => {
	const at = Math.max(bodyStart, Math.min(offset ?? bodyStart, text.length));
	// The heading this offset sits under (or the body start).
	const before = text.slice(bodyStart, at);
	const re = /^(#{1,6})[ \t]/gm;
	let from = bodyStart;
	let level = 7;
	for (const m of before.matchAll(re)) {
		from = bodyStart + (m.index ?? 0);
		level = m[1]?.length ?? 7;
	}
	// Too far above the hit: start a little before it instead, at a line start.
	if (at - from > cap / 2) from = Math.max(bodyStart, text.lastIndexOf("\n", at - Math.floor(cap / 4)) + 1);
	let to = text.length;
	const after = /^(#{1,6})[ \t]/gm;
	after.lastIndex = Math.min(text.length, at + 1);
	for (let m = after.exec(text); m; m = after.exec(text))
		if ((m[1]?.length ?? 7) <= level) {
			to = m.index;
			break;
		}
	if (to - from > cap) to = text.indexOf("\n", from + cap) < 0 ? text.length : text.indexOf("\n", from + cap);
	return { from, to };
};
