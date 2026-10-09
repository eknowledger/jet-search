import {
	type App,
	type EditorPosition,
	FuzzySuggestModal,
	getAllTags,
	MarkdownView,
	normalizePath,
	Notice,
	TFile,
	TFolder,
} from "obsidian";
import { type JetData, groupRecents, rememberSearch } from "./data";
import { age, crumb, titleOf } from "./modal/format";
import {
	type Completion,
	type Entry,
	type NoteAction,
	type HintState,
	type ModalHost,
	type OpenAt,
	type OpenHow,
	type ScopeCard,
	type ScopeView,
	type Sort,
	type Typed,
	scopeListLabel,
} from "./modal/jet-modal";
import { findFix, pieceAt, wantOf } from "./filters/complete";
import { type Filter, filterLabel, filterText, findFilters, withoutPieces } from "./filters/filter";
import type { FilterSets } from "./filters/sets";
import type { Rule, Scope } from "./scopes/model";
import { clusterStart } from "./excerpt/chars";
import { createTarget } from "./scopes/create";
import { fold } from "./scopes/names";
import { parseScope } from "./scopes/parse";
import { MODE_LABEL } from "./settings/scopes-page";
import type { Search } from "./search";
import type { IndexStatus } from "./index-status";

/** The icon for a note, by its `type` property: email, project, otherwise a page. */
export const iconOf = (app: App, file: TFile): string => {
	const type: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.type;
	if (type === "email") return "mail";
	if (type === "project" || type === "area") return "folder-kanban";
	if (type === "meeting") return "users";
	if (type === "journal") return "calendar-days";
	return "file-text";
};

/** The scopes as the host needs them (the plugin's scopes and its ScopeKeeper). */
export type HostScopes = {
	all(): readonly Scope[];
	/** The members pass, if not done yet (a few ms, once). */
	ensure(): void;
	count(id: string): number;
	membersOf(id: string): ReadonlySet<string>;
	ruleCount(rule: Rule): number;
	/** Open the scope's settings page. */
	edit(id: string): void;
	/** Mentions outside ÷ notes inside, or null before it is measured. */
	ambiguity(id: string): number | null;
	/** Measure it (the worker counts mentions), for next time. */
	measure(id: string): void;
};

/** Items in each of the filters bar's menus. */
const MENU_ITEMS = 30;
/** Rows in the autocomplete list. */
const AC_ITEMS = 12;
/** Rows shown dimmed for a fix. */
const PREVIEW_ROWS = 8;

/** Notes listed for a scope with nothing typed. */
const SCOPE_RECENTS = 50;

/** A scope and its text as a recent search: the explicit form, so choosing it applies the scope again. */
export const scopedSearch = (name: string, text: string): string =>
	`in:${/[\s"]/.test(name) ? `"${name.replace(/"/g, "")}"` : name}${text.trim() ? ` ${text.trim()}` : ""}`;

/** One rule as the chip's card says it. */
const ruleLine = (r: Rule): { icon: string; text: string } => {
	if (r.kind === "folder") return { icon: "folder", text: `${r.path}/ and below` };
	if (r.kind === "tag") return { icon: "hash", text: `${r.tag} and nested tags` };
	if ("target" in r)
		return { icon: "link", text: `${r.key} → [[${(r.target.split("/").pop() ?? "").replace(/\.md$/i, "")}]]` };
	return { icon: "equal", text: `${r.key} = ${r.value}` };
};

/** What the modal shows: recents and recent searches with no text, else the search's answers. */
export class JetHost implements ModalHost {
	readonly placeholder = "Search notes…";

	constructor(
		private readonly app: App,
		private readonly data: () => JetData,
		private readonly save: () => void,
		private readonly newTab: () => boolean,
		private readonly search: () => Search,
		private readonly index?: { status: () => Promise<IndexStatus>; rebuild: () => Promise<void> },
		private readonly scopeAccess?: HostScopes,
		private readonly filterSets?: FilterSets,
	) {}

	/** Filters for the modal. */
	get filters(): ModalHost["filters"] {
		const f = this.filterSets;
		if (!f) return undefined;
		const a = this.scopeAccess;
		return {
			find: (text) => findFilters(text, (k) => f.known(k)).map((x) => ({ ...x, filter: f.resolve(x.filter) })),
			values: (key, scope, filters) => this.values(key, scope, filters),
			tags: (scope, filters) => this.tagCounts(scope, filters),
			keys: () =>
				[...f.propertyKeys().values()]
					.sort((x, y) => y.notes - x.notes)
					.slice(0, MENU_ITEMS)
					.map((k) => [k.name, k.notes]),
			scopes: () =>
				(a?.all() ?? [])
					.map((s) => ({ id: s.id, name: s.name, kind: s.kind, members: a?.count(s.id) ?? 0 }))
					.sort((x, y) => y.members - x.members),
			complete: (text, caret, scope, filters) => this.complete(f, text, caret, scope, filters),
			fix: (text) => {
				const keys = [...f.propertyKeys().values()].map((k) => [k.name, k.notes] as const);
				const x = findFix(text, keys, (k) => f.known(k));
				return x ? { ...x, notes: f.propertyKeys().get(x.key.toLowerCase())?.notes ?? 0 } : null;
			},
			preview: (filter, scope, filters) => {
				const keep = f.notes(f.resolve(filter));
				const w = this.within(scope, filters);
				const now = Date.now();
				const files = this.app.vault
					.getMarkdownFiles()
					.filter((x) => keep.has(x.path) && (!w || w.has(x.path)))
					.sort((x, y) => y.stat.mtime - x.stat.mtime);
				return files.slice(0, PREVIEW_ROWS).map((x) => ({ ...this.item(x, now), dim: true }));
			},
		};
	}

