import { type App, type CachedMetadata, getAllTags, parseFrontMatterAliases, Platform, type TFile } from "obsidian";
import { type JetData, frecency } from "./data";
import { cutExcerpt } from "./excerpt/excerpt";
import { boostSequences, filterPhrases, PHRASE_CHECK_LIMIT, quotedPhrases } from "./rank";
import { iconOf } from "./host";
import { Cancelled, type Feeder } from "./index/feeder";
import { yieldTask } from "./index/slice";
import { age, crumb, titleOf } from "./modal/format";
import { type Filter, filterLabel } from "./filters/filter";
import type { Entry, Sort } from "./modal/jet-modal";
import { type MetaField, type MetaHit, MetaIndex, type MetaNote } from "./tier0/meta";
import { type NameHit, NameIndex } from "./tier0/names";
import { foldWord } from "./tier0/fold";

/**
 * The text as names are matched against it: `-word` taken out (and names holding it
 * left out), quotes dropped, `#tag` and `key:value` as their value, as the engine reads a query.
 */
export const namesQuery = (text: string): { text: string; excluded: Set<string> } => {
	const kept: string[] = [];
	const excluded = new Set<string>();
	for (const m of text.matchAll(/"([^"]*)"?|[^\s"]+/gu)) {
		if (m[1] !== undefined) {
			kept.push(m[1]);
			continue;
		}
		const piece = m[0];
		if (piece.startsWith("-") && piece.length > 1) {
			for (const w of piece
				.slice(1)
				.replace(/^[\p{L}\p{N}_-]+:(?=.)/u, "")
				.split(/[^\p{L}\p{N}]+/u))
				if (w) excluded.add(foldWord(w));
			continue;
		}
		kept.push(piece.replace(/^#/, "").replace(/^[\p{L}\p{N}_-]+:(?=.)/u, ""));
	}
	return { text: kept.join(" ") + (/\s$/u.test(text) ? " " : ""), excluded };
};
import type { AnswerCandidate } from "./answers/answers";
import { answerExcerpt } from "./answers/show";
import { contentWords, isQuestion } from "./meaning/question";
import { joinNames, unionOf, type Where, whereIds, wireWhere } from "./scopes/where";
import type { JetClient } from "./worker/jet-client";
import type { QueryReply } from "./worker/protocol";

type Item = Extract<Entry, { type: "item" }>;

/** Scope members for a scoped search (the ScopeKeeper). */
export type ScopeMembers = {
	ensure(): void;
	membersOf(id: string): ReadonlySet<string>;
	/** Its name, and where a note created in it goes (the no-results screen). */
	describe?(id: string): { name: string; create: string; query?: string } | null;
	/** Why the note is in the scope when not by its folder ("via project"), else null. */
	via?(id: string, path: string): string | null;
};

/** The notes a filter keeps (FilterSets). */
export type FilterNotes = {
	notes(f: Filter): ReadonlySet<string>;
	/** What the note has that the filter asked for ("type = status-report", "edited Oct 2"). */
	reason?(f: Filter, path: string): string | null;
};

/**
 * Obsidian Search's own operators: `line:`, `section:`, `block:`, `task:` (and its
 * forms) and a /regex/. Jet does not answer them; it offers core Search with the same query.
 */
const CORE_ONLY =
	/(^|\s)-?(?:line|section|block|task|task-todo|task-done|match-case|ignore-case):|(^|\s)\/[^/\s][^/]*\//u;

/** Whether the text uses an operator only Obsidian's Search understands. */
export const wantsCoreSearch = (text: string): boolean => CORE_ONLY.test(text);

/** Notes listed for filters with no text, most recently changed first. */
const FILTERED_LIST = 50;
type Shown = NonNullable<Item["excerpt"]> & { offset: number; reason?: string };

/** A note's first line of prose (no headings, properties or empty lines), for a meaning row with none of the words. */
const firstLine = (body: string): string | null => {
	for (const raw of body.replace(/^---\n[\s\S]*?\n---\n?/, "").split("\n")) {
		const l = raw.trim();
		if (!l || /^(#|---|```|>\s*\[!|!\[|\|)/.test(l)) continue;
		return l.length > 160 ? `${l.slice(0, 157)}…` : l;
	}
	return null;
};

/** Titles shown above the text hits for a name-like query. */
/** Tier 0 on a phone is built in slices of at most this many ms, in chunks of this many notes. */
const NAMES_SLICE_MS = 4;
const NAMES_CHUNK = 50;
const MAX_TITLES = 8;
/** Answers (experiment): notes taken from each list, by words and by meaning, for the re-rank. */
const ANSWER_POOL = 50;
/** Answers (experiment): how long the text rests before its answers are looked for. */
const ANSWER_PAUSE_MS = 250;
/** Excerpts are cut for this many content rows (the visible ones and a little more). */
const EXCERPT_ROWS = 24;
/** Notes found by a heading, tag or property while the index builds. */
const MAX_META = 20;
/** Frontmatter keys Tier 0 already covers (aliases, tags) or that say nothing (position, styling). */
const SKIP_PROPERTIES = new Set(["aliases", "alias", "tags", "tag", "cssclasses", "cssclass", "position"]);

/**
 * Answers the modal's text: Tier 0 names in the same frame, then the worker's
 * ranked full text, merged so the selection stays put: titles first for a
 * name-like query, then hits in the text with an excerpt; one ranked list otherwise.
 */
export class Search {
	private names: NameIndex | null = null;
	/** Tier 0 is being built in slices (a phone): changes meanwhile are applied when it is done. */
	private namesBuilding = false;
	private readonly namesTouched = new Map<string, TFile>();
	private readonly namesGone = new Set<string>();
	/** Headings, tags and properties, only while the content index is not ready. */
	private meta: MetaIndex | null = null;
	private readonly idOf = new Map<string, number>();
	/** The scope and filters of the list being composed (for the rows' reasons). */
	private why: { scope?: Where; filters: readonly Filter[] } = { filters: [] };
	private readonly pathOf = new Map<number, string>();
	private nextId = 1;
	/** The open modal's current text and painter, to re-run when the index changes. */
	private current: {
		text: string;
		paint: (entries: Entry[], status?: string) => void;
		scope?: Where;
		filters?: readonly Filter[];
		meaning?: { on: boolean; offered: boolean; both?: boolean };
		/** The order chosen: a live refresh keeps it. */
		order?: Sort;
	} | null = null;

	constructor(
		private readonly app: App,
		private readonly client: JetClient,
		private readonly feeder: Feeder,
		private readonly data: () => JetData,
		private readonly scopes?: ScopeMembers,
		private readonly filterNotes?: FilterNotes,
	) {}

	/**
	 * Results for `text`, inside the scope `scope` when given, or any of several:
	 * its members filter Tier 0 and the worker, which holds the same sets (sent before this query:
	 * messages arrive in order).
	 */
	list(
		text: string,
		paint: (entries: Entry[], status?: string) => void,
		scope?: Where,
		filters: readonly Filter[] = [],
		meaning?: { on: boolean; offered: boolean; both?: boolean },
		order: Sort = "best",
	): void {
		this.current = { text, paint, scope, filters, meaning, order };
		this.why = { scope, filters };
		let inScope: ReadonlySet<string> | null = null;
		const ids = whereIds(scope);
		const sc = this.scopes;
		if (ids.length && sc) {
			sc.ensure();
			inScope = unionOf(ids, (id) => sc.membersOf(id));
		}
		// Filters: their notes, intersected with the scope's; "Title only" searches names alone.
		const sets = filters.filter((f) => f.kind !== "title");
		const titleOnly = filters.some((f) => f.kind === "title");
		let narrowed: Set<string> | null = null;
		if (sets.length && this.filterNotes) {
			const fn = this.filterNotes;
			const [first, ...rest] = sets.map((f) => fn.notes(f));
			narrowed = new Set(
				[...(first ?? [])].filter((p) => (!inScope || inScope.has(p)) && rest.every((r) => r.has(p))),
			);
		}
		const names = this.nameIndex();
		const allowed: ReadonlySet<string> | null = narrowed ?? inScope;
		if (!text.trim()) {
			// Title only with nothing typed yet: the notes it would search in, not "no notes match".
			const every = titleOnly && !sets.length && !inScope;
			paint(
				this.listed(
					every
						? new Set(this.app.vault.getMarkdownFiles().map((f) => f.path))
						: (allowed ?? new Set<string>()),
					order,
				),
				this.status(),
			);
			return;
		}
		const nq = namesQuery(text);
		const named = (id: number): boolean => {
			const path = this.pathOf.get(id) ?? "";
			if (allowed && !allowed.has(path)) return false;
			if (!nq.excluded.size) return true;
			return !titleOf(path)
				.split(/[^\p{L}\p{N}]+/u)
				.some((w) => w && nq.excluded.has(foldWord(w)));
		};
		// Still being built in slices (a large vault on a phone): the worker's list comes alone, and the
		// names join it when they are ready.
		const tier0 =
			names?.match(nq.text, {
				limit: 40,
				allow: allowed || nq.excluded.size ? named : undefined,
			}) ?? [];
		// Title only means names alone: headings and properties are left out too.
		const meta = titleOnly ? [] : this.metaHits(nq.text, allowed);
		const now = Date.now();
		// Answers (experiment): a question searched by meaning, or both ways, is re-ranked by the line
		// that answers it once the first lists are shown; from then on they paint no more.
		if (meaning?.on && !titleOnly && this.data().settings.answers && isQuestion(text)) {
			const show = paint;
			let answered = false;
			paint = (e, st) => {
				if (!answered) show(e, st);
			};
			this.answers(text, show, () => (answered = true), scope, narrowed, now);
		}
		// By words and by meaning at once: both lists painted together, each
		// as it arrives; meaning's rows carry `meaning: true`, and the modal groups them as you chose.
		let out = paint;
		if (meaning?.both && !titleOnly) {
			let w: Entry[] = [];
			let m: Entry[] = [];
			let ws = "";
			let ms = "";
			const draw = (): void => paint([...w, ...m], ws || ms);
			this.byMeaning(
				text,
				(e, st) => {
					m = e.filter((x) => x.type === "item");
					ms = st ?? "";
					draw();
				},
				scope,
				narrowed,
				now,
			);
			out = (e, st) => {
				w = e;
				ws = st ?? "";
				draw();
			};
		} else if (meaning?.on && !titleOnly) {
			// Search by meaning alone: its own list.
			this.byMeaning(text, paint, scope, narrowed, now);
			return;
		}
		const words = this.compose(tier0, null, now, new Map(), meta);
		// Nothing yet from the names: the full text is on its way, said so.
		out(
			meaning?.offered ? this.offerMeaning(words) : words,
			this.status() || (words.length || titleOnly ? "" : "Searching…"),
		);
		if (titleOnly) return;
		void (async () => {
			try {
				await this.feeder.ensure();
			} catch (e) {
				// Cleared or rebuilt meanwhile: names stay; the next key searches the new index.
				if (e instanceof Cancelled) return;
				console.error("Jet Search: the index could not be opened", e);
				out(this.compose(tier0, null, now, new Map(), meta), "Full text unavailable (see console)");
				return;
			}
			// Quoted phrases: more candidates from the worker, kept if their text has the phrase.
			const phrases = quotedPhrases(text);
			let reply = await this.client.query(text, {
				limit: phrases.length ? PHRASE_CHECK_LIMIT : 50,
				scope: narrowed ? undefined : wireWhere(scope),
				allow: narrowed ? [...narrowed] : undefined,
			});
			if (!reply) return;
			if (reply.broken) void this.feeder.recover();
			if (phrases.length) {
				const hits = await filterPhrases(reply.hits, phrases, (p) => this.read(p));
				if (this.current?.text !== text) return;
				reply = { ...reply, hits };
			} else {
				// Several words typed without quotes: notes that have them in that order go first.
				const hits = await boostSequences(reply.hits, text, (p) => this.read(p));
				if (this.current?.text !== text) return;
				reply = { ...reply, hits };
			}
			const offer = (e: Entry[]): Entry[] => (meaning?.offered ? this.offerMeaning(e) : e);
			const first = this.compose(tier0, reply, now, new Map(), meta);
			if (!first.length) {
				out(offer(await this.recovery(text, scope)), this.status());
				return;
			}
			out(offer(first), this.status());
			// Excerpts for the rows people see, cut from Obsidian's cached text, unless turned off.
			if (!this.data().settings.excerpts) return;
			const typed = typedWords(text);
			const excerpts = await this.excerpts(
				first,
				reply.terms,
				typed,
				/\s$/u.test(text) ? undefined : typed.at(-1),
			);
			if (excerpts.size) out(offer(this.compose(tier0, reply, now, excerpts, meta)), this.status());
		})().catch((e: unknown) => console.error("Jet Search: search failed", e));
	}

	/**
	 * The modal opened (on its recents): build Tier 0 just after that paint, so the first letter only
	 * matches. Building in the keystroke cost the first letter of a session ~30 ms during a first build.
	 */
	warm(): void {
		// The saved index opens in the worker meanwhile, so it is ready by the time the names are. A failure
		// is left to the first search, which tries again and says so.
		this.feeder.ensure().catch(() => {});
		window.setTimeout(() => {
			this.nameIndex();
			if (this.indexNotReady()) this.metaIndex();
		}, 0);
	}

	/** The modal closed: nothing to keep live. */
	idle(): void {
		this.current = null;
	}

	/** Notes changed while the modal is open: run its text again (the selection stays). */
	refresh(): void {
		const c = this.current;
		if (c?.text.trim() || c?.filters?.length) this.list(c.text, c.paint, c.scope, c.filters, c.meaning, c.order);
	}

	/** A question searched by words: the first header offers By meaning (⌘J). */
	private offerMeaning(entries: Entry[]): Entry[] {
		const i = entries.findIndex((e) => e.type === "header" && !e.plain);
		const h = entries[i];
		return h?.type === "header" ? entries.map((e, j) => (j === i ? { ...h, mode: "words" as const } : e)) : entries;
	}

	/**
	 * By meaning: the notes nearest the question, each with a "by meaning" badge, and
	 * as its excerpt the line with most of the question's words, else the note's first line.
	 */
	private byMeaning(
		text: string,
		paint: (entries: Entry[], status?: string) => void,
		scope: Where | undefined,
		narrowed: Set<string> | null,
		now: number,
	): void {
		const head = (n: number): Entry => ({ type: "header", label: "By meaning", count: n, mode: "meaning" });
		paint([head(0)], this.status() || "Searching by meaning…");
		void (async () => {
			try {
				await this.feeder.ensure();
			} catch (e) {
				if (!(e instanceof Cancelled)) console.error("Jet Search: the index could not be opened", e);
				return;
			}
			// The first question of the session loads the model; vectors follow in the background.
			await this.feeder.ensureMeaning?.();
			if (this.current?.text !== text) return;
			const r = await this.client.nearest(text, {
				k: 50,
				scope: narrowed ? undefined : wireWhere(scope),
				allow: narrowed ? [...narrowed] : undefined,
			});
			if (!r || this.current?.text !== text) return;
			const rows = (excerpts: Map<string, Shown>): Entry[] => {
				const items: Item[] = [];
				for (const n of r.near) {
					const file = this.app.vault.getFileByPath(n.path);
					if (!file) continue;
					const ex = excerpts.get(n.path);
					items.push(
						this.item(file, now, {
							badge: "by meaning",
							meaning: true,
							excerpt: ex ? { text: ex.text, marks: ex.marks, more: 0 } : null,
							// Its excerpt's line and the question's words, for the preview.
							hit: { terms: contentWords(text), offset: ex?.offset },
						}),
					);
				}
				return items.length
					? [head(items.length), ...items]
					: [{ type: "notice", title: `Nothing near “${text.trim()}” yet` }, ...this.wordsInstead()];
			};
			const first = rows(new Map());
			paint(first, this.status());
			if (!this.data().settings.excerpts) return;
			const words = contentWords(text);
			const ex = new Map<string, Shown>();
			await Promise.all(
				first
					.filter((e): e is Item => e.type === "item")
					.slice(0, EXCERPT_ROWS)
					.map(async (it) => {
						const file = this.app.vault.getFileByPath(it.path);
						if (!file) return;
						const body = withoutTitleLine(await this.app.vault.cachedRead(file), it.title);
						const cut = words.length ? cutExcerpt(body, words, { exact: words }) : null;
						if (cut) ex.set(it.path, { text: cut.text, marks: cut.marks, more: 0, offset: cut.offset });
						else {
							const line = firstLine(body);
							if (line) ex.set(it.path, { text: line, marks: [], more: 0, offset: 0 });
						}
					}),
			);
			if (this.current?.text === text) paint(rows(ex), this.status());
		})().catch((e: unknown) => console.error("Jet Search: search by meaning failed", e));
	}

	/**
	 * Answers (experiment): the notes the question's content words and its meaning find, read
	 * from Obsidian's cache and re-ranked in the worker by the line that best answers it. Each row shows
	 * that line, its figures coloured, with a meter of how much of the question it holds.
	 */
	private answers(
		text: string,
		paint: (entries: Entry[], status?: string) => void,
		done: () => void,
		scope: Where | undefined,
		narrowed: Set<string> | null,
		now: number,
	): void {
		void (async () => {
			// Once typing pauses: a question typed on is not re-ranked at every key.
			await new Promise((r) => window.setTimeout(r, ANSWER_PAUSE_MS));
			if (this.current?.text !== text) return;
			try {
				await this.feeder.ensure();
			} catch {
				return;
			}
			await this.feeder.ensureMeaning?.();
			if (this.current?.text !== text) return;
			const pool = await this.client.answerPool(text, {
				k: ANSWER_POOL,
				scope: narrowed ? undefined : wireWhere(scope),
				allow: narrowed ? [...narrowed] : undefined,
			});
			if (this.current?.text !== text) return;
			const byWords = new Set(pool.words);
			const byMeaning = new Set(pool.meaning);
			const notes = await Promise.all(
				[...new Set([...pool.words, ...pool.meaning])].map(async (path): Promise<AnswerCandidate | null> => {
					const file = this.app.vault.getFileByPath(path);
					if (!file) return null;
					const body = await this.app.vault.cachedRead(file);
					const fm = this.app.metadataCache.getFileCache(file)?.frontmatterPosition;
					const both = byWords.has(path) && byMeaning.has(path);
					return {
						path,
						title: titleOf(path),
						text: body,
						bodyStart: fm ? Math.min(body.length, fm.end.offset) : 0,
						from: both ? "both" : byWords.has(path) ? "words" : "meaning",
					};
				}),
			);
			if (this.current?.text !== text) return;
			const r = await this.client.answers(
				text,
				notes.filter((n): n is AnswerCandidate => !!n),
				pool.meaning,
			);
			if (!r || this.current?.text !== text || !r.order.length) return;
			const by = new Map(r.ranked.map((x) => [x.path, x]));
			// The meter: each line's score against the best one's.
			const best = Math.max(...r.ranked.map((x) => x.score), 1e-9);
			const excerpts = this.data().settings.excerpts;
			const items: Item[] = [];
			for (const path of r.order) {
				const a = by.get(path);
				const file = this.app.vault.getFileByPath(path);
				if (!a || !file) continue;
				const shown = a.line && excerpts ? answerExcerpt(a.line.text, text) : null;
				items.push(
					this.item(file, now, {
						badge: a.from === "both" ? "both" : a.from === "words" ? "by words" : "by meaning",
						meaning: a.from === "meaning",
						excerpt: shown ? { text: shown.text, marks: shown.marks, more: 0 } : null,
						hit: { terms: contentWords(text), offset: a.line?.offset },
						answer: { strength: a.score / best, nums: shown?.nums ?? [], line: a.line?.text ?? "" },
					}),
				);
			}
			done();
			paint([{ type: "header", label: "Answers", count: items.length, answers: true }, ...items], this.status());
		})().catch((e: unknown) => console.error("Jet Search: finding answers failed", e));
	}

	/** Nothing by meaning: the same words searched as words is one key away. */
	private wordsInstead(): Entry[] {
		return [{ type: "header", label: "Try instead", plain: true, mode: "meaning" }];
	}

	/**
	 * Filters with no text: the notes they keep, most recently changed first, or in the order chosen,
	 * sorted before the first 50 are taken so "oldest first" shows the oldest.
	 */
	private listed(allowed: ReadonlySet<string>, order: Sort = "best"): Entry[] {
		const now = Date.now();
		const by: Record<Sort, (a: TFile, b: TFile) => number> = {
			best: (a, b) => b.stat.mtime - a.stat.mtime,
			"edited-new": (a, b) => b.stat.mtime - a.stat.mtime,
			"edited-old": (a, b) => a.stat.mtime - b.stat.mtime,
			"created-new": (a, b) => b.stat.ctime - a.stat.ctime,
			"created-old": (a, b) => a.stat.ctime - b.stat.ctime,
			title: (a, b) =>
				titleOf(a.path).localeCompare(titleOf(b.path), undefined, { numeric: true, sensitivity: "base" }),
		};
		const files = [...allowed]
			.map((p) => this.app.vault.getFileByPath(p))
			.filter((f): f is TFile => !!f)
			.sort(by[order]);
		if (!files.length) return [{ type: "notice", title: "No notes match these filters" }];
		return [
			{ type: "header", label: "Results", count: files.length },
			...files.slice(0, FILTERED_LIST).map((f) => this.item(f, now, {})),
		];
	}

	private status(): string {
		const p = this.feeder.progress;
		if (p) return `Indexing ${p.done} of ${p.total}…`;
		const m = this.feeder.meaningProgress;
		return m ? `Giving notes their meaning: ${m.done} of ${m.total}…` : "";
	}

	private compose(
		tier0: NameHit[],
		reply: QueryReply | null,
		now: number,
		excerpts: Map<string, Shown>,
		meta: readonly MetaHit[] = [],
	): Entry[] {
		const core: Entry[] = this.current && wantsCoreSearch(this.current.text) ? [this.coreRow(this.current)] : [];
		return [...core, ...this.composeHits(tier0, reply, now, excerpts, meta)];
	}

	/**
	 * "Search with Obsidian Search": the text with the chips written in Obsidian's own syntax, so the
	 * hand-off searches what you asked, not the whole vault. Chips it has no syntax for are named.
	 */
	private coreRow(c: { text: string; scope?: Where; filters?: readonly Filter[] }): Entry {
		const q = (v: string): string => (/[\s"]/u.test(v) ? `"${v.replace(/"/g, "")}"` : v);
		const parts: string[] = [];
		const left: string[] = [];
		// Several scopes: any of them, ORed. One Obsidian has no syntax for would make the ORed rest
		// narrower than the search, so then no scope is written and they are all named (wider, as for one).
		const ds = whereIds(c.scope).flatMap((id) => {
			const d = this.scopes?.describe?.(id) ?? null;
			return d ? [d] : [];
		});
		if (ds.some((d) => !d.query)) left.push(...ds.map((d) => d.name));
		else if (ds.length === 1) parts.push(ds[0]?.query as string);
		else if (ds.length) parts.push(`(${ds.map((d) => `(${d.query})`).join(" OR ")})`);
		for (const f of c.filters ?? [])
			if (f.kind === "tag") parts.push(`tag:${f.tag}`);
			else if (f.kind === "path") parts.push(`path:${q(f.prefix)}`);
			else if (f.kind === "prop") parts.push(`[${f.key}:${q(f.value)}]`);
			else if (f.kind !== "title") left.push(filterLabel(f).join(" ").trim());
		const query = [...parts, c.text.trim()].filter(Boolean).join(" ");
		return {
			type: "core",
			query,
			detail: `“${query}” in Obsidian's Search${left.length ? ` (without ${left.join(", ")})` : ""}`,
		};
	}

	private composeHits(
		tier0: NameHit[],
		reply: QueryReply | null,
		now: number,
		excerpts: Map<string, Shown>,
		meta: readonly MetaHit[] = [],
	): Entry[] {
		const titles: Item[] = [];
		const shown = new Set<string>();
		// A word that is rare here puts the notes that hold it before names and folders that only come close
		// (another form of the word, a near spelling, a folder called that); a name equal to it stays first.
		const later: NameHit[] = [];
		for (const h of tier0) {
			if (reply?.rare && !h.exact) {
				later.push(h);
				continue;
			}
			const path = this.pathOf.get(h.id);
			const file = path ? this.app.vault.getFileByPath(path) : null;
			if (!file || shown.has(file.path)) continue;
			shown.add(file.path);
			titles.push(
				this.item(file, now, {
					titleRanges: h.field === "name" ? h.ranges : [],
					badge: h.field === "alias" ? h.text : h.field === "path" ? "path" : undefined,
					hit: { terms: reply?.terms ?? [] },
				}),
			);
			if (titles.length >= MAX_TITLES) break;
		}
		const data = this.data();
		const hits = (reply?.hits ?? [])
			.map((h) => ({ ...h, score: h.score * frecency(data, h.path, now) }))
			.sort((a, b) => b.matched - a.matched || b.score - a.score);
		const text: Item[] = [];
		for (const h of hits) {
			if (shown.has(h.path)) continue;
			const file = this.app.vault.getFileByPath(h.path);
			if (!file) continue;
			const ex = excerpts.get(h.path);
			text.push(
				this.item(file, now, {
					excerpt: ex ? { text: ex.text, marks: ex.marks, more: ex.more } : null,
					hit: { terms: reply?.terms ?? [], offset: ex?.reason ? undefined : ex?.offset },
					...(ex?.reason ? { reasons: [...this.reasons(h.path), ex.reason] } : {}),
				}),
			);
			shown.add(h.path);
		}
		for (const h of later) {
			const path = this.pathOf.get(h.id);
			const file = path ? this.app.vault.getFileByPath(path) : null;
			if (!file || shown.has(file.path)) continue;
			shown.add(file.path);
			text.push(
				this.item(file, now, {
					titleRanges: h.field === "name" ? h.ranges : [],
					badge: h.field === "alias" ? h.text : h.field === "path" ? "path" : undefined,
					hit: { terms: reply?.terms ?? [] },
				}),
			);
		}
		// While the index builds: notes it has not reached yet, found by a heading, tag or property.
		for (const m of meta) {
			if (shown.has(m.path)) continue;
			const file = this.app.vault.getFileByPath(m.path);
			if (!file) continue;
			shown.add(m.path);
			text.push(
				this.item(file, now, { excerpt: { text: m.field.text, marks: m.marks, more: 0 }, hit: { terms: [] } }),
			);
		}
		if (!titles.length)
			return text.length ? [{ type: "header", label: "Results", count: text.length }, ...text] : [];
		const out: Entry[] = [{ type: "header", label: "Titles", count: titles.length }, ...titles];
		if (text.length) out.push({ type: "header", label: "In text", count: text.length }, ...text);
		return out;
	}

	private item(file: TFile, now: number, extra: Partial<Item>): Item {
		const reasons = this.reasons(file.path);
		return {
			type: "item",
			path: file.path,
			title: titleOf(file.path),
			titleRanges: [],
			crumb: crumb(file.path),
			meta: age(file.stat.mtime, now),
			icon: iconOf(this.app, file),
			mtime: file.stat.mtime,
			ctime: file.stat.ctime,
			...(reasons.length ? { reasons } : {}),
			...extra,
		};
	}

	/** Why a row matched beyond its text: the filters' values, and the scope rule when not its folder. */
	private reasons(path: string): string[] {
		const out: string[] = [];
		const { scope, filters } = this.why;
		for (const f of filters) {
			const r = f.kind === "title" ? null : (this.filterNotes?.reason?.(f, path) ?? null);
			if (r) out.push(r);
		}
		// Several scopes: the reason of the first one holding the note.
		const sc = this.scopes;
		const id = sc ? whereIds(scope).find((x) => sc.membersOf(x).has(path)) : undefined;
		const via = id !== undefined ? (sc?.via?.(id, path) ?? null) : null;
		if (via) out.push(via);
		return out;
	}

	/**
	 * Nothing matched: the spelling the vault uses, and creating the note. Inside a
	 * scope: also searching everywhere, with its count, and creating
	 * the note in the scope.
	 */
	private async recovery(text: string, scope?: Where): Promise<Entry[]> {
		const s = await this.client.call({ op: "suggest", text });
		// Typed on meanwhile: this text's recovery is not shown, so it asks nothing more.
		if (this.current?.text !== text) return [];
		const n = (k: number): string => `${k} note${k === 1 ? "" : "s"}`;
		const t = text.trim();
		// Several scopes: named together; a note is created in the first one.
		const ds = whereIds(scope).flatMap((id) => {
			const x = this.scopes?.describe?.(id) ?? null;
			return x ? [x] : [];
		});
		const d = ds[0] ? { name: joinNames(ds.map((x) => x.name)), create: ds[0].create, first: ds[0].name } : null;
		// The notice, then "Try instead" and the suggestions as cards.
		const out: Entry[] = [
			{ type: "notice", title: d ? `No results for “${t}” in ${d.name}` : `No results for “${t}”` },
			{ type: "header", label: "Try instead", plain: true },
		];
		if (d) {
			const all = await this.client.count(text, { limit: 50 });
			const k = all?.hits.length ?? 0;
			out.push({
				type: "widen",
				label: `Search everywhere for “${t}”`,
				detail: all
					? k
						? `${k >= 50 ? "50+" : k} ${k === 1 ? "note" : "notes"} outside ${d.name}`
						: "Nothing there either"
					: undefined,
			});
		}
		if (s.text)
			out.push({ type: "search", query: s.text, detail: `Written that way in ${n(s.notes)}`, spelling: true });
		out.push(
			d
				? { type: "create", text: t, detail: `In ${d.first} · ${d.create}` }
				: { type: "create", text: t, detail: "A new note with this name" },
		);
		return out;
	}

	private async read(path: string): Promise<string | null> {
		const f = this.app.vault.getFileByPath(path);
		if (!f) return null;
		// The note's name counts as part of its text for phrases (a phrase that is the title).
		return `${f.basename}\n${await this.app.vault.cachedRead(f)}`;
	}

	private async excerpts(
		entries: Entry[],
		terms: readonly string[],
		exact: readonly string[],
		typing?: string,
	): Promise<Map<string, Shown>> {
		const out = new Map<string, Shown>();
		if (!terms.length) return out;
		const rows = entries
			.filter((e): e is Item => e.type === "item" && e.excerpt !== undefined)
			.slice(0, EXCERPT_ROWS);
		await Promise.all(
			rows.map(async (r) => {
				const file = this.app.vault.getFileByPath(r.path);
				if (!file) return;
				const ex = cutExcerpt(withoutTitleLine(await this.app.vault.cachedRead(file), r.title), terms, {
					exact,
					typing,
				});
				if (ex) {
					out.set(r.path, { text: ex.text, marks: ex.marks, more: ex.more, offset: ex.offset });
					return;
				}
				// Not in the body: a property holds it (the "summary" badge).
				for (const f of properties(this.app.metadataCache.getFileCache(file) ?? {})) {
					const value = f.text.slice(f.text.indexOf(": ") + 2);
					const px = cutExcerpt(value, terms, { exact, typing });
					if (!px) continue;
					out.set(r.path, {
						text: px.text,
						marks: px.marks,
						more: 0,
						offset: 0,
						reason: f.text.slice(0, f.text.indexOf(": ")),
					});
					return;
				}
			}),
		);
		return out;
	}

	// ── Tier 0 before the index ─────────────────────────────

	/** Whether the content index cannot answer for every note yet: never built, or building now. */
	private indexNotReady(): boolean {
		return this.feeder.progress !== null || this.data().indexedAt === null;
	}

	/** Headings, tags and properties matching `text` while the index is not ready; nothing after. */
	private metaHits(text: string, allowed: ReadonlySet<string> | null = null): MetaHit[] {
		if (!this.indexNotReady()) {
			this.meta = null;
			return [];
		}
		if (!text.trim()) return [];
		return this.metaIndex().match(text, { limit: MAX_META, allow: allowed ? (p) => allowed.has(p) : undefined });
	}

	private metaIndex(): MetaIndex {
		this.meta ??= new MetaIndex(this.app.vault.getMarkdownFiles().map((f) => this.metaNote(f)));
		return this.meta;
	}

	private metaNote(file: TFile): MetaNote {
		const cache = this.app.metadataCache.getFileCache(file);
		const fields: MetaField[] = [];
		if (cache) {
			for (const h of cache.headings ?? []) fields.push({ kind: "heading", text: h.heading });
			for (const t of new Set(getAllTags(cache) ?? [])) fields.push({ kind: "tag", text: t });
			fields.push(...properties(cache));
		}
		return { path: file.path, fields };
	}

	// ── Tier 0 names: built on first open, kept by events ────────────────

	private nameIndex(): NameIndex | null {
		if (this.names) return this.names;
		if (this.namesBuilding) return null;
		const files = this.app.vault.getMarkdownFiles();
		if (!Platform.isMobile) {
			this.names = new NameIndex(files.map((f) => this.nameItem(f)));
			return this.names;
		}
		// A phone is several times slower and the names are built on its main thread: in slices of at most
		// 4 ms, with the app drawing and answering between them. A small vault is done in the first slice.
		const index = new NameIndex();
		let at = 0;
		const slice = (): boolean => {
			const t0 = performance.now();
			while (at < files.length) {
				index.fill(files.slice(at, at + NAMES_CHUNK).map((f) => this.nameItem(f)));
				at += NAMES_CHUNK;
				if (performance.now() - t0 >= NAMES_SLICE_MS) break;
			}
			return at >= files.length;
		};
		const finish = (): void => {
			index.settle();
			// Notes that came, moved or went while the slices ran.
			for (const path of this.namesGone) {
				const id = this.idOf.get(path);
				if (id === undefined) continue;
				index.remove(id);
				this.idOf.delete(path);
				this.pathOf.delete(id);
			}
			for (const f of this.namesTouched.values()) index.upsert(this.nameItem(f));
			this.namesGone.clear();
			this.namesTouched.clear();
			this.names = index;
			this.namesBuilding = false;
		};
		this.namesBuilding = true;
		if (slice()) {
			finish();
			return index;
		}
		void (async () => {
			do await yieldTask();
			while (!slice());
			finish();
			this.refresh();
		})().catch((e: unknown) => {
			this.namesBuilding = false;
			this.namesGone.clear();
			this.namesTouched.clear();
			console.warn("Jet Search: the names could not be listed", e);
		});
		return null;
	}

	private nameItem(file: TFile): { id: number; name: string; aliases: string[]; path: string } {
		let id = this.idOf.get(file.path);
		if (id === undefined) {
			id = this.nextId++;
			this.idOf.set(file.path, id);
			this.pathOf.set(id, file.path);
		}
		const aliases = parseFrontMatterAliases(this.app.metadataCache.getFileCache(file)?.frontmatter) ?? [];
		return { id, name: file.basename, aliases, path: file.path };
	}

	/** A note appeared or its aliases changed: its name is findable in the same frame. */
	nameChanged(file: TFile): void {
		if (file.extension !== "md") return;
		if (!this.names) {
			if (this.namesBuilding) this.namesTouched.set(file.path, file);
			return;
		}
		this.names.upsert(this.nameItem(file));
	}

	nameRenamed(file: TFile, from: string): void {
		const id = this.idOf.get(from);
		if (id !== undefined) {
			this.idOf.delete(from);
			this.idOf.set(file.path, id);
			this.pathOf.set(id, file.path);
		}
		this.nameChanged(file);
	}

	nameDeleted(path: string): void {
		// While the names are built in slices the note may be in the list or not yet: settled at the end.
		if (this.namesBuilding) {
			this.namesGone.add(path);
			this.namesTouched.delete(path);
			return;
		}
		const id = this.idOf.get(path);
		if (id === undefined) return;
		this.idOf.delete(path);
		this.pathOf.delete(id);
		this.names?.remove(id);
	}
}

/** The words as typed (not excluded with a minus), for the excerpt's choice of line. */
const typedWords = (text: string): string[] =>
	text
		.replace(/"/g, " ")
		.split(/\s+/)
		.filter((w) => w && !w.startsWith("-"));

/**
 * The note's first heading blanked when it only repeats the note's name, so the excerpt shows a line
 * that says something (offsets are kept: the line becomes spaces).
 */
export const withoutTitleLine = (text: string, title: string): string => {
	const m = /^#[ \t]+(.+)$/m.exec(text.slice(0, 4096));
	if (!m || m[1]?.trim().toLowerCase() !== title.trim().toLowerCase()) return text;
	return text.slice(0, m.index) + " ".repeat(m[0].length) + text.slice(m.index + m[0].length);
};

/** A note's property values as `key: value` fields (one per list item); objects are skipped. */
const properties = (cache: CachedMetadata): MetaField[] => {
	const out: MetaField[] = [];
	for (const [key, value] of Object.entries(cache.frontmatter ?? {})) {
		if (SKIP_PROPERTIES.has(key.toLowerCase())) continue;
		for (const v of Array.isArray(value) ? value : [value])
			if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
				if (String(v).trim()) out.push({ kind: "property", text: `${key}: ${String(v)}` });
	}
	return out;
};
