import sqlite3InitModule, { type Database, type PreparedStatement, type Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { noTypos } from "../src/engine/analyzer";
import { FIELDS, fieldsFromMarkdown, type NoteFields, WEIGHTS } from "../src/engine/fields";
import { countInbound } from "../src/engine/jet-engine";
import { parseQuery, type Query } from "../src/engine/query";
import { B_BODY, B_META, sat } from "../src/engine/segment";
import { lowerBound, prefixRange, typoBudget, typoMatches } from "../src/engine/typos";
import type { BenchEngine, BenchNote } from "./engine";

/**
 * SQLite FTS5 (WASM) for the engine bake-off, tuned as follows: one
 * contentless table, detail=column or none, no prefix indexes, a capped page cache, our analyzer's terms
 * (FTS5's `ascii` tokenizer then splits on spaces and changes nothing), and our expansion run over
 * FTS5's word list.
 *
 * Ranking. A contentless table with detail=column or none has no positions, and FTS5 rebuilds a row's
 * term instances from its stored text, of which there is none: bm25() is 0 for every row. So with those
 * details FTS5 is the inverted index (per term, its notes and, with detail=column, their columns) and the
 * scoring is ours in JS, each count taken as 1 (detail=column keeps no counts; detail=none keeps no
 * columns, so a name hit is found in the side table's names). detail=full keeps positions, so bm25() works:
 * that variant runs the plain FTS5 design (a MATCH expression, bm25 with field weights, our boosts on the
 * top 200), for reference.
 *
 * Word list. fts5vocab recounts every term's doclist as it lists the terms, a scan of the whole index
 * (about 50 ms here), so by default a copy of the word list and its note counts is kept in the database.
 */
export type Fts5Variant = {
	/** column: notes and columns per term; none: notes only; full: positions too (bm25 works, file larger). */
	detail: "column" | "none" | "full";
	/** PRAGMA cache_size of the loaded database: negative is KiB (-2000 = 2 MB; this build's default is -16384). */
	cache?: number;
	/** Where the word list comes from: a copy in the database (default) or the fts5vocab table. */
	vocab?: "copy" | "fts5vocab";
};

const COLS = [...FIELDS, "body"] as const;
const NC = COLS.length;
const BODY = NC - 1;
/** Column weights for bm25(): the meta fields', then the body's 1. */
const COL_WEIGHTS = [...FIELDS.map((f) => WEIGHTS[f]), 1];
/** fts5vocab names a term's column; the body (most rows) is tested first. */
const COL_ID = `CASE col WHEN 'body' THEN ${BODY} ${FIELDS.map((c, i) => `WHEN '${c}' THEN ${i}`).join(" ")} END`;

/** Postings of the terms in a JSON array, one row per term: "doc·16 + column, …" from fts5vocab "instance". */
const POSTINGS_COLUMN = `SELECT j.value, (SELECT group_concat(doc * 16 + ${COL_ID}) FROM vi WHERE term = j.value)
	FROM json_each(?) j`;
/** The same as "doc, …" from each term's MATCH doclist (faster than fts5vocab when no columns are needed). */
const POSTINGS_NONE = `SELECT j.value, (SELECT group_concat(rowid) FROM ft WHERE ft MATCH '"' || j.value || '"')
	FROM json_each(?) j`;

// Expansion weights and limits, as src/engine/jet-engine.ts has them.
const EXACT = 1;
const PREFIX = 0.7;
const PREFIX_LIMIT = 64;
const TYPO1 = 0.55;
const TYPO2 = 0.35;
const FUZZY_PREFIX = 0.4;
const FUZZY_LIMIT = 200;
const DAY = 86_400_000;
const TOP = 50;
/** bm25 path: rows re-scored with our boosts. */
const RESCORE = 200;
const SEP = "\u0001";

let sqlite3: Sqlite3Static | null = null;

/** Instantiates the WASM module once. The engine's calls are synchronous, so a runner awaits this first. */
/** Start SQLite's WASM once. `wasmBinary`: the module's bytes, where it cannot fetch its own file (a Blob worker). */
export const initFts5 = async (opts: { wasmBinary?: ArrayBuffer } = {}): Promise<Sqlite3Static> =>
	(sqlite3 ??= await (sqlite3InitModule as unknown as (o?: object) => Promise<Sqlite3Static>)(opts));

const lib = (): Sqlite3Static => {
	if (!sqlite3) throw new Error("await initFts5() before using the FTS5 engine");
	return sqlite3;
};

/** The word list, sorted as JS compares strings, with each term's note count. */
type Vocab = { terms: string[]; df: number[] };
type Expansion = { t: number; w: number; e: number };
type Candidate = { d: number; matched: number; edits: number; score: number };
/** Whether the AND query found notes (else the OR fallback's notes are scaled by their share of words). */
type Share = { all: boolean; words: number };

const exactTerm = (terms: readonly string[], word: string): number => {
	const i = lowerBound(terms, word);
	return terms[i] === word ? i : -1;
};

/** The vocabulary terms a typed word matches, with how much each counts (jet-engine.ts `expand`). */
const expand = (v: Vocab, word: string, isLast: boolean): Expansion[] => {
	const { terms, df } = v;
	const best = new Map<number, Expansion>();
	const put = (t: number, w: number, e: number): void => {
		const cur = best.get(t);
		if (!cur || w > cur.w) best.set(t, { t, w, e });
	};
	const exact = exactTerm(terms, word);
	if (exact >= 0) put(exact, EXACT, 0);
	const len = word.length;
	if (isLast && len >= 2) {
		const [from, to] = prefixRange(terms, word);
		let range = Array.from({ length: to - from }, (_, k) => from + k).filter((t) => t !== exact);
		if (range.length > PREFIX_LIMIT)
			range = range.sort((a, b) => (df[b] as number) - (df[a] as number)).slice(0, PREFIX_LIMIT);
		for (const t of range) put(t, PREFIX * Math.sqrt(len / (terms[t] as string).length), 0);
	}
	const budget = noTypos(word) ? 0 : typoBudget(word);
	if (budget > 0) {
		const fuzzy = isLast && len >= 4;
		let fuzzyCount = 0;
		for (const m of typoMatches(terms, word, budget, { fuzzyPrefix: fuzzy, prefixBudget: 1, limit: 500 })) {
			if (!m.prefix) put(m.index, m.edits === 1 ? TYPO1 : TYPO2, m.edits);
			else if (m.edits > 0 && fuzzyCount++ < FUZZY_LIMIT) put(m.index, FUZZY_PREFIX, m.edits);
		}
	}
	return [...best.values()];
};

/** Ranking key: more words matched, then fewer typo edits, then higher score. */
const byKey = (a: Candidate, b: Candidate): number => b.matched - a.matched || a.edits - b.edits || b.score - a.score;

const nameOf = (path: string): string => (path.split("/").pop() ?? path).replace(/\.md$/i, "").toLowerCase();

/** A field's terms as one string for FTS5; with detail=column or none a term counts once per column. */
const joined = (terms: string[], dedupe: boolean): string => (dedupe ? [...new Set(terms)] : terms).join(" ");

/** Reads "1,22,333" (group_concat of integers) without building an array. */
const eachInt = (s: string, f: (v: number) => void): void => {
	let v = 0;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c === 44) {
			f(v);
			v = 0;
		} else v = v * 10 + c - 48;
	}
	if (s.length) f(v);
};

