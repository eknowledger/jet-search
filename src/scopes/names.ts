/**
 * Names for the scope generator: the comparison form of a
 * name, numbering and ids stripped into aliases, and the shape tests that tell periods, sequences,
 * ids and Johnny.Decimal levels apart. Pure; no word lists (month names come from `Intl`).
 */

/**
 * Emoji, whole: pictographs, flags (regional indicators, subdivision tags), skin tones and keycaps
 * ("🇫🇷 France", "👍🏽 Reviews", "1️⃣ Inbox" are France, Reviews, Inbox).
 */
const EMOJI =
	/[0-9#*]\u{FE0F}?\u{20E3}|\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|[\u{E0020}-\u{E007F}]|\u{FE0F}|\u{200D}|\u{20E3}/gu;
const NOTION_ID = /\s*[0-9a-f]{32}$/i;
const MARKS = /\p{M}/gu;

/** The comparison form: case, accents, emoji, a trailing Notion id and separators folded. */
export const fold = (s: string): string =>
	s
		.normalize("NFKC")
		.replace(EMOJI, "")
		.replace(NOTION_ID, "")
		.toUpperCase()
		.toLowerCase()
		.normalize("NFD")
		.replace(MARKS, "")
		.normalize("NFC")
		.replace(/ـ/g, "")
		.replace(/[\s\-_.·]+/g, " ")
		.trim();

/** fold without spaces: `#orchard_rewrite` agrees with "Orchard Rewrite" (agreement only). */
export const compact = (s: string): string => fold(s).replace(/ /g, "");

// ── Numbering (numbered-name) ─────────────────────────────────────────────

/** An order index: 1–3 digits then `.`, `)`, `_`, `-` or a space ("2.Projects", "01 Inbox", "1_Areas"). */
const ORDER = /^(\d{1,3})(?:[.)_]\s*|\s*-\s*|\s+)(?=\S)/u;
const JD_AREA = /^(\d{2})\s*[-–]\s*(\d{2})\s+(?=\S)/u;
const JD_CATEGORY = /^(\d{2})\s+(?=\S)/u;
const JD_ID = /^\d{2}\.\d{2}(?:\s|$)/u;
const STAMP = /^(?:\d{8,14}|\d{4}-\d{2}-\d{2}(?:[ T]?\d{2}:?\d{2})?)\s+(?=\S)/u;

/** Whether ≥ 60% of the sibling names start with an order index (then each one's index is stripped). */
export const sharesScheme = (siblings: readonly string[]): boolean => {
	if (!siblings.length) return false;
	return siblings.filter((s) => ORDER.test(s)).length / siblings.length >= 0.6;
};

/**
 * A name for display and its alias: Johnny.Decimal codes, emoji, stamps and Notion ids always go;
 * an order index only when its siblings share the scheme; never down to nothing or one character.
 * `jdCategoryLevel`: the name sits inside a Johnny.Decimal area, so "11 Finance" is a category.
 */
export const stripName = (
	raw: string,
	scheme: boolean,
	jdCategoryLevel = false,
): { name: string; alias: string | null } => {
	let name = raw.normalize("NFC").replace(EMOJI, " ").replace(NOTION_ID, "").replace(/\s+/g, " ").trim();
	let alias: string | null = null;
	const take = (re: RegExp, keep: (m: RegExpExecArray) => string | null): void => {
		const m = re.exec(name);
		if (!m) return;
		const rest = name.slice(m[0].length).trim();
		if (rest.length <= 1) return;
		alias = keep(m);
		name = rest;
	};
	const area = JD_AREA.exec(name);
	if (area) take(JD_AREA, (m) => `${m[1]}-${m[2]}`);
	else if (jdCategoryLevel && JD_CATEGORY.test(name)) take(JD_CATEGORY, (m) => m[1] ?? null);
	else if (STAMP.test(name)) take(STAMP, () => null);
	else if (scheme) take(ORDER, (m) => m[1] ?? null);
	return { name: name || raw, alias };
};

// ── Shape tests ─────────────────────────────────────────────────────────