	/** The autocomplete list for the piece at the caret. */
	private complete(
		f: FilterSets,
		text: string,
		caret: number,
		scope?: string,
		filters?: readonly Filter[],
	): Completion | null {
		const { from, to, piece } = pieceAt(text, caret);
		const want = wantOf(piece, (k) => f.known(k));
		if (!want) return null;
		const starts = (v: string, prefix: string): boolean => !prefix || fold(v).startsWith(fold(prefix));
		const quote = (v: string): string => (/\s/.test(v) ? `"${v}"` : v);
		const where = scope !== undefined ? this.scopeAccess?.all().find((s) => s.id === scope)?.name : undefined;
		const base = { from, to, where };
		switch (want.kind) {
			case "tags": {
				const items = this.tagCounts(scope, filters)
					.filter(([t]) => starts(t.slice(1), want.prefix))
					.slice(0, AC_ITEMS)
					.map(([t, n]) => ({ label: t, count: n, insert: `${t} ` }));
				return items.length ? { ...base, title: "tags", items } : null;
			}
			case "values": {
				const key = f.propertyKeys().get(want.key.toLowerCase())?.name ?? want.key;
				const all = this.values(key, scope, filters);
				const items = all
					.filter(([v]) => starts(v, want.prefix))
					.slice(0, AC_ITEMS)
					.map(([v, n]) => ({ label: v, count: n, insert: `${key}:${quote(v)} ` }));
				if (!items.length) return null;
				const inside = this.files(scope, filters);
				const set = inside.filter((x) => {
					const fm = this.app.metadataCache.getFileCache(x)?.frontmatter;
					return !!fm && Object.keys(fm).some((k) => k.toLowerCase() === key.toLowerCase());
				}).length;
				const narrowed = scope !== undefined || !!filters?.length;
				const vault = narrowed
					? `Vault-wide: ${this.values(key)
							.slice(0, 3)
							.map(([v, n]) => `${v} ${n}`)
							.join(" · ")}`
					: undefined;
				return { ...base, title: key, items, set, total: inside.length, vault };
			}
			case "keys": {
				const items = [...f.propertyKeys().values()]
					.filter((k) => starts(k.name, want.prefix))
					.sort((x, y) => y.notes - x.notes)
					.slice(0, AC_ITEMS)
					.map((k) => ({ label: k.name, count: k.notes, insert: `${k.name}:` }));
				return items.length ? { ...base, title: "properties", items } : null;
			}
			case "windows": {
				const key = piece.slice(0, piece.indexOf(":"));
				const items = (
					[
						["Today", 1],
						["Past 7 days", 7],
						["Past 30 days", 30],
						["Past 90 days", 90],
					] as Array<[string, number]>
				).map(([label, d]) => ({ label, insert: `${key}:${d}d ` }));
				return { ...base, title: key, items };
			}
			case "scopes": {
				const a = this.scopeAccess;
				if (!a) return null;
				a.ensure();
				const all = a.all();
				// Typed with or without its spaces (`@amb st`, `@ambst`).
				const tight = (v: string): string => fold(v).replace(/\s+/g, "");
				const items = all
					.filter((s) =>
						[s.name, ...s.aliases].some(
							(n) => starts(n, want.prefix) || tight(n).startsWith(tight(want.prefix)),
						),
					)
					.map((s) => ({ s, n: a.count(s.id) }))
					.sort((x, y) => y.n - x.n)
					.slice(0, AC_ITEMS)
					.map(({ s, n }) => {
						// A name two scopes share is inserted with its kind, so the one picked is the one applied.
						const shared = all.some((x) => x.id !== s.id && x.name === s.name) && s.kind;
						return {
							label: scopeListLabel({ id: s.id, name: s.name, kind: s.kind, members: n }),
							insert: `@${quote(shared ? `${s.name} ${s.kind}` : s.name)} `,
						};
					});
				return items.length ? { ...base, where: undefined, title: "Scopes", items } : null;
			}
			case "folders": {
				const counts = new Map<string, number>();
				for (const x of this.files(scope, filters)) {
					const parts = x.path.split("/").slice(0, -1);
					for (let i = 1; i <= Math.min(2, parts.length); i++) {
						const p = parts.slice(0, i).join("/");
						counts.set(p, (counts.get(p) ?? 0) + 1);
					}
				}
				const items = [...counts]
					.filter(([p]) => starts(p, want.prefix))
					.sort((x, y) => y[1] - x[1])
					.slice(0, AC_ITEMS)
					.map(([p, n]) => ({ label: p, count: n, insert: `path:${quote(p)} ` }));
				return items.length ? { ...base, title: "folders", items } : null;
			}
		}
	}

