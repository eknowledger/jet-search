import type { Hit, QueryOptions, QueryResult } from "./jet-engine";
import type { Query } from "./query";
import type { Segment } from "./segment";

/**
 * Why a search listed what it did, and why one note is where it is or not there: the facts only (numbers
 * and flags), computed when asked. The search itself never calls this and is not changed by it: the note's
 * place comes from running the real query once, and the rest from lookups in the index for that one note.
 * The words of the answer are made elsewhere.
 */

/** How a typed word reached an index term. */
export type WordKind = "exact" | "prefix" | "form" | "typo";

export type WordFact = {
	word: string;
	/** The last word as typed: also read as the start of longer words. */
	prefix: boolean;
	/** Live notes each kind of match reaches (a note counts once for each kind). */
	notes: Record<WordKind, number>;
	/** Typos were tried: the word is in fewer notes than the limit. */
	typos: boolean;
	/** Spelled exactly in at least one note but in few: those notes go first. */
	rare: boolean;
	/** In the asked-about note: how it reached the word, and where. Null: no note asked about, or none of it. */
	inNote: { kinds: WordKind[]; name: boolean; fields: boolean; body: number } | null;
};

export type Factors = {
	/** The name is the typed words, starts with them, or has every one of them. */
	name: "exact" | "start" | "all" | null;
	nameFactor: number;
	days: number;
	recency: number;
	inLinks: number;
	links: number;
	/** The share of words matched, squared, when no note had them all. */
	partial: number;
};

export type NoteFact = {
	/** The index holds the note. */
	indexed: boolean;
	/** The allowed set (scope, filters) lets it through. */
	allowed: boolean;
	/** How many of the words it holds, in any form. */
	matched: number;
	/** The excluded words it holds. */
	holdsExcluded: string[];
	/** Its place in the whole list (1 is best), when it is in it. */
	rank: number | null;
	score: number | null;
	factors: Factors | null;
};

export type WordsExplanation = {
	kind: "words";
	words: WordFact[];
	excluded: string[];
	list: {
		/** Notes listed before the cut. */
		total: number;
		/** Notes that hold every word. */
		withAll: number;
		/** No note holds every word: the list is of notes with some. */
		relaxed: boolean;
		/** What the window shows: the rest is cut. */
		limit: number;
	};
	note: NoteFact | null;
};

export type ExplainOptions = { limit: number; now: number; allow?: (path: string) => boolean };

type Expansion = { t: number; w: number; e: number };
type Part = { seg: Segment; dead: Uint8Array | null };

/** What the engine lends: its parts and the lookups the query uses, so the two read the index the same way. */
export type Kit = {
	parts: Part[];
	size: number;
	typosBelow: number;
	expand: (seg: Segment, word: string, isLast: boolean, typos: boolean) => Expansion[];
	exactTerm: (seg: Segment, word: string) => number;
	/** In how many live notes word `i`'s own expansions occur (counted up to the typo limit). */
	liveNotes: (own: Expansion[][][], i: number) => number;
	/** Where a live note is: its part and its number there. */
	locate: (path: string) => { p: number; d: number } | null;
	query: (q: Query, opts: QueryOptions) => QueryResult;
};

const DAY = 86_400_000;

const kindOf = (seg: Segment, x: Expansion, exact: number, word: string, isLast: boolean): WordKind => {
	if (x.t === exact || (x.e === 0 && x.w >= 0.9)) return "exact";
	if (x.e > 0) return "typo";
	if (isLast && (seg.terms[x.t] as string).startsWith(word)) return "prefix";
	return "form";
};

/** The note's postings for a term: in its name, in other indexed fields, and how many times in the body. */
const holds = (seg: Segment, t: number, d: number): { name: boolean; fields: boolean; body: number } => {
	let name = false;
	let fields = false;
	for (let k = seg.metaOff[t] as number, end = seg.metaOff[t + 1] as number; k < end; k++) {
		if (seg.metaDocs[k] !== d) continue;
		if (seg.metaInName[k]) name = true;
		else fields = true;
	}
	let body = 0;
	seg.forBody(t, (doc, tf) => {
		if (doc === d) body = tf;
	});
	return { name, fields, body };
};

const has = (seg: Segment, word: string, d: number, kit: Kit): boolean => {
	const t = kit.exactTerm(seg, word);
	if (t < 0) return false;
	const h = holds(seg, t, d);
	return h.name || h.fields || h.body > 0;
};

/**
 * `path` null explains the search alone. The real query runs once with no cut, so the note's rank and score
 * are the ones a search gives.
 */
