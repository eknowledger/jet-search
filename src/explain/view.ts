import type { WordFact, WordKind, WordsExplanation } from "../engine/explain";
import type { MeaningExplanation } from "../meaning/explain";

/**
 * What the window and the report say about a search: plain sentences and small tables made from the
 * facts the worker found. Pure. Every word of the search and every note name goes through a `Namer`, so the
 * report can show tags (`word#1`, `note#1`) where the screen shows the words.
 */
export type Namer = { word(w: string): string; note(name: string): string };

export const realNames: Namer = { word: (w) => w, note: (n) => n };

/** Words and notes by tag, numbered in the order they first appear. */
export const tagNames = (): Namer => {
	const words = new Map<string, number>();
	const notes = new Map<string, number>();
	const tag = (m: Map<string, number>, key: string, label: string): string => {
		let i = m.get(key);
		if (i === undefined) m.set(key, (i = m.size + 1));
		return `${label}#${i}`;
	};
	return { word: (w) => tag(words, w, "word"), note: (n) => tag(notes, n, "note") };
};

/** What the dialog knows that the worker does not. */
export type Context = {
	text: string;
	mode: "words" | "meaning";
	scoped: boolean;
	filters: number;
	titleOnly: boolean;
	/** The order, as the window names it ("Best first"). */
	sort: string;
	/** What the window lists. */
	limit: number;
	/** The index is being built: how far (else null). */
	building: { done: number; total: number } | null;
};

export type NoteContext = {
	/** The note's name as shown. */
	name: string;
	/** An exclude rule in Jet's settings leaves it out. */
	excluded: boolean;
	/** Inside the chosen scope (null: no scope). */
	inScope: boolean | null;
	/** Kept by the filters (null: no filters). */
	passesFilters: boolean | null;
	/** Holds the quoted phrases of the search (null: none were quoted). */
	phrase: boolean | null;
};

export type Cell = { text: string; pill?: "ok" | "no" };
export type Table = { title: string; head: string[]; rows: Cell[][] };
export type View = {
	tone: "ok" | "warn";
	head: string;
	detail: string | null;
	chips: string[];
	tables: Table[];
	notes: string[];
};

