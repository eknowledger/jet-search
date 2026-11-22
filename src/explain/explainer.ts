import type { App } from "obsidian";
import type { Filter } from "../filters/filter";
import { excluder } from "../index/gather";
import type { Progress } from "../index/feeder";
import { filterPhrases, quotedPhrases } from "../rank";
import { whereIds, wireWhere, type Where } from "../scopes/where";
import type { JetClient } from "../worker/jet-client";
import type { ExplainReply } from "../worker/protocol";
import {
	type Context,
	type NoteContext,
	noteView,
	realNames,
	searchView,
	tagNames,
	type Namer,
	type View,
	viewLines,
} from "./view";

/** What the window lists. */
const LIMIT = 50;

/** The search as it ran, and the note asked about (none: the search alone). */
export type ExplainRequest = {
	text: string;
	mode: "words" | "meaning";
	scope?: Where;
	filters: readonly Filter[];
	/** The sort's name as the window shows it, and whether it is by relevance. */
	sort: string;
	byRelevance: boolean;
	path: string | null;
	/** The note's name as shown. */
	name: string;
	/** The notes the scope keeps and the notes the filters keep, with the scope's already applied (null: none). */
	inScope: ReadonlySet<string> | null;
	narrowed: ReadonlySet<string> | null;
};

export type Explained = {
	search: View;
	note: View | null;
	/** The explanation as lines of a report; names of words and notes only when `names`. */
	lines(names: boolean): string[];
};

/** What the explainer needs of the plugin. */
export type ExplainDeps = {
	app: App;
	client: JetClient;
	/** The index is open (it opens it if asleep). */
	ensure: () => Promise<void>;
	progress: () => Progress;
	excluded: () => readonly string[];
};

/**
 * Explains a search the window just ran. It asks the worker only now, once; no search calls it. The facts only
 * the main thread knows (the exclude rules, the scope, the filters, a quoted phrase) are added to what the
 * worker found.
 */
export class Explainer {
	constructor(private readonly d: ExplainDeps) {}

	async run(req: ExplainRequest): Promise<Explained> {
		await this.d.ensure();
		const { app, client } = this.d;
		const reply: ExplainReply = await client.explain({
			mode: req.mode,
			text: req.text,
			path: req.path,
			limit: LIMIT,
			allow: req.narrowed ? [...req.narrowed] : undefined,
			scope: req.narrowed ? undefined : wireWhere(req.scope),
		});
		const ctx: Context = {
			text: req.text,
			mode: req.mode,
			scoped: whereIds(req.scope).length > 0,
			filters: req.filters.length,
			titleOnly: req.filters.some((f) => f.kind === "title"),
			sort: req.sort,
			byRelevance: req.byRelevance,
			limit: LIMIT,
			building: this.d.progress(),
		};
		const note: NoteContext | null =
			req.path === null
				? null
				: {
						name: req.name,
						excluded: excluder(app, this.d.excluded())(req.path),
						inScope: req.inScope ? req.inScope.has(req.path) : null,
						passesFilters: req.narrowed ? req.narrowed.has(req.path) : null,
						phrase: await this.phrase(req.mode, req.text, req.path, reply),
					};
		const build = (n: Namer): { search: View; note: View | null } => ({
			search: searchView(ctx, reply, n),
			note: note ? noteView(ctx, reply, note, n) : null,
		});
		const real = build(realNames);
		return {
			...real,
			lines: (names) => {
				const v = build(names ? realNames : tagNames());
				const head = names ? `search "${req.text}"` : "the search";
				return [head, ...viewLines(v.search), ...(v.note ? ["", ...viewLines(v.note)] : [])];
			},
		};
	}

	/** Whether the note holds the search's quoted phrases (null: none were quoted, or it is not listed). */
	private async phrase(mode: string, text: string, path: string, reply: ExplainReply): Promise<boolean | null> {
		const phrases = quotedPhrases(text);
		if (mode !== "words" || !phrases.length || reply.kind !== "words" || reply.note?.rank == null) return null;
		const file = this.d.app.vault.getFileByPath(path);
		if (!file) return null;
		const hit = { path, score: 0, matched: 0, edits: 0 };
		const kept = await filterPhrases(
			[hit],
			phrases,
			async () => `${file.basename}\n${await this.d.app.vault.cachedRead(file)}`,
		);
		return kept.length > 0;
	}
}
