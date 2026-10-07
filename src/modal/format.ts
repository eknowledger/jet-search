/** Display helpers for result rows: breadcrumbs, ages, highlighted text. */

/** A note's folder as a breadcrumb, long paths shortened to "A / … / C". */
export const crumb = (path: string, max = 3): string => {
	const parts = path.split("/").slice(0, -1);
	if (parts.length <= max) return parts.join(" / ");
	return [parts[0], "…", ...parts.slice(-(max - 1))].join(" / ");
};

/** The note's name: the file name without `.md`. */
export const titleOf = (path: string): string => (path.split("/").pop() ?? path).replace(/\.md$/i, "");

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "22m", "3h", "Mon", "Sep 12", "Sep 12, 2025": short. */
export const age = (at: number, now: number): string => {
	const d = now - at;
	if (d < 60_000) return "now";
	if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
	if (d < DAY) return `${Math.floor(d / 3_600_000)}h`;
	const t = new Date(at);
	if (d < 7 * DAY) return DAYS[t.getDay()] as string;
	const n = new Date(now);
	const md = `${MONTHS[t.getMonth()] as string} ${t.getDate()}`;
	return t.getFullYear() === n.getFullYear() ? md : `${md}, ${t.getFullYear()}`;
};

/** Fill `el` with `text`, wrapping the [start, end) `ranges` in spans of class `cls`. */
export const highlight = (
	el: HTMLElement,
	text: string,
	ranges: ReadonlyArray<readonly [number, number]>,
	cls: string,
	tag: "span" | "mark" = "span",
): void => {
	el.replaceChildren();
	// Overlapping or touching ranges become one.
	const merged: Array<[number, number]> = [];
	for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
		const last = merged[merged.length - 1];
		if (last && a <= last[1]) last[1] = Math.max(last[1], b);
		else merged.push([a, b]);
	}
	let at = 0;
	for (const [a, b] of merged) {
		const to = Math.min(b, text.length);
		if (to <= at) continue;
		if (a > at) el.appendText(text.slice(at, a));
		el.createEl(tag, { cls, text: text.slice(Math.max(a, at), to) });
		at = to;
	}
	if (at < text.length) el.appendText(text.slice(at));
};