const num = (n: number): string => n.toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`): string => `${num(n)} ${n === 1 ? one : many}`;
const quoted = (n: Namer, w: string): string => `"${n.word(w)}"`;
const list = (items: string[]): string =>
	items.length < 3 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
const fixed = (x: number): string => x.toFixed(2);

const days = (d: number): string =>
	d < 1 ? "today" : d < 2 ? "yesterday" : d < 60 ? `${Math.round(d)} days ago` : `${Math.round(d / 30)} months ago`;

const chipsOf = (c: Context): string[] => [
	c.mode === "words" ? "By words" : "By meaning",
	c.scoped ? "In a scope" : "Everywhere",
	c.filters ? plural(c.filters, "filter") : "No filters",
	c.sort,
	`Top ${c.limit}`,
	...(c.titleOnly ? ["Title only"] : []),
];

const footOf = (c: Context): string =>
	`${c.mode === "words" ? "By words" : "By meaning"}, ${c.scoped ? "in a scope" : "no scope"}, ${c.filters ? plural(c.filters, "filter") : "no filter"}, ${c.sort.toLowerCase()}, top ${c.limit} listed.`;

const typosText = (w: WordFact): string => {
	if (!w.typos) return "not tried, found";
	return w.notes.typo ? plural(w.notes.typo, "note") : "tried, none";
};

const readTable = (words: WordFact[], n: Namer): Table => ({
	title: "How each word was read",
	head: ["Word", "Exact", "As a prefix", "Other forms", "Typos"],
	rows: words.map((w) => [
		{ text: w.prefix ? `${n.word(w.word)} (last word)` : n.word(w.word) },
		{ text: plural(w.notes.exact, "note") },
		{ text: w.prefix ? String(w.notes.prefix) : "not a prefix" },
		{ text: String(w.notes.form) },
		{ text: typosText(w) },
	]),
});

const where = (w: WordFact): string => {
	const i = w.inNote;
	if (!i) return "";
	const parts = [i.name ? "name" : null, i.fields ? "other fields" : null, i.body ? `body x${i.body}` : null].filter(
		(x): x is string => x !== null,
	);
	const how = i.kinds.filter((k) => k !== "exact");
	const kinds: Record<WordKind, string> = {
		exact: "",
		prefix: "as a prefix",
		form: "as another form",
		typo: "as a typo",
	};
	return `${parts.join(", ")}${how.length ? ` (${how.map((k) => kinds[k]).join(", ")})` : ""}`;
};

const inNoteTable = (x: WordsExplanation, n: Namer): Table => ({
	title: "Where each word is in this note",
	head: ["Word", "In this note"],
	rows: x.words.map((w) => [
		{ text: n.word(w.word) },
		w.inNote ? { text: where(w), pill: "ok" as const } : { text: "not found", pill: "no" as const },
	]),
});

const factorRows = (x: WordsExplanation): Cell[][] => {
	const f = x.note?.factors;
	if (!f) return [];
	const rows: Cell[][] = [];
	const times = (v: number): string => `x ${v.toFixed(2)}`;
	if (f.name === "exact") rows.push([{ text: "The name is the search" }, { text: times(f.nameFactor) }]);
	else if (f.name === "start")
		rows.push([{ text: "The name starts with the search" }, { text: times(f.nameFactor) }]);
	else if (f.name === "all") rows.push([{ text: "The name has every word" }, { text: times(f.nameFactor) }]);
	if (f.recency > 1.005) rows.push([{ text: `Edited ${days(f.days)}` }, { text: times(f.recency) }]);
	if (f.links > 1.005)
		rows.push([
			{ text: `${plural(f.inLinks, "note")} link${f.inLinks === 1 ? "s" : ""} to it` },
			{ text: times(f.links) },
		]);
	if (f.partial < 0.999) rows.push([{ text: "Only some of the words" }, { text: times(f.partial) }]);
	return rows;
};

const base = (c: Context): Pick<View, "chips" | "tables" | "notes"> => ({ chips: chipsOf(c), tables: [], notes: [] });

/** The search alone: how it was read, and the rule that decided what is listed. */
export const searchView = (c: Context, r: WordsExplanation | MeaningExplanation, n: Namer = realNames): View => {
	if (r.kind === "meaning") return meaningSearch(c, r);
	const { list: l } = r;
	const out: View = { tone: "ok", head: "", detail: null, ...base(c), tables: [readTable(r.words, n)], notes: [] };
	if (!r.words.length) {
		out.tone = "warn";
		out.head = "There is no word to look for in this search.";
	} else if (!l.total) {
		out.tone = "warn";
		out.head = "No note holds these words.";
		const lacking = r.words.filter((w) => !w.notes.exact && !w.notes.prefix && !w.notes.form && !w.notes.typo);
		out.detail = lacking.length
			? `No note has ${list(lacking.map((w) => quoted(n, w.word)))}, even as a longer word, another form or a typo.`
			: "Each word is in some notes, but no note has the words together.";
	} else if (l.relaxed) {
		out.head = "No note holds every word, so notes with some of them are listed.";
		out.detail = `${plural(l.total, "note")} listed, the ones with more of the words first.`;
	} else if (r.words.length === 1) {
		out.head = `${plural(l.total, "note")} hold${l.total === 1 ? "s" : ""} ${quoted(n, r.words[0]?.word ?? "")}.`;
		out.detail = l.total > l.limit ? `Jet lists the best ${l.limit}.` : null;
	} else {
		out.head = `${plural(l.withAll, "note")} hold${l.withAll === 1 ? "s" : ""} every word, so only ${l.withAll === 1 ? "that one is" : "those are"} listed.`;
		out.detail = "Notes with only some of the words are listed only when no note holds them all.";
	}
	if (r.excluded.length) out.notes.push(`Notes with ${list(r.excluded.map((w) => `-${n.word(w)}`))} are left out.`);
	out.notes.push(footOf(c));
	return out;
};

const meaningSearch = (c: Context, r: MeaningExplanation): View => {
	const out: View = { tone: "ok", head: "", detail: null, ...base(c), tables: [], notes: [footOf(c)] };
	if (!r.on) {
		out.tone = "warn";
		out.head = "Search by meaning is not ready.";
		out.detail = "Meaning is off, or its model is not installed.";
		return out;
	}
	if (!r.understood) {
		out.tone = "warn";
		out.head = "The model knows none of the words of this search.";
		out.detail = "It cannot tell which notes are near, so nothing is listed by meaning.";
	} else {
		out.head = `${plural(Math.min(r.list.scored, r.list.k), "note")} listed, the closest first.`;
		out.detail =
			r.list.best !== null
				? `The closest is at ${fixed(r.list.best)}${r.list.cut !== null ? `, the last listed at ${fixed(r.list.cut)}` : ""}.`
				: null;
	}
	out.tables.push({
		title: "The model",
		head: ["", ""],
		rows: [
			[{ text: "Model" }, { text: r.model ?? "none" }],
			[{ text: "Notes with a meaning" }, { text: `${num(r.vectors.have)} of ${num(r.vectors.indexed)}` }],
			[{ text: "Notes compared" }, { text: num(r.list.scored) }],
		],
	});
	return out;
};

/** The first thing wrong with a note that is not listed, as a sentence, or null when it is not one of these. */
const reasonOut = (c: Context, nc: NoteContext, indexed: boolean, allowed: boolean): [string, string | null] | null => {
	if (nc.excluded)
		return [
			"Left out: an exclude rule in Jet's settings leaves out this note.",
			"Notes it matches are never indexed or searched.",
		];
	if (!indexed)
		return [
			"Left out: Jet has not indexed this note yet.",
			c.building
				? `The index is still being built (${num(c.building.done)} of ${num(c.building.total)} notes). It will be found when its turn comes.`
				: "It is new or changed, or its text could not be read. Jet indexes notes as Obsidian tells it about them.",
		];
	if (nc.inScope === false) return ["Left out: this note is outside the scope you searched in.", null];
	if (nc.passesFilters === false) return ["Left out: your filters do not keep this note.", null];
	if (!allowed) return ["Left out: this note is outside the scope or filters.", null];
	return null;
};

/** One note in the search: where it stands, or the first reason it is not listed. */
export const noteView = (
	c: Context,
	r: WordsExplanation | MeaningExplanation,
	nc: NoteContext,
	n: Namer = realNames,
): View => {
	const out: View = { tone: "warn", head: "", detail: null, ...base(c), chips: [], tables: [], notes: [] };
	if (!r.note) return { ...out, head: "Pick a note to explain." };
	if (r.kind === "meaning") return meaningNote(c, r, nc);
	const note = r.note;
	const outside = reasonOut(c, nc, note.indexed, note.allowed);
	if (outside) {
		out.head = outside[0];
		out.detail = outside[1];
		out.notes.push(footOf(c));
		return out;
	}
	const total = r.words.length;
	out.tables.push(inNoteTable(r, n));
	if (note.holdsExcluded.length) {
		out.head = `Left out: it has ${list(note.holdsExcluded.map((w) => quoted(n, w)))}, which the search excludes.`;
		out.detail = "A note with an excluded word is dropped, whatever else it holds.";
	} else if (note.rank !== null && nc.phrase === false) {
		out.head = "Left out: it does not hold the quoted phrase.";
		out.detail = "Jet lists notes that hold the phrase exactly, once the words are found.";
	} else if (note.rank !== null && note.rank <= r.list.limit) {
		out.tone = "ok";
		out.head = `Ranked ${num(note.rank)} of ${num(r.list.total)}.`;
		out.detail =
			total && note.matched === total
				? "It holds every word."
				: `It holds ${note.matched} of the ${total} words.`;
		const rows = factorRows(r);
		if (rows.length) out.tables.push({ title: "What moved it", head: ["", ""], rows });
	} else if (note.rank !== null) {
		out.head = `Below the cut: ranked ${num(note.rank)}, and Jet lists the top ${r.list.limit}.`;
		out.detail = "Narrow the search, or add a word, to bring it up.";
	} else if (note.matched === 0) {
		out.head = "Left out: it holds none of the words.";
		out.detail = "Not as typed, as the start of a longer word, as another form, or as a typo.";
	} else if (note.matched < total && r.list.withAll > 0) {
		const has = r.words.filter((w) => w.inNote).map((w) => quoted(n, w.word));
		const lacks = r.words.filter((w) => !w.inNote).map((w) => quoted(n, w.word));
		out.head = `Left out: it has ${list(has)} but not ${list(lacks)}.`;
		out.detail = `${plural(r.list.withAll, "note")} hold${r.list.withAll === 1 ? "s" : ""} every word, so notes with only some are dropped.`;
	} else {
		out.head = "Not listed, and the reason is not one of Jet's rules.";
		out.detail = "Check that the note is saved. If this looks wrong, copy the support info and report it.";
	}
	if (note.rank === null) out.notes.push("The note is indexed and not excluded.");
	out.notes.push(footOf(c));
	return out;
};

const meaningNote = (c: Context, r: MeaningExplanation, nc: NoteContext): View => {
	const out: View = { tone: "warn", head: "", detail: null, ...base(c), chips: [], tables: [], notes: [footOf(c)] };
	const note = r.note;
	if (!note) return { ...out, head: "Pick a note to explain." };
	if (!r.on) {
		out.head = "Search by meaning is not ready.";
		out.detail = "Meaning is off, or its model is not installed.";
		return out;
	}
	const outside = reasonOut(c, nc, note.indexed, note.allowed);
	if (outside) {
		out.head = outside[0];
		out.detail = outside[1];
		return out;
	}
	if (note.vector === "waiting") {
		out.head = "Not listed: its meaning has not been read yet.";
		out.detail = `${plural(Math.max(0, r.vectors.indexed - r.vectors.have), "note")} still wait for it. Jet reads them in the background.`;
	} else if (note.vector === "none") {
		out.head = "Not listed: the model knows no word of this note.";
		out.detail = "A note it cannot read has no meaning to be near anything.";
	} else if (!r.understood) {
		out.head = "The model knows none of the words of this search.";
		out.detail = "It cannot tell which notes are near, so nothing is listed.";
	} else if (note.rank !== null && note.rank <= r.list.k) {
		out.tone = "ok";
		out.head = `Ranked ${num(note.rank)} of ${num(r.list.k)}, close in meaning.`;
		out.detail = `Its closeness is ${fixed(note.score ?? 0)}; the last listed is at ${fixed(r.list.cut ?? 0)}.`;
	} else if (note.rank !== null) {
		out.head = "Not listed: it is too far from the question.";
		out.detail = `Ranked ${num(note.rank)}. Its closeness is ${fixed(note.score ?? 0)}; the last listed is at ${fixed(r.list.cut ?? 0)}. Jet lists the nearest ${r.list.k}.`;
	} else {
		out.head = "Not listed, and the reason is not one of Jet's rules.";
		out.detail = "If this looks wrong, copy the support info and report it.";
	}
	return out;
};

/** The view as the lines of a report: the verdict, then each table row on a line. */
export const viewLines = (v: View): string[] => [
	v.head,
	...(v.detail ? [v.detail] : []),
	...v.tables.flatMap((t) => [
		`${t.title}:`,
		...t.rows.map(
			(r) =>
				`  ${r
					.map((x) => x.text)
					.filter(Boolean)
					.join(" | ")}`,
		),
	]),
	...v.notes,
];