/** Per-note arrays, stamps marking which entries the current query or word has written. */
class Scratch {
	readonly total: Float64Array;
	readonly matched: Uint32Array;
	readonly edits: Uint16Array;
	readonly qStamp: Uint32Array;
	readonly best: Float64Array;
	readonly bestEdits: Uint8Array;
	readonly wStamp: Uint32Array;
	readonly xStamp: Uint32Array;
	q = 0;
	w = 0;

	constructor(n: number) {
		this.total = new Float64Array(n);
		this.matched = new Uint32Array(n);
		this.edits = new Uint16Array(n);
		this.qStamp = new Uint32Array(n);
		this.best = new Float64Array(n);
		this.bestEdits = new Uint8Array(n);
		this.wStamp = new Uint32Array(n);
		this.xStamp = new Uint32Array(n);
	}
}

const popcount = (x: number): number => {
	let v = x - ((x >>> 1) & 0x55555555);
	v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
	return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};

/** Whether every query word is in the note's name, as itself or one of its expansions. */
const allWordsIn = (name: string, wordTerms: readonly Set<string>[]): boolean => {
	const tokens = name.split(" ");
	return wordTerms.every((set) => tokens.some((t) => set.has(t)));
};

/** Tuned SQLite FTS5 (WASM) behind the bench's engine interface. */
export const fts5Engine = (variant: Fts5Variant = { detail: "column" }): BenchEngine => {
	const { detail } = variant;
	const cache = variant.cache ?? -2000;
	const copy = (variant.vocab ?? "copy") === "copy";
	const dedupe = detail !== "full";
	const now = Date.now();
	const label = [`detail=${detail}`, ...(variant.cache === undefined ? [] : [`cache ${variant.cache}`])];
	if (!copy) label.push("fts5vocab");
	let db: Database | null = null;
	const stmts = new Map<string, PreparedStatement>();
	// Side data by rowid (ids start at 1; slot 0 unused): path, modified time, inbound links, name terms.
	let paths: string[] = [];
	let mtimes: number[] = [];
	let inbound: number[] = [];
	let names: string[] = [];
	/** Per note and column: our field score of one occurrence (weight × BM25 saturation of a count of 1). */
	let fieldScore = new Float32Array(0);
	let averages: number[] = [];
	let byPath = new Map<string, number>();
	let byName: Map<string, number> | null = null;
	let live = 0;
	let maxId = 0;
	let scratch = new Scratch(1);
	let vocab: Vocab | null = null;
	/** The word list changed since the copy in the database was written. */
	let vocabDirty = false;
	/** detail=none: the notes each name term is in (from the side table). */
	let nameIndex: Map<string, Set<number>> | null = null;

	const open = (): Database => {
		if (!db) throw new Error("no index: build or load first");
		return db;
	};
	const stmt = (sql: string): PreparedStatement => {
		let s = stmts.get(sql);
		if (!s) stmts.set(sql, (s = open().prepare(sql)));
		return s;
	};
	const close = (): void => {
		for (const s of stmts.values()) s.finalize();
		stmts.clear();
		db?.close();
		db = null;
	};
	const scalar = (sql: string, bind?: (string | number)[]): string | null => {
		const s = stmt(sql);
		try {
			if (bind) s.bind(bind);
			return s.step() ? (s.get(0) as string | null) : null;
		} finally {
			s.reset(true);
		}
	};

	/** Room for ids up to `n`: the field scores and the scratch arrays grow. */
	const reserve = (n: number): void => {
		if (fieldScore.length >= (n + 1) * NC) return;
		const cap = Math.max(n + 1, Math.ceil(fieldScore.length / NC) * 2);
		const f = new Float32Array(cap * NC);
		f.set(fieldScore);
		fieldScore = f;
		scratch = new Scratch(cap);
	};

	const setDoc = (id: number, path: string, mtime: number, links: number, name: string, lens: number[]): void => {
		reserve(id);
		paths[id] = path;
		mtimes[id] = mtime;
		inbound[id] = links;
		names[id] = name;
		for (let c = 0; c < NC; c++) {
			const len = lens[c] as number;
			const avg = averages[c] as number;
			const w = COL_WEIGHTS[c] as number;
			fieldScore[id * NC + c] = !len ? 0 : c === BODY ? sat(1, len, avg, B_BODY) : w * sat(1, len, avg, B_META);
		}
	};

	const insert = (id: number, path: string, mtime: number, links: number, f: NoteFields): void => {
		stmt(`INSERT INTO ft(rowid, ${COLS.join(", ")}) VALUES (?${", ?".repeat(NC)})`)
			.bind([id, ...COLS.map((c) => joined(f[c], dedupe))])
			.stepReset();
		const lens = COLS.map((c) => f[c].length);
		const name = f.name.join(" ");
		stmt("INSERT OR REPLACE INTO docs VALUES (?, ?, ?, ?, ?, ?)")
			.bind([id, path, mtime, links, name, lens.join(",")])
			.stepReset();
		setDoc(id, path, mtime, links, name, lens);
	};

	const reset = (): void => {
		paths = [];
		mtimes = [];
		inbound = [];
		names = [];
		fieldScore = new Float32Array(0);
		byPath = new Map();
		byName = null;
		vocab = null;
		vocabDirty = false;
		nameIndex = null;
		live = 0;
		maxId = 0;
	};

	/** FTS5's own word list (fts5vocab "row": term, notes), sorted as JS compares (FTS5 sorts UTF-8 bytes). */
	const readFts5Vocab = (): Vocab => {
		const s = stmt("SELECT group_concat(term, char(1)), group_concat(doc) FROM vr WHERE doc > 0");
		let terms: string[] = [];
		const df: number[] = [];
		try {
			if (s.step()) {
				terms = ((s.get(0) as string | null) ?? "").split(SEP);
				eachInt((s.get(1) as string | null) ?? "", (v) => df.push(v));
			}
		} finally {
			s.reset();
		}
		if (terms.length === 1 && terms[0] === "") terms = [];
		let sorted = true;
		for (let i = 1; i < terms.length && sorted; i++)
			if ((terms[i - 1] as string) > (terms[i] as string)) sorted = false;
		if (sorted) return { terms, df };
		const order = terms.map((_, i) => i).sort((a, b) => ((terms[a] as string) < (terms[b] as string) ? -1 : 1));
		return { terms: order.map((i) => terms[i] as string), df: order.map((i) => df[i] as number) };
	};
	/** The copy of the word list kept in the database (written sorted). */
	const readCopy = (): Vocab => {
		const joinedTerms = scalar("SELECT v FROM info WHERE k = 'terms'") ?? "";
		const df: number[] = [];
		eachInt(scalar("SELECT v FROM info WHERE k = 'df'") ?? "", (v) => df.push(v));
		return { terms: joinedTerms ? joinedTerms.split(SEP) : [], df };
	};
	const words = (): Vocab => (vocab ??= copy ? readCopy() : readFts5Vocab());
	const writeCopy = (): void => {
		if (!copy || !vocab || !vocabDirty) return;
		stmt("INSERT OR REPLACE INTO info VALUES ('terms', ?), ('df', ?)")
			.bind([vocab.terms.join(SEP), vocab.df.join(",")])
			.stepReset();
		vocabDirty = false;
	};

	/** A changed note's new terms join the word list, as in one note (the old version's counts stay). */
	const addTerms = (f: NoteFields): void => {
		if (!copy) {
			vocab = null;
			return;
		}
		const { terms, df } = words();
		const fresh = [...new Set(COLS.flatMap((c) => f[c]))].filter((t) => exactTerm(terms, t) < 0).sort();
		if (!fresh.length) return;
		const t2: string[] = [];
		const d2: number[] = [];
		let k = 0;
		for (let i = 0; i < terms.length; i++) {
			while (k < fresh.length && (fresh[k] as string) < (terms[i] as string)) {
				t2.push(fresh[k++] as string);
				d2.push(1);
			}
			t2.push(terms[i] as string);
			d2.push(df[i] as number);
		}
		for (; k < fresh.length; k++) {
			t2.push(fresh[k] as string);
			d2.push(1);
		}
		vocab = { terms: t2, df: d2 };
		vocabDirty = true;
	};

	/**
	 * Postings of several terms in one statement, built in SQLite: "doc·16 + column, …" from the fts5vocab
	 * "instance" table (detail=column), or "doc, …" from a MATCH doclist (detail=none).
	 */
	const postings = (terms: Iterable<string>): Map<string, string> => {
		const s = stmt(detail === "column" ? POSTINGS_COLUMN : POSTINGS_NONE);
		const out = new Map<string, string>();
		try {
			s.bind([JSON.stringify([...terms])]);
			while (s.step()) {
				const list = s.get(1) as string | null;
				if (list) out.set(s.get(0) as string, list);
			}
		} finally {
			s.reset(true);
		}
		return out;
	};

	const byNameTerm = (): Map<string, Set<number>> => {
		if (nameIndex) return nameIndex;
		const m = new Map<string, Set<number>>();
		names.forEach((name, id) => {
			if (!paths[id]) return;
			for (const t of name.split(" ")) {
				let s = m.get(t);
				if (!s) m.set(t, (s = new Set()));
				s.add(id);
			}
		});
		return (nameIndex = m);
	};

	/** Title, recency and inbound-link boosts, the OR fallback's share scaling, then the top 50. */
	const finish = (pool: Candidate[], q: Query, n: Share, wordTerms: Set<string>[]): string[] => {
		const typed = q.words.join(" ");
		for (const c of pool) {
			let score = c.score;
			if (!n.all) score *= (c.matched / n.words) ** 2;
			const name = names[c.d] as string;
			if (name === typed) score *= 2;
			else if (name.startsWith(q.lastIsPrefix ? typed : `${typed} `)) score *= 1.5;
			else if (allWordsIn(name, wordTerms)) score *= 1.4;
			const days = Math.max(0, (now - (mtimes[c.d] as number)) / DAY);
			score *= 1 + 0.2 * Math.exp(-days / 45);
			score *= 1 + 0.08 * Math.log2(1 + (inbound[c.d] as number));
			c.score = score;
		}
		return pool
			.sort(byKey)
			.slice(0, TOP)
			.map((c) => paths[c.d] as string);
	};

	/** detail=column / none: our scoring over FTS5's postings, every count taken as 1. */
	const queryPostings = (q: Query, keep?: (path: string) => boolean): string[] => {
		const v = words();
		const n = q.words.length;
		const N = Math.max(1, live);
		const s = scratch;
		const S = fieldScore;
		const exps = q.words.map((w, i) => expand(v, w, q.lastIsPrefix && i === n - 1));
		const excluded = q.excluded.filter((w) => exactTerm(v.terms, w) >= 0);
		const lists = postings(new Set([...exps.flatMap((xs) => xs.map((x) => v.terms[x.t] as string)), ...excluded]));
		const nameDocs = detail === "none" ? byNameTerm() : null;
		s.q++;
		const touchedQ: number[] = [];
		const wordTerms: Set<string>[] = [];
		exps.forEach((xs, i) => {
			s.w++;
			const touchedW: number[] = [];
			const found = new Set<string>();
			for (const x of xs) {
				const term = v.terms[x.t] as string;
				const list = lists.get(term);
				if (!list) continue;
				found.add(term);
				const df = v.df[x.t] as number;
				const f = x.w * Math.log(1 + (N - df + 0.5) / (df + 0.5));
				// Max over a word's expansions; a note's columns for one term add up first.
				const credit = (d: number, sum: number): void => {
					const c = f * sum;
					if (s.wStamp[d] !== s.w) {
						s.wStamp[d] = s.w;
						s.best[d] = c;
						s.bestEdits[d] = x.e;
						touchedW.push(d);
					} else if (c > (s.best[d] as number)) {
						s.best[d] = c;
						s.bestEdits[d] = x.e;
					}
				};
				if (nameDocs) {
					const inName = nameDocs.get(term);
					eachInt(list, (d) =>
						credit(d, (S[d * NC + BODY] as number) + (inName?.has(d) ? (S[d * NC] as number) : 0)),
					);
					continue;
				}
				let cur = -1;
				let sum = 0;
				eachInt(list, (e) => {
					const d = e >>> 4;
					if (d !== cur) {
						if (cur >= 0) credit(cur, sum);
						cur = d;
						sum = 0;
					}
					sum += S[d * NC + (e & 15)] as number;
				});
				if (cur >= 0) credit(cur, sum);
			}
			wordTerms.push(found);
			const bit = 1 << Math.min(i, 31);
			for (const d of touchedW) {
				if (s.qStamp[d] !== s.q) {
					s.qStamp[d] = s.q;
					s.total[d] = 0;
					s.matched[d] = 0;
					s.edits[d] = 0;
					touchedQ.push(d);
				}
				s.total[d] = (s.total[d] as number) + (s.best[d] as number);
				s.matched[d] = (s.matched[d] as number) | bit;
				s.edits[d] = (s.edits[d] as number) + (s.bestEdits[d] as number);
			}
		});
		// Exclusions: notes with an excluded word are dropped.
		for (const word of excluded) {
			const list = lists.get(word);
			if (list) eachInt(list, (e) => (s.xStamp[detail === "column" ? e >>> 4 : e] = s.q));
		}
		const candidates: Candidate[] = [];
		for (const d of touchedQ) {
			if (s.xStamp[d] === s.q) continue;
			if (keep && !keep(paths[d] as string)) continue;
			const matched = popcount(s.matched[d] as number);
			candidates.push({ d, matched, edits: s.edits[d] as number, score: s.total[d] as number });
		}
		// AND first; if no note has every word, notes with some, scaled by the share matched.
		const all = candidates.filter((c) => c.matched === n);
		return finish(all.length ? all : candidates, q, { all: all.length > 0, words: n }, wordTerms);
	};

	/** Rows of a MATCH expression in bm25 order (rank = bm25 with our column weights; lower is better). */
	const match = (expr: string, limit: number): Array<[number, number]> => {
		const s = stmt("SELECT rowid, rank FROM ft WHERE ft MATCH ? ORDER BY rank LIMIT ?");
		const out: Array<[number, number]> = [];
		try {
			s.bind([expr, limit]);
			while (s.step()) out.push([s.get(0) as number, s.get(1) as number]);
		} finally {
			s.reset(true);
		}
		return out;
	};

	/**
	 * detail=full: the plain FTS5 design. Per word an OR group of its expansions, AND across words, NOT for
	 * exclusions; bm25 cannot weight one OR term over another (it sums them), so the expansion weights
	 * become tiers: the query with exact and prefix terms first, then the one with typo terms adds the notes
	 * it alone finds (ranked after, as fewer edits rank first). OR fallback when no note has every
	 * word, with each note's count of words from one doclist per word.
	 */
	const queryMatch = (q: Query, keep?: (path: string) => boolean): string[] => {
		const v = words();
		const n = q.words.length;
		const exps = q.words.map((w, i) => expand(v, w, q.lastIsPrefix && i === n - 1));
		const group = (xs: Expansion[]): string => `(${xs.map((x) => `"${v.terms[x.t] as string}"`).join(" OR ")})`;
		const excluded = q.excluded.filter((w) => exactTerm(v.terms, w) >= 0);
		const not = excluded.length ? ` NOT (${excluded.map((w) => `"${w}"`).join(" OR ")})` : "";
		const wordTerms = exps.map((xs) => new Set(xs.map((x) => v.terms[x.t] as string)));
		const limit = keep ? -1 : RESCORE;
		const found = new Map<number, Candidate>();
		const add = (rows: Array<[number, number]>, matched: number, edits: number): void => {
			for (const [d, rank] of rows)
				if (!found.has(d) && (!keep || keep(paths[d] as string)))
					found.set(d, { d, matched, edits, score: -rank });
		};
		if (exps.every((xs) => xs.length)) {
			const zero = exps.map((xs) => xs.filter((x) => x.e === 0));
			if (zero.every((xs) => xs.length)) add(match(zero.map(group).join(" AND ") + not, limit), n, 0);
			if (exps.some((xs, i) => xs.length > (zero[i] as Expansion[]).length))
				add(match(exps.map(group).join(" AND ") + not, limit), n, 1);
		}
		if (found.size) return finish([...found.values()], q, { all: true, words: n }, wordTerms);
		const some = exps.filter((xs) => xs.length);
		if (!some.length) return [];
		add(match(`(${some.map(group).join(" OR ")})${not}`, limit), 0, 0);
		for (const xs of some) {
			const ids = scalar("SELECT group_concat(rowid) FROM ft WHERE ft MATCH ?", [group(xs)]);
			if (ids)
				eachInt(ids, (d) => {
					const c = found.get(d);
					if (c) c.matched++;
				});
		}
		return finish([...found.values()], q, { all: false, words: n }, wordTerms);
	};

	return {
		name: `fts5 (${label.join(", ")})`,
		build(notes: BenchNote[]) {
			close();
			reset();
			const s = lib();
			db = new s.oo1.DB(":memory:", "c");
			db.exec(`PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;
				CREATE VIRTUAL TABLE ft USING fts5(${COLS.join(", ")},
					content='', contentless_delete=1, detail=${detail}, tokenize='ascii');
				CREATE VIRTUAL TABLE vr USING fts5vocab(ft, row);
				CREATE VIRTUAL TABLE vi USING fts5vocab(ft, instance);
				CREATE TABLE docs(id INTEGER PRIMARY KEY, path TEXT NOT NULL, mtime REAL NOT NULL,
					inbound INTEGER NOT NULL, name TEXT NOT NULL, lens TEXT NOT NULL);
				CREATE TABLE info(k TEXT PRIMARY KEY, v TEXT NOT NULL);`);
			if (detail === "full")
				db.exec(`INSERT INTO ft(ft, rank) VALUES ('rank', 'bm25(${COL_WEIGHTS.join(", ")})')`);
			const inputs = notes.map((n) => ({ note: n, ...fieldsFromMarkdown(n.path, n.text) }));
			const links = countInbound(
				inputs.map((x) => ({ path: x.note.path, mtime: 0, fields: x.fields, linkTargets: x.linkTargets })),
			);
			const count = Math.max(1, inputs.length);
			averages = COLS.map((c) => Math.max(1, inputs.reduce((a, x) => a + x.fields[c].length, 0) / count));
			db.exec({
				sql: "INSERT INTO info VALUES ('averages', ?), ('detail', ?)",
				bind: [JSON.stringify(averages), detail],
			});
			reserve(inputs.length);
			const df = new Map<string, number>();
			db.exec("BEGIN");
			inputs.forEach((x, i) => {
				const id = i + 1;
				insert(id, x.note.path, x.note.mtime, links.get(nameOf(x.note.path)) ?? 0, x.fields);
				byPath.set(x.note.path, id);
				if (copy) for (const t of new Set(COLS.flatMap((c) => x.fields[c]))) df.set(t, (df.get(t) ?? 0) + 1);
			});
			if (copy) {
				const terms = [...df.keys()].sort();
				vocab = { terms, df: terms.map((t) => df.get(t) as number) };
				vocabDirty = true;
				writeCopy();
			}
			db.exec("COMMIT");
			// One b-tree segment instead of the many the inserts flushed, then the freed pages dropped: 8.0 → 3.9 MB.
			db.exec("INSERT INTO ft(ft) VALUES ('optimize'); VACUUM; PRAGMA journal_mode = MEMORY");
			live = maxId = notes.length;
		},
		save() {
			writeCopy();
			return lib().capi.sqlite3_js_db_export(open());
		},
		load(buf: Uint8Array) {
			close();
			reset();
			const s = lib();
			db = new s.oo1.DB(":memory:", "c");
			// The bytes are copied into WASM memory; SQLite frees them when the database closes.
			const p = s.wasm.allocFromTypedArray(buf);
			const flags = s.capi.SQLITE_DESERIALIZE_FREEONCLOSE | s.capi.SQLITE_DESERIALIZE_RESIZEABLE;
			const rc = s.capi.sqlite3_deserialize(db, "main", p, buf.byteLength, buf.byteLength, flags);
			if (rc) throw new Error(`sqlite3_deserialize: ${rc}`);
			db.exec(`PRAGMA cache_size = ${cache}; PRAGMA journal_mode = MEMORY`);
			if (scalar("SELECT v FROM info WHERE k = 'detail'") !== detail)
				throw new Error(`index is not detail=${detail}`);
			averages = JSON.parse(scalar("SELECT v FROM info WHERE k = 'averages'") ?? "[]") as number[];
			const rows = JSON.parse(
				scalar("SELECT json_group_array(json_array(id, path, mtime, inbound, name, lens)) FROM docs") ?? "[]",
			) as Array<[number, string, number, number, string, string]>;
			for (const r of rows) maxId = Math.max(maxId, r[0]);
			reserve(maxId);
			for (const [id, path, mtime, links, name, lens] of rows) {
				setDoc(id, path, mtime, links, name, lens.split(",").map(Number));
				byPath.set(path, id);
			}
			live = rows.length;
		},
		query(input: string, keep?: (path: string) => boolean) {
			const q = parseQuery(input);
			if (!q.words.length || !live) return [];
			return detail === "full" ? queryMatch(q, keep) : queryPostings(q, keep);
		},
		update(n: BenchNote) {
			const f = fieldsFromMarkdown(n.path, n.text).fields;
			const d = open();
			let id = byPath.get(n.path);
			let links: number;
			d.exec("BEGIN");
			if (id === undefined) {
				id = ++maxId;
				byPath.set(n.path, id);
				live++;
				if (!byName) {
					byName = new Map();
					for (let i = 1; i < paths.length; i++) if (paths[i]) byName.set(nameOf(paths[i] as string), i);
				}
				const other = byName.get(nameOf(n.path));
				links = other === undefined ? 0 : (inbound[other] ?? 0);
			} else {
				links = inbound[id] ?? 0;
				// Contentless with contentless_delete=1: the row goes by rowid, without its old text.
				stmt("DELETE FROM ft WHERE rowid = ?").bind([id]).stepReset();
			}
			insert(id, n.path, n.mtime, links, f);
			d.exec("COMMIT");
			addTerms(f);
			nameIndex = null;
		},
	};
};