const monthNames = (locale: string): string[] => {
	const out: string[] = [];
	for (const month of ["long", "short"] as const) {
		try {
			const f = new Intl.DateTimeFormat(locale, { month, timeZone: "UTC" });
			for (let m = 0; m < 12; m++) out.push(fold(f.format(new Date(Date.UTC(2021, m, 15)))).replace(/\.$/, ""));
		} catch {
			// An unknown locale: no month names from it.
		}
	}
	return out;
};
const monthCache = new Map<string, Set<string>>();
const months = (locales: readonly string[]): Set<string> => {
	const key = locales.join(",");
	let set = monthCache.get(key);
	if (!set) {
		set = new Set(locales.flatMap(monthNames).filter((m) => m.length > 1));
		monthCache.set(key, set);
	}
	return set;
};

/**
 * Whether a folder name is a period: a year, a month (inside a year), a date, a quarter, a week, or a
 * month name in one of the locales (an optional leading month number, "03 March", is allowed).
 */
export const isPeriod = (name: string, opts: { inYear: boolean; locales: readonly string[] }): boolean => {
	const n = name.trim();
	if (/^(1[89]|20|21)\d{2}$/.test(n)) return true;
	if (/^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/.test(n)) return true;
	if (/^(\d{4}[-\s]?)?Q[1-4]$/i.test(n)) return true;
	if (/^(\d{4}[-\s]?)?W(0?[1-9]|[1-4]\d|5[0-3])$/i.test(n)) return true;
	if (opts.inYear && /^(0?[1-9]|1[0-2])$/.test(n)) return true;
	const word = fold(n.replace(/^\d{1,2}[\s.\-_]+/, ""));
	return word.length > 1 && months(opts.locales).has(word);
};

const ROMAN = /^(?=[ivxlc]+$)c{0,3}(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/;

/** Sibling names that differ only by one integer, Roman numeral or single letter ("Week 1", "Week 2"; "A", "B"). */
export const sequenceSiblings = (names: readonly string[]): Set<string> => {
	const by = new Map<string, string[]>();
	for (const n of names) {
		const words = fold(n).split(" ");
		for (let i = 0; i < words.length; i++) {
			const w = words[i] as string;
			if (!/^\d+$/.test(w) && !ROMAN.test(w) && !(words.length === 1 && /^\p{L}$/u.test(w))) continue;
			const rest = [...words.slice(0, i), "#", ...words.slice(i + 1)].join(" ");
			by.set(rest, [...(by.get(rest) ?? []), n]);
		}
	}
	const out = new Set<string>();
	for (const [rest, group] of by) {
		if (group.length < 2 || (rest === "#" && !group.every((g) => /^\p{L}$/u.test(g.trim())))) continue;
		// Numbers in a series are small or nearly consecutive (Week 1…12, Lab 3, Season 2); codes are not
		// (CS 110, CS 210, MATH 221: courses, rooms, models stay topics).
		const nums = group
			.map((g) =>
				fold(g)
					.split(" ")
					.find((w) => /^\d+$/.test(w)),
			)
			.filter((w): w is string => w !== undefined)
			.map(Number);
		if (nums.length === group.length) {
			const small = nums.every((x) => x < 100);
			const close = Math.max(...nums) - Math.min(...nums) < 2 * nums.length;
			if (!small && !close) continue;
		}
		for (const g of group) out.add(g);
	}
	return out;
};

/** A note name that is a date, a stamp or an id, not a topic. */
export const isIdName = (name: string): boolean => {
	const n = name.trim();
	return (
		/^\d{8,14}$/.test(n) ||
		/^\d{4}-\d{2}-\d{2}([ T]\d{2}:?\d{2}(:?\d{2})?)?$/.test(n) ||
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(n) ||
		/^[0-9a-f]{32}$/i.test(n)
	);
};

/** A Johnny.Decimal area ("10-19 Admin"), as its range; null otherwise. Years (2020-2029) do not count. */
export const jdArea = (name: string): { from: number; to: number } | null => {
	const m = JD_AREA.exec(name.trim());
	if (!m) return null;
	const from = Number(m[1]);
	const to = Number(m[2]);
	return to > from && to - from <= 10 ? { from, to } : null;
};

/** A Johnny.Decimal category number ("11 Finance" → 11); null otherwise. */
export const jdCategory = (name: string): number | null => {
	if (jdArea(name) || jdId(name)) return null;
	const m = JD_CATEGORY.exec(name.trim());
	return m ? Number(m[1]) : null;
};

/** A Johnny.Decimal id ("11.01 Annual budget"): never a scope. */
export const jdId = (name: string): boolean => JD_ID.test(name.trim());
