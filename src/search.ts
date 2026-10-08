import { type App, type CachedMetadata, getAllTags, parseFrontMatterAliases, type TFile } from "obsidian";
import { type JetData, frecency } from "./data";
import { cutExcerpt } from "./excerpt/excerpt";
import { filterPhrases, PHRASE_CHECK_LIMIT, quotedPhrases } from "./rank";
import { iconOf } from "./host";
import type { Feeder } from "./index/feeder";
import { age, crumb, titleOf } from "./modal/format";
import type { Entry } from "./modal/jet-modal";
import { type MetaField, type MetaHit, MetaIndex, type MetaNote } from "./tier0/meta";
import { type NameHit, NameIndex } from "./tier0/names";
import type { JetClient } from "./worker/jet-client";
import type { QueryReply } from "./worker/protocol";

type Item = Extract<Entry, { type: "item" }>;

/** Scope members for a scoped search (the ScopeKeeper). */
export type ScopeMembers = { ensure(): void; membersOf(id: string): ReadonlySet<string> };
type Shown = NonNullable<Item["excerpt"]> & { offset: number };

/** Titles shown above the text hits for a name-like query. */
const MAX_TITLES = 8;
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
	/** Headings, tags and properties, only while the content index is not ready. */
	private meta: MetaIndex | null = null;
	private readonly idOf = new Map<string, number>();
	private readonly pathOf = new Map<number, string>();
	private nextId = 1;
	/** The open modal's current text and painter, to re-run when the index changes. */
	private current: { text: string; paint: (entries: Entry[], status?: string) => void; scope?: string } | null = null;

	constructor(
		private readonly app: App,
		private readonly client: JetClient,
		private readonly feeder: Feeder,
		private readonly data: () => JetData,
		private readonly scopes?: ScopeMembers,
	) {}

	/**
	 * Results for `text`, inside the scope `scope` when given: its members filter Tier 0 and the
	 * worker, which holds the same set (sent before this query: messages arrive in order).
	 */
	list(text: string, paint: (entries: Entry[], status?: string) => void, scope?: string): void {
		this.current = { text, paint, scope };
		let inScope: ReadonlySet<string> | null = null;
		if (scope !== undefined && this.scopes) {
			this.scopes.ensure();
			inScope = this.scopes.membersOf(scope);
		}
		const names = this.nameIndex();
		const allowed = inScope;
		const tier0 = names.match(text, {
			limit: 40,
			allow: allowed ? (id) => allowed.has(this.pathOf.get(id) ?? "") : undefined,
		});
		const meta = this.metaHits(text, allowed);
		const now = Date.now();
		paint(this.compose(tier0, null, now, new Map(), meta), this.status());
		void (async () => {
			try {
				await this.feeder.ensure();
			} catch (e) {
				console.error("Jet Search: the index could not be opened", e);
				paint(this.compose(tier0, null, now, new Map(), meta), "Full text unavailable (see console)");
				return;
			}
			// Quoted phrases: more candidates from the worker, kept if their text has the phrase.
			const phrases = quotedPhrases(text);
			let reply = await this.client.query(text, { limit: phrases.length ? PHRASE_CHECK_LIMIT : 50, scope });
			if (!reply) return;
			if (phrases.length) {
				const hits = await filterPhrases(reply.hits, phrases, (p) => this.read(p));
				if (this.current?.text !== text) return;
				reply = { ...reply, hits };
			}
			const first = this.compose(tier0, reply, now, new Map(), meta);
			if (!first.length) {
				paint(await this.recovery(text), this.status());
				return;
			}
			paint(first, this.status());
			// Excerpts for the rows people see, cut from Obsidian's cached text, unless turned off.
			if (!this.data().settings.excerpts) return;
			const excerpts = await this.excerpts(first, reply.terms, typedWords(text));
			if (excerpts.size) paint(this.compose(tier0, reply, now, excerpts, meta), this.status());
		})().catch((e: unknown) => console.error("Jet Search: search failed", e));
	}

	/**
	 * The modal opened (on its recents): build Tier 0 just after that paint, so the first letter only
	 * matches. Building in the keystroke cost the first letter of a session ~30 ms during a first build.
	 */
	warm(): void {
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
		if (c?.text.trim()) this.list(c.text, c.paint, c.scope);
	}

	private status(): string {
		const p = this.feeder.progress;
		return p ? `Indexing ${p.done} of ${p.total}…` : "";
	}

	private compose(
		tier0: NameHit[],
		reply: QueryReply | null,
		now: number,
		excerpts: Map<string, Shown>,
		meta: readonly MetaHit[] = [],
	): Entry[] {
		const titles: Item[] = [];
		const shown = new Set<string>();
		for (const h of tier0) {
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
				this.item(file, now, { excerpt: ex ?? null, hit: { terms: reply?.terms ?? [], offset: ex?.offset } }),
			);
			shown.add(h.path);
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
		return {
			type: "item",
			path: file.path,
			title: titleOf(file.path),
			titleRanges: [],
			crumb: crumb(file.path),
			meta: age(file.stat.mtime, now),
			icon: iconOf(this.app, file),
			...extra,
		};
	}

	/** Nothing matched: the spelling the vault uses, and creating the note. */
	private async recovery(text: string): Promise<Entry[]> {
		const s = await this.client.call({ op: "suggest", text });
		const n = (k: number): string => `${k} note${k === 1 ? "" : "s"}`;
		const out: Entry[] = [
			{
				type: "notice",
				title: `No results for “${text.trim()}”`,
				detail: s.text ? `Did you mean “${s.text}”? It is written that way in ${n(s.notes)}.` : undefined,
			},
		];
		if (s.text) out.push({ type: "search", query: s.text, detail: n(s.notes) });
		out.push({ type: "create", text: text.trim(), detail: "A new note with this name" });
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
				});
				if (ex) out.set(r.path, { text: ex.text, marks: ex.marks, more: ex.more, offset: ex.offset });
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

	private nameIndex(): NameIndex {
		if (this.names) return this.names;
		const items = this.app.vault.getMarkdownFiles().map((f) => this.nameItem(f));
		this.names = new NameIndex(items);
		return this.names;
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
		if (!this.names || file.extension !== "md") return;
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