	/** The notes inside the scope and filters (null: every note). */
	private within(scope?: string, filters: readonly Filter[] = []): ReadonlySet<string> | null {
		const sets: Array<ReadonlySet<string>> = [];
		if (scope !== undefined && this.scopeAccess) {
			this.scopeAccess.ensure();
			sets.push(this.scopeAccess.membersOf(scope));
		}
		for (const x of filters) if (x.kind !== "title" && this.filterSets) sets.push(this.filterSets.notes(x));
		if (!sets.length) return null;
		const [first, ...rest] = sets;
		return new Set([...(first ?? [])].filter((p) => rest.every((r) => r.has(p))));
	}

	private files(scope?: string, filters?: readonly Filter[]): TFile[] {
		const w = this.within(scope, filters);
		const all = this.app.vault.getMarkdownFiles();
		return w ? all.filter((f) => w.has(f.path)) : all;
	}

	/** A property's values and their note counts (counted inside the scope and filters). */
	private values(key: string, scope?: string, filters?: readonly Filter[]): Array<[string, number]> {
		const low = key.toLowerCase();
		const counts = new Map<string, { name: string; n: number }>();
		for (const file of this.files(scope, filters)) {
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm) continue;
			const k = Object.keys(fm).find((x) => x.toLowerCase() === low);
			if (k === undefined) continue;
			const raw: unknown = fm[k];
			for (const v of new Set(
				(Array.isArray(raw) ? raw : [raw]).map((x) =>
					typeof x === "string" ? x.trim() : typeof x === "number" || typeof x === "boolean" ? String(x) : "",
				),
			)) {
				if (!v) continue;
				const shown = v.replace(/^\[\[|\]\]$/g, "").split("|")[0] ?? v;
				const id = fold(shown);
				const c = counts.get(id) ?? { name: shown, n: 0 };
				c.n++;
				counts.set(id, c);
			}
		}
		return [...counts.values()]
			.sort((x, y) => y.n - x.n || x.name.localeCompare(y.name))
			.slice(0, MENU_ITEMS)
			.map((c) => [c.name, c.n]);
	}

	private tagCounts(scope?: string, filters?: readonly Filter[]): Array<[string, number]> {
		const counts = new Map<string, number>();
		for (const file of this.files(scope, filters)) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache) continue;
			for (const t of new Set((getAllTags(cache) ?? []).map((x) => x.toLowerCase())))
				counts.set(t, (counts.get(t) ?? 0) + 1);
		}
		return [...counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, MENU_ITEMS);
	}

	/** Search inside a note (the ⌘K panel's last action): the plugin opens its in-note search. */
	inNote?: (file: TFile) => void;

	/** The ⌘K panel's actions on a note, with their keys. */
	actions(path: string): NoteAction[] {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return [];
		const backlinks = Object.values(this.app.metadataCache.resolvedLinks ?? {}).filter((t) => path in t).length;
		const tab = this.newTab();
		return [
			{ id: "open", label: "Open", icon: "file", key: "↵", group: 0 },
			{
				id: "other",
				label: tab ? "Open in the same tab" : "Open in new tab",
				icon: "app-window",
				key: "⌘↵",
				group: 0,
			},
			{ id: "split", label: "Open to the right", icon: "columns-2", key: "⌘⌥↵", group: 0 },
			{ id: "insert", label: "Insert link at cursor", icon: "text-cursor-input", key: "⌥↵", group: 0 },
			{ id: "copy-link", label: "Copy wikilink", icon: "link", key: "⌘L", group: 1 },
			{ id: "copy-url", label: "Copy obsidian:// URL", icon: "link-2", key: "⌘⇧L", group: 1 },
			{ id: "reveal", label: "Reveal in file explorer", icon: "folder-open", group: 2 },
			{ id: "move", label: "Move to scope or folder…", icon: "folder-input", group: 2 },
			{ id: "bookmark", label: "Bookmark", icon: "bookmark", group: 2 },
			{ id: "backlinks", label: "Show backlinks", icon: "links-coming-in", detail: String(backlinks), group: 2 },
			{ id: "in-note", label: "Search in this note", icon: "file-search", group: 2 },
		];
	}

	/** Run a ⌘K action; true when Jet should close. */
	act(id: string, path: string): boolean {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return false;
		const internal = (pid: string): Record<string, unknown> | undefined =>
			(
				this.app as unknown as {
					internalPlugins?: { getPluginById(id: string): { instance?: Record<string, unknown> } | null };
				}
			).internalPlugins?.getPluginById(pid)?.instance;
		switch (id) {
			case "open":
			case "other":
			case "split":
				this.open(path, id === "open" ? "default" : id);
				return true;
			case "insert":
				this.insertLink(path);
				return true;
			case "copy-link":
				this.copyLink(path);
				return false;
			case "copy-url": {
				const url = `obsidian://open?vault=${encodeURIComponent(this.app.vault.getName())}&file=${encodeURIComponent(path)}`;
				void navigator.clipboard.writeText(url).then(() => new Notice("URL copied"));
				return false;
			}
			case "reveal": {
				const fe = internal("file-explorer") as { revealInFolder?(f: TFile): void } | undefined;
				if (fe?.revealInFolder) fe.revealInFolder(file);
				else new Notice("The file explorer is off.");
				return true;
			}
			case "bookmark": {
				const bm = internal("bookmarks") as
					| { addItem?(i: { type: "file"; path: string; title: string }): void }
					| undefined;
				if (bm?.addItem) {
					bm.addItem({ type: "file", path, title: "" });
					new Notice("Bookmarked");
				} else new Notice("Bookmarks are off.");
				return false;
			}
			case "backlinks":
				void this.app.workspace
					.getLeaf(this.newTab() ? "tab" : false)
					.openFile(file)
					.then(() =>
						(
							this.app as unknown as { commands?: { executeCommandById(id: string): boolean } }
						).commands?.executeCommandById("backlink:open-backlinks"),
					);
				return true;
			case "in-note":
				// As any opening: a new tab when that is your setting.
				void this.app.workspace
					.getLeaf(this.newTab() ? "tab" : false)
					.openFile(file)
					.then(() => this.inNote?.(file));
				return true;
			case "move":
				new MoveModal(this.app, file, this.scopeAccess?.all() ?? []).open();
				return true;
			default:
				return false;
		}
	}

	/** Obsidian's core Search with this query. */
	coreSearch(query: string): void {
		const gs = (
			this.app as unknown as {
				internalPlugins?: {
					getPluginById(id: string): { instance?: { openGlobalSearch?(q: string): void } } | null;
				};
			}
		).internalPlugins?.getPluginById("global-search")?.instance;
		if (gs?.openGlobalSearch) gs.openGlobalSearch(query);
		else new Notice("Obsidian's search plugin is off.");
	}

	/** Open the Scopes settings page (the popover's Manage). */
	manageScopes?: () => void;

	/** Rule counts for the chip's card, kept while the modal is open (each is a pass over the vault). */
	private readonly ruleCounts = new Map<string, number>();

	/** Scope typing for the modal, when there are scopes. */
	get scopes(): ModalHost["scopes"] {
		const a = this.scopeAccess;
		if (!a?.all().length) return undefined;
		return { typed: (t) => this.typed(a, t), card: (id) => this.card(a, id), edit: (id) => a.edit(id) };
	}

	private typed(a: HostScopes, text: string): Typed {
		const p = parseScope(text, a.all());
		if (!p.applied && !p.suggest && !p.hint) return {};
		a.ensure();
		const view = (s: Scope): ScopeView => ({ id: s.id, name: s.name, kind: s.kind, members: a.count(s.id) });
		const biggest = (xs: readonly Scope[]): Scope[] => [...xs].sort((x, y) => a.count(y.id) - a.count(x.id));
		if (p.applied) {
			// A name several scopes share: the biggest, the others one ⇥ away.
			const [first = p.applied, ...others] = biggest(p.appliedAll ?? [p.applied]);
			return { applied: { scope: view(first), text: p.text, complete: !!p.complete, others: others.map(view) } };
		}
		if (p.suggest) {
			// Scopes of one name: the biggest first.
			const [first, ...others] = [...p.suggest.scopes].sort((x, y) => a.count(y.id) - a.count(x.id));
			if (!first) return {};
			const t: Typed = {
				suggest: {
					scope: view(first),
					others: others.map(view),
					name: p.suggest.name,
					rest: p.suggest.rest,
					at: p.suggest.at,
				},
			};
			// A name two scopes share never applies by itself; nor one that starts a longer scope's name
			// while what follows could still be the rest of it ("cobalt re…" for Cobalt Research).
			if (
				!others.length &&
				this.autoFor(first) &&
				!this.longerName(a, p.suggest.name, text.slice(p.suggest.at + p.suggest.name.length))
			)
				t.auto = true;
			return t;
		}
		if (!p.hint) return {};
		const [first = p.hint, ...others] = biggest(p.hintAll ?? [p.hint]);
		const t: Typed = { hint: view(first), ...(others.length ? { hintOthers: others.map(view) } : {}) };
		if (!others.length && this.autoFor(first) && !this.longerName(a, text.trim(), "")) t.auto = true;
		return t;
	}

	/** Whether another scope's name starts with `name` and `next` (what follows it) could still be its rest. */
	private longerName(a: HostScopes, name: string, next: string): boolean {
		const n = fold(name);
		const after = fold(next.trim().split(/\s+/)[0] ?? "");
		return a.all().some((s) =>
			[s.name, ...s.aliases].some((x) => {
				const f = fold(x);
				return f.startsWith(`${n} `) && f.slice(n.length + 1).startsWith(after);
			}),
		);
	}

	/** Whether a scope applies at once for its name or alias as typed: when you set it to Auto, in any casing. */
	private autoFor(s: Scope): boolean {
		return s.mode === "auto";
	}

	private card(a: HostScopes, id: string): ScopeCard {
		const s = a.all().find((x) => x.id === id);
		if (!s) return { name: "", kind: "", mode: "", rules: [], total: 0, aliases: [] };
		const count = (r: Rule): number => {
			const key = JSON.stringify(r);
			let n = this.ruleCounts.get(key);
			if (n === undefined) {
				n = a.ruleCount(r);
				this.ruleCounts.set(key, n);
			}
			return n;
		};
		return {
			name: s.name,
			kind: s.kind,
			mode: MODE_LABEL[s.mode],
			all: s.combine === "all",
			rules: s.rules.map((r) => ({ ...ruleLine(r), count: count(r) })),
			total: a.count(s.id),
			aliases: [...s.aliases],
		};
	}

	/** A scope's notes with nothing typed: those you opened, most recent first, then by last change. */
	private scopeRecents(id: string): Entry[] {
		const a = this.scopeAccess;
		if (!a) return [];
		a.ensure();
		const now = Date.now();
		const opened = this.data().opened;
		const files = [...a.membersOf(id)]
			.map((p) => this.app.vault.getFileByPath(p))
			.filter((f): f is TFile => !!f)
			.map((f) => {
				const at = opened[f.path]?.[1];
				return { f, tier: at === undefined ? 0 : 1, at: at ?? f.stat.mtime };
			})
			.sort((x, y) => y.tier - x.tier || y.at - x.at)
			.slice(0, SCOPE_RECENTS);
		if (!files.length) return [];
		return [
			{ type: "header", label: "Recent", count: files.length },
			...files.map(({ f, at }) => ({ ...this.item(f, now), meta: age(at, now) })),
		];
	}

	/** The popover from the footer: excerpts, the double tap window, the index. */
	renderSettings(el: HTMLElement): void {
		const s = this.data().settings;
		const row = (name: string, desc: string): HTMLElement => {
			const r = el.createDiv({ cls: "jet-si2" });
			const t = r.createDiv({ cls: "jet-sitx" });
			t.createDiv({ cls: "jet-sinm", text: name });
			t.createDiv({ cls: "jet-sids", text: desc });
			return r;
		};
		const persist = row(
			"Persist filters across sessions",
			"Keep chips when Search reopens; kept chips show a pin dot",
		);
		const ptog = persist.createDiv({ cls: `checkbox-container${s.persistFilters ? " is-enabled" : ""}` });
		ptog.addEventListener("click", () => {
			s.persistFilters = !s.persistFilters;
			if (!s.persistFilters) this.data().last = null;
			ptog.toggleClass("is-enabled", s.persistFilters);
			this.save();
		});
		const ex = row("Show excerpts", "A line around the best hit");
		const tog = ex.createDiv({ cls: `checkbox-container${s.excerpts ? " is-enabled" : ""}` });
		tog.addEventListener("click", () => {
			s.excerpts = !s.excerpts;
			tog.toggleClass("is-enabled", s.excerpts);
			this.save();
		});
		const win = row("Double tap window", "Two clean taps of ⇧ within this time");
		const sel = win.createEl("select", { cls: "dropdown" });
		for (const ms of [250, 350, 500]) sel.createEl("option", { text: `${ms} ms`, attr: { value: String(ms) } });
		sel.value = String(s.shiftInterval);
		sel.addEventListener("change", () => {
			s.shiftInterval = Number(sel.value);
			this.save();
		});
		const a = this.scopeAccess;
		if (a) {
			const all = a.all();
			const auto = all.filter((x) => x.mode === "auto").length;
			const sc = row(
				"Scopes",
				all.length ? `${all.length} scopes${auto ? ` · ${auto} on Auto` : ""}` : "None yet",
			);
			const manage = sc.createSpan({ cls: "jet-manage", text: "Manage ↗", attr: { role: "button" } });
			manage.addEventListener("click", () => this.manageScopes?.());
		}
		if (!this.index) return;
		const card = el.createDiv({ cls: "jet-idx" });
		const head = card.createDiv({ cls: "jet-ir" });
		const state = head.createSpan({ cls: "jet-ok", text: "…" });
		const rb = head.createSpan({ cls: "jet-rb2", text: "Rebuild", attr: { role: "button" } });
		const grid = card.createDiv({ cls: "jet-ig" });
		const fill = (x: IndexStatus): void => {
			state.setText(x.state);
			state.toggleClass("is-warn", !x.ok);
			grid.empty();
			for (const [k, v] of [
				["Notes", x.notes],
				["Size", x.size],
				["Updated", x.updated],
			]) {
				grid.createSpan({ text: k });
				grid.createSpan({ text: v });
			}
		};
		const index = this.index;
		void index.status().then(fill);
		rb.addEventListener("click", () => {
			state.setText("Rebuilding…");
			void index.rebuild().then(() => index.status().then(fill));
		});
	}

	list(
		text: string,
		paint: (entries: Entry[], status?: string) => void,
		scope?: string,
		filters: readonly Filter[] = [],
		meaning?: { on: boolean; offered: boolean },
		order?: Sort,
	): void {
		if (!text.trim() && !filters.length) {
			paint(scope !== undefined ? this.scopeRecents(scope) : this.recents());
			this.search().warm();
			return;
		}
		this.search().list(text, paint, scope, filters, meaning, order);
	}

	/** Search by meaning, set by the plugin: available while it is on and its model is installed. */
	meaning?: ModalHost["meaning"];

	/** The last scope and filters, when "Persist filters" is on. */
	restore(): { scope?: ScopeView; filters: Filter[] } | null {
		const d = this.data();
		if (!d.settings.persistFilters || !d.last) return null;
		const s = d.last.scope !== undefined ? this.scopeAccess?.all().find((x) => x.id === d.last?.scope) : undefined;
		const scope = s
			? { id: s.id, name: s.name, kind: s.kind, members: this.scopeAccess?.count(s.id) ?? 0 }
			: undefined;
		return { scope, filters: d.last.filters };
	}

	/**
	 * The empty state's scopes: the open note's scope first (the smallest one
	 * holding it by its folder, else by any rule), then the most used, then the biggest.
	 */
	private scopeRow(): Entry | null {
		const a = this.scopeAccess;
		const all = a?.all() ?? [];
		if (!a || !all.length) return null;
		a.ensure();
		const uses = this.data().scopeUses;
		const view = (s: Scope): ScopeView => ({ id: s.id, name: s.name, kind: s.kind, members: a.count(s.id) });
		const active = this.app.workspace.getActiveFile()?.path;
		const holding = active ? all.filter((s) => a.membersOf(s.id).has(active)) : [];
		const byFolder = holding.filter((s) =>
			s.rules.some((r) => r.kind === "folder" && active?.startsWith(`${r.path}/`)),
		);
		const here = [...(byFolder.length ? byFolder : holding)].sort((x, y) => a.count(x.id) - a.count(y.id))[0];
		const rest = all
			.filter((s) => s !== here && s.mode !== "in-only")
			.sort((x, y) => (uses[y.id] ?? 0) - (uses[x.id] ?? 0) || a.count(y.id) - a.count(x.id));
		// Every scope on one line that slides, then "All N" for the full list.
		const chips = [...(here ? [{ scope: view(here), here: true }] : []), ...rest.map((s) => ({ scope: view(s) }))];
		return {
			type: "scopes",
			label: `Search in · ${chips.length} scope${chips.length === 1 ? "" : "s"}`,
			chips,
			more: 0,
		};
	}

	/** A remembered search's scope and filters as chips, the rest as text. */
	private parts(q: string): Array<{ chip: [string, string] } | { text: string }> | undefined {
		const f = this.filterSets;
		const found = f ? findFilters(q, (k) => f.known(k)).filter((x) => x.complete || x.to === q.length) : [];
		let rest = found.length ? withoutPieces(q, found) : q;
		const p = this.scopeAccess ? parseScope(rest, this.scopeAccess.all()) : { text: rest };
		const out: Array<{ chip: [string, string] } | { text: string }> = [];
		if (p.applied) {
			out.push({ chip: ["", p.applied.name] });
			rest = p.text;
		}
		for (const x of found) out.push({ chip: filterLabel(x.filter) });
		if (!out.length) return undefined;
		if (rest.trim()) out.push({ text: rest.trim() });
		return out;
	}

	recents(): Entry[] {
		const now = Date.now();
		const vault = this.app.vault;
		const out: Entry[] = [];
		const row = this.scopeRow();
		if (row) out.push(row);
		const searches = this.data().searches.slice(0, 3);
		if (searches.length) {
			out.push({ type: "header", label: "Recent searches" });
			for (const q of searches) {
				const parts = this.parts(q);
				out.push(parts ? { type: "search", query: q, parts } : { type: "search", query: q });
			}
		}
		const groups = groupRecents(
			this.data(),
			this.app.workspace.getLastOpenFiles().filter((p) => p.endsWith(".md")),
			(p) => vault.getFileByPath(p)?.stat.mtime ?? 0,
			(p) => p.endsWith(".md") && !!vault.getFileByPath(p),
			now,
		);
		for (const g of groups) {
			out.push({ type: "header", label: g.label });
			for (const it of g.items) {
				const f = vault.getFileByPath(it.path);
				if (f) out.push({ ...this.item(f, now), meta: age(it.at, now) });
			}
		}
		return out;
	}

	item(
		file: TFile,
		now: number,
		extra: Partial<Extract<Entry, { type: "item" }>> = {},
	): Extract<Entry, { type: "item" }> {
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

	open(path: string, how: OpenHow, at?: OpenAt): void {
		const file = this.app.vault.getFileByPath(path);
		// Deleted or moved since it was listed: say so, rather than closing with nothing opened.
		if (!file) {
			new Notice(`“${titleOf(path)}” is no longer in the vault.`);
			return;
		}
		const ws = this.app.workspace;
		const leaf =
			how === "split" ? ws.getLeaf("split") : ws.getLeaf((how === "other") !== this.newTab() ? "tab" : false);
		void (async () => {
			// At the hit, as Obsidian's own search opens a match: the line scrolled to, then selected.
			let pos: { line: number; ch: number; len: number } | null = at && "line" in at ? at : null;
			if (at && "offset" in at) {
				const text = await this.app.vault.cachedRead(file);
				const before = text.slice(0, Math.min(at.offset, text.length));
				pos = {
					line: before.split("\n").length - 1,
					ch: before.length - (before.lastIndexOf("\n") + 1),
					len: at.len,
				};
			}
			await leaf.openFile(file, pos ? { eState: { line: pos.line } } : undefined);
			const view = leaf.view as unknown as {
				getMode?: () => string;
				editor?: {
					setSelection(a: EditorPosition, b: EditorPosition): void;
					scrollIntoView(r: unknown, center?: boolean): void;
				};
			};
			if (pos && view.editor && view.getMode?.() !== "preview") {
				const from = { line: pos.line, ch: pos.ch };
				const to = { line: pos.line, ch: pos.ch + pos.len };
				view.editor.setSelection(from, to);
				view.editor.scrollIntoView({ from, to }, true);
			}
		})().catch((e: unknown) => console.error("Jet Search: the note could not be opened", e));
	}

	hints(text: string, state: HintState = {}): Array<[string, string]> {
		const t = text.trim();
		const short = t.length > 18 ? `${t.slice(0, 17)}…` : t;
		const tab = this.newTab() ? "Same tab" : "New tab";
		if (state.chip && state.auto)
			return [
				["⌫", "Undo scope"],
				["↵", "Open"],
				["⌘↵", tab],
				["⇧⇧", "Widen"],
			];
		if (state.widened)
			return [
				["⇧⇧", `Back to ${state.widened}`],
				["↵", "Open"],
				["⌘↵", tab],
				["⌥↵", "Insert link"],
			];
		if (state.chip && state.more && !state.selected)
			return [
				["⇥", "Next scope"],
				["⇧⇥", "Back"],
				["↵", "Open"],
				["⌫", `Remove ${state.chip}`],
				["⇧⇧", "Widen"],
			];
		if (state.chip && state.selected)
			return [
				["⌫", `Remove ${state.chip} (it returns as text)`],
				["Esc", "Keep it"],
				["↵", "Open"],
			];
		if (state.chip)
			return t
				? [
						["↵", "Open"],
						["⌘↵", tab],
						["⇧↵", `Create in ${state.chip}`],
						["⌫", `Remove ${state.chip}`],
						["⇧⇧", "Widen"],
					]
				: [
						["↵", "Open"],
						["↑↓", "Choose"],
						["⌫", `Remove ${state.chip}`],
						["Esc", "Clear"],
					];
		const named = state.suggest ?? state.hint;
		if (named)
			return [
				["⇥", `Search in ${named}`],
				["↵", "Open"],
				["⌘↵", tab],
				["⌥↵", "Insert link"],
				state.hint ? ["⇧↵", `Create “${short}”`] : ["⌘.", "Preview"],
			];
		return t
			? [
					["↵", "Open"],
					["⌘↵", this.newTab() ? "Same tab" : "New tab"],
					["⌥↵", "Insert link"],
					["⇧↵", `Create “${short}”`],
					["⌘.", "Preview"],
				]
			: [
					["↵", "Open"],
					["↑↓", "Choose"],
					["⌘L", "Copy link"],
					["Esc", "Close"],
				];
	}

	previewOn(): boolean {
		return this.data().settings.preview;
	}

	setPreviewOn(on: boolean): void {
		this.data().settings.preview = on;
		this.save();
	}

	copyLink(path: string): void {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		const link = this.app.fileManager.generateMarkdownLink(file, this.app.workspace.getActiveFile()?.path ?? "");
		void navigator.clipboard.writeText(link).then(() => new Notice("Link copied"));
	}

	insertLink(path: string): void {
		const file = this.app.vault.getFileByPath(path);
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!file || !view?.file) {
			new Notice("Open a note to insert a link into");
			return;
		}
		view.editor.replaceSelection(this.app.fileManager.generateMarkdownLink(file, view.file.path));
	}

	create(text: string, scope?: string): void {
		// "Folder/Name" makes the note in that folder, as Obsidian's quick switcher does;
		// "Name.md" is "Name".
		const parts = text.replace(/\.md\s*$/i, "").split("/");
		const clean = (x: string): string =>
			x
				.replace(/[\\:*?"<>|#^[\]]/g, " ")
				.replace(/\s+/g, " ")
				.trim()
				// A leading dot hides the file; Windows drops trailing dots and spaces.
				.replace(/^\.+/, "")
				.replace(/[.\s]+$/, "")
				.trim();
		const typedFolder = parts.slice(0, -1).map(clean).filter(Boolean).join("/");
		let name = clean(parts.at(-1) ?? "");
		// At most 120 characters, never inside one (an emoji cut in half is not a file name).
		if (name.length > 120) name = name.slice(0, clusterStart(name, 120)).trim();
		if (!name) return;
		// In a scope: its folder, its properties and tags filled in.
		const s = scope !== undefined ? this.scopeAccess?.all().find((x) => x.id === scope) : undefined;
		const target = s ? createTarget(s) : null;
		const active = this.app.workspace.getActiveFile()?.path ?? "";
		const folder =
			target?.folder && this.app.vault.getFolderByPath(target.folder)
				? target.folder
				: typedFolder || this.app.fileManager.getNewFileParent(active).path;
		const path = normalizePath(`${folder === "/" ? "" : `${folder}/`}${name}.md`);
		// The same name in another case is the same file on macOS and Windows: open it.
		const low = path.toLowerCase();
		const existing =
			this.app.vault.getFileByPath(path) ??
			this.app.vault.getMarkdownFiles().find((f) => f.path.toLowerCase() === low) ??
			null;
		void (async () => {
			if (!existing && typedFolder && folder === typedFolder && !this.app.vault.getFolderByPath(folder))
				await this.app.vault.createFolder(folder);
			const file = existing ?? (await this.app.vault.create(path, ""));
			if (!existing && target && (target.props.length || target.tags.length))
				await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
					for (const [k, v] of target.props) fm[k] = v;
					if (target.tags.length) fm.tags = target.tags.map((t) => t.replace(/^#/, ""));
				});
			await this.app.workspace.getLeaf(this.newTab() ? "tab" : false).openFile(file);
		})().catch((e: unknown) => {
			console.error("Jet Search: could not create the note", e);
			new Notice("The note could not be created.");
		});
	}

	closed(text: string, opened: boolean, scope?: ScopeView, filters: readonly Filter[] = []): void {
		this.ruleCounts.clear();
		const d = this.data();
		if (opened && scope) d.scopeUses[scope.id] = (d.scopeUses[scope.id] ?? 0) + 1;
		d.last =
			d.settings.persistFilters && (scope || filters.length) ? { scope: scope?.id, filters: [...filters] } : null;
		// Remembered as typed, scope and filters included, so choosing it again applies them again.
		const parts = [...filters.map(filterText).filter(Boolean), text.trim()].filter(Boolean).join(" ");
		// A name another scope shares is written "Name Kind", so the search finds the same scope again.
		const shared = scope && (this.scopeAccess?.all() ?? []).some((s) => s.id !== scope.id && s.name === scope.name);
		const named = scope ? (shared && scope.kind ? `${scope.name} ${scope.kind}` : scope.name) : "";
		if (opened) rememberSearch(this.data(), scope ? scopedSearch(named, parts) : parts);
		this.search().idle();
		this.save();
	}
}

type MoveTarget = { label: string; folder: string; scope?: Scope };

/** "Move to scope or folder…" (⌘K): a scope moves the note to its folder and fills in its property. */
class MoveModal extends FuzzySuggestModal<MoveTarget> {
	constructor(
		app: App,
		private readonly file: TFile,
		private readonly scopes: readonly Scope[],
	) {
		super(app);
		this.setPlaceholder(`Move “${file.basename}” to…`);
	}

	getItems(): MoveTarget[] {
		const out: MoveTarget[] = [];
		for (const s of this.scopes) {
			const t = createTarget(s);
			if (t.folder) out.push({ label: `${s.name}${s.kind ? ` · ${s.kind}` : ""}`, folder: t.folder, scope: s });
		}
		for (const f of this.app.vault.getAllLoadedFiles())
			if (f instanceof TFolder && f.path !== "/") out.push({ label: f.path, folder: f.path });
		return out;
	}

	getItemText(t: MoveTarget): string {
		return t.label;
	}

	onChooseItem(t: MoveTarget): void {
		const to = normalizePath(`${t.folder}/${this.file.name}`);
		void (async () => {
			if (to !== this.file.path) await this.app.fileManager.renameFile(this.file, to);
			const target = t.scope ? createTarget(t.scope) : null;
			if (target?.props.length)
				await this.app.fileManager.processFrontMatter(this.file, (fm: Record<string, unknown>) => {
					for (const [k, v] of target.props) fm[k] = v;
				});
			new Notice(`Moved to ${t.folder}`);
		})().catch((e: unknown) => {
			console.error("Jet Search: could not move the note", e);
			new Notice("The note could not be moved.");
		});
	}
}