export const explainWords = (kit: Kit, q: Query, path: string | null, o: ExplainOptions): WordsExplanation => {
	const { parts } = kit;
	const n = q.words.length;
	const at = path !== null ? kit.locate(path) : null;
	const isLast = (i: number): boolean => q.lastIsPrefix && i === n - 1;
	const own = parts.map(({ seg }) => q.words.map((w, i) => kit.expand(seg, w, isLast(i), false)));
	const words: WordFact[] = q.words.map((word, i) => {
		const typos = kit.liveNotes(own, i) < kit.typosBelow;
		const seen: Record<WordKind, Set<number>> = {
			exact: new Set(),
			prefix: new Set(),
			form: new Set(),
			typo: new Set(),
		};
		let rareNotes = 0;
		const found = new Set<WordKind>();
		let name = false;
		let fields = false;
		let body = 0;
		for (const [p, { seg, dead }] of parts.entries()) {
			const exact = kit.exactTerm(seg, word);
			if (exact >= 0) rareNotes += seg.df[exact] as number;
			for (const x of kit.expand(seg, word, isLast(i), typos)) {
				const kind = kindOf(seg, x, exact, word, isLast(i));
				const add = (d: number): void => {
					if (!dead?.[d]) seen[kind].add(p * 0x1000000 + d);
				};
				for (let k = seg.metaOff[x.t] as number, end = seg.metaOff[x.t + 1] as number; k < end; k++)
					add(seg.metaDocs[k] as number);
				seg.forBody(x.t, add);
				if (at && at.p === p) {
					const h = holds(seg, x.t, at.d);
					if (h.name || h.fields || h.body) {
						found.add(kind);
						name ||= h.name;
						fields ||= h.fields;
						body += h.body;
					}
				}
			}
		}
		return {
			word,
			prefix: isLast(i),
			notes: {
				exact: seen.exact.size,
				prefix: seen.prefix.size,
				form: seen.form.size,
				typo: seen.typo.size,
			},
			typos,
			rare: rareNotes > 0 && rareNotes < kit.typosBelow,
			inNote: at && found.size ? { kinds: [...found], name, fields, body } : null,
		};
	});

	// The real list, uncut: what a search would show, and where the note stands in it.
	const hits: Hit[] = n ? kit.query(q, { limit: Math.max(1, kit.size), now: o.now, allow: o.allow }).hits : [];
	const withAll = hits.filter((h) => h.matched === n).length;
	const list = { total: hits.length, withAll, relaxed: n > 0 && withAll === 0 && hits.length > 0, limit: o.limit };
	const base = { kind: "words" as const, words, excluded: [...q.excluded], list };
	if (path === null) return { ...base, note: null };

	const matched = words.filter((w) => w.inNote).length;
	const holdsExcluded: string[] = [];
	if (at) {
		const { seg } = parts[at.p] as Part;
		for (const w of q.excluded) if (has(seg, w, at.d, kit)) holdsExcluded.push(w);
		for (const g of q.groups ?? []) if (g.every((w) => has(seg, w, at.d, kit))) holdsExcluded.push(g.join(" "));
	}
	const place = hits.findIndex((h) => h.path === path);
	const hit = place >= 0 ? (hits[place] as Hit) : null;
	let factors: Factors | null = null;
	if (hit && at) {
		const { seg } = parts[at.p] as Part;
		const typed = q.words.join(" ");
		const name = seg.names[at.d] as string;
		const every = words.length > 0 && words.every((w) => w.inNote?.name);
		const kind =
			name === typed
				? "exact"
				: name.startsWith(q.lastIsPrefix ? typed : `${typed} `)
					? "start"
					: every
						? "all"
						: null;
		const days = Math.max(0, (o.now - (seg.mtime[at.d] as number)) / DAY);
		const inLinks = seg.inLinks[at.d] as number;
		factors = {
			name: kind,
			nameFactor: kind === "exact" ? 2 : kind === "start" ? 1.5 : kind === "all" ? 1.4 : 1,
			days,
			recency: 1 + 0.2 * Math.exp(-days / 45),
			inLinks,
			links: 1 + 0.08 * Math.log2(1 + inLinks),
			partial: list.relaxed ? (hit.matched / n) ** 2 : 1,
		};
	}
	return {
		...base,
		note: {
			indexed: at !== null,
			allowed: o.allow ? o.allow(path) : true,
			matched,
			holdsExcluded,
			rank: place >= 0 ? place + 1 : null,
			score: hit ? hit.score : null,
			factors,
		},
	};
};
