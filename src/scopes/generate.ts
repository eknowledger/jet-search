/**
 * The scope generator: groups of notes found by their shape, merged
 * where independent signals agree, named, counted, and ticked or not for review. The P1 signals:
 * container folders, Johnny.Decimal, link and category properties, tag hierarchies; guarded by masks
 * (excluded, templates, attachments), see-through folders (periods, sequences), repeated subfolders,
 * id names, system and id-like keys, keys whose values spread thin, and the facet test (kinds of
 * notes are not topics). Pure and deterministic: the same snapshot gives the same proposals.
 */
import { matches } from "./members";
import type { NoteFacts } from "./members";
import { type Origin, type Rule, scopeId } from "./model";
import { compact, fold, isPeriod, jdArea, jdCategory, jdId, sequenceSiblings, sharesScheme, stripName } from "./names";
import type { Snapshot } from "./snapshot";

export type { Origin } from "./model";

export type Proposal = {
	id: string;
	name: string;
	aliases: string[];
	/** The kind label ("Projects", "category", "#client"). */
	kind: string;
	/** The review page's group ("Subfolders of 2.Projects", "Values of category"…). */
	group: string;
	rules: Array<{ rule: Rule; count: number }>;
	members: number;
	ticked: boolean;
	/** Why it starts unticked (empty when ticked). */
	untick: string[];
	origins: Origin[];
};

export type Generated = { proposals: Proposal[]; notProposed: Array<{ what: string; why: string }>; notes: number };

const V = 1;
const TICK = 5;
const LIST = 3;
const SYSTEM_KEYS = new Set([
	"tags",
	"tag",
	"aliases",
	"alias",
	"cssclasses",
	"cssclass",
	"publish",
	"permalink",
	"description",
	"image",
	"cover",
	"position",
	"kanban-plugin",
	"excalidraw-plugin",
]);
const NOT_SORTING_TYPES = new Set(["number", "date", "datetime", "checkbox"]);
/** The one word convention: archive-like containers start unticked. */
const ARCHIVE = new Set([
	"archive",
	"archives",
	"archiv",
	"archivo",
	"archivio",
	"arquivo",
	"archief",
	"arkiv",
	"アーカイブ",
	"存档",
	"归档",
	"أرشيف",
]);
const PLACEHOLDER = /\{\{\s*(date|title|time)|<%/;
/** A note named by a date, a week or a stamp ("2023-02-11 Pottery class", "2023-W07", "202301151230 …"). */
const DATED = /^(\d{4}-\d{2}-\d{2}|\d{4}-W\d{2}|\d{8,14})(?![\d])/;

/** S(N): the support a vault-wide pattern needs (a key, a tag root). */
export const support = (n: number): number => Math.max(10, Math.min(Math.ceil(0.05 * n), 100));

type Group = {
	signal: string;
	at: string;
	key: string;
	name: string;
	alias: string | null;
	aliases: string[];
	kind: string;
	label: string;
	rules: Rule[];
	members: Set<string>;
	family: "folder" | "property" | "tag";
	/** Folder groups: the folder, its container and the container's depth. */
	folder?: string;
	container?: string;
	depth?: number;
	/** Link-property groups: the note the values resolve to. */
	target?: string;
	/** Starts unticked whatever else happens (archive, inbox, many small values…). */
	untick: string[];
	/** A numbered system (Johnny.Decimal): its levels are ticked. */
	numbered?: boolean;
};

type Folder = {
	path: string;
	name: string;
	parent: string | null;
	children: string[];
	direct: string[];
	sub: number;
	files: number;
	md: number;
};

const parentOf = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const under = (p: string, f: string): boolean => f === "" || p.startsWith(`${f}/`);
const basename = (p: string): string => (p.split("/").pop() ?? p).replace(/\.md$/i, "");

const values = (props: Record<string, unknown>, key: string): unknown[] => {
	const v = props[key];
	return Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v];
};
const isLinkText = (v: unknown): boolean => typeof v === "string" && /^\[\[[^\]]+\]\]$/.test(v.trim());
const aliasesOf = (n: NoteFacts | undefined): string[] => {
	const a = n?.props.aliases ?? n?.props.alias;
	return (Array.isArray(a) ? a : a ? [a] : []).filter((x): x is string => typeof x === "string" && !!x.trim());
};

export const generate = (snap: Snapshot): Generated => {
	const cfg = snap.config;
	const notProposed: Generated["notProposed"] = [];
	const byPath = new Map(snap.notes.map((n) => [n.path, n]));

	// 1. Masks: excluded paths, templates, attachments (configured, then by shape).
	const masks = new Set<string>([...cfg.excluded.map((e) => e.replace(/\/+$/, "")), ".trash"]);
	if (cfg.templates) masks.add(cfg.templates.replace(/\/+$/, ""));
	if (cfg.attachments && cfg.attachments !== "/" && !cfg.attachments.startsWith("./"))
		masks.add(cfg.attachments.replace(/\/+$/, ""));

	// The folder tree, from every file.
	const folders = new Map<string, Folder>();
	const folder = (path: string): Folder => {
		let f = folders.get(path);
		if (!f) {
			const parent = path === "" ? null : parentOf(path);
			f = {
				path,
				name: path === "" ? "" : basename(path),
				parent,
				children: [],
				direct: [],
				sub: 0,
				files: 0,
				md: 0,
			};
			folders.set(path, f);
			if (parent !== null) folder(parent).children.push(path);
		}
		return f;
	};
	folder("");
	for (const file of snap.files) {
		const isMd = file.toLowerCase().endsWith(".md");
		const dir = parentOf(file);
		for (let d: string | null = dir; d !== null; d = d === "" ? null : parentOf(d)) {
			const f = folder(d);
			f.files++;
			if (isMd) f.md++;
		}
	}
	for (const f of folders.values()) f.children.sort();
	// By shape: attachment folders (≥ 80% of files not notes), template folders (≥ 50% of notes with placeholders).
	for (const f of folders.values()) {
		if (f.path === "" || f.files < 3) continue;
		// A folder of files with a few stray notes, not a project with many assets.
		if ((f.files - f.md) / f.files >= 0.8 && f.md < 5) masks.add(f.path);
	}
	const masked = (p: string): boolean => [...masks].some((m) => p === m || p.startsWith(`${m}/`));
	const notes = snap.notes.filter((n) => !masked(n.path));
	for (const n of notes) folder(parentOf(n.path)).direct.push(n.path);
	for (const f of folders.values()) {
		if (f.path === "" || !f.direct.length || masked(f.path)) continue;
		const withPlaceholders = f.direct.filter((p) =>
			Object.values(byPath.get(p)?.props ?? {}).some((v) => typeof v === "string" && PLACEHOLDER.test(v)),
		);
		if (f.direct.length >= 2 && withPlaceholders.length / f.direct.length >= 0.5) masks.add(f.path);
	}
	const live = notes.filter((n) => !masked(n.path));
	const N = live.length;
	const shownMasks = [...masks].sort().filter((m) => folders.has(m) && m !== ".trash");
	for (const m of shownMasks)
		if (!shownMasks.some((o) => o !== m && m.startsWith(`${o}/`)))
			notProposed.push({ what: m, why: "left out: excluded, templates or attachments" });
	for (const n of live)
		for (let d: string | null = parentOf(n.path); d !== null; d = d === "" ? null : parentOf(d)) folder(d).sub++;

	// 2. Flags: see-through folders (periods, sequences), repeated subfolders, ids.
	const seeThrough = new Set<string>();
	for (const f of folders.values()) {
		const kids = f.children.filter((c) => !masked(c));
		if (!kids.length) continue;
		const inYear = /^(1[89]|20|21)\d{2}$/.test(f.name);
		const periods = kids.filter((c) => isPeriod(basename(c), { inYear, locales: cfg.locales }));
		if (periods.length / kids.length >= 0.8) for (const c of periods) seeThrough.add(c);
		for (const name of sequenceSiblings(kids.map(basename)))
			for (const c of kids) if (basename(c) === name) seeThrough.add(c);
	}
	const repeatedUnder = new Map<string, Set<string>>();
	for (const f of folders.values()) {
		const kids = f.children.filter((c) => !masked(c));
		const count = new Map<string, number>();
		for (const k of kids)
			for (const g of new Set((folders.get(k)?.children ?? []).map((x) => fold(basename(x)))))
				count.set(g, (count.get(g) ?? 0) + 1);
		const rep = new Set(
			[...count].filter(([, c]) => c >= 3 || (kids.length >= 4 && c / kids.length >= 0.5)).map(([g]) => g),
		);
		if (rep.size) repeatedUnder.set(f.path, rep);
	}
	const isRepeated = (child: string): boolean => {
		const grand = parentOf(parentOf(child));
		const p = parentOf(child);
		return p !== "" && (repeatedUnder.get(grand)?.has(fold(basename(child))) ?? false) && folders.has(p);
	};
	const seeThroughAll = (p: string): boolean => seeThrough.has(p) || isRepeated(p) || jdId(basename(p));
	for (const p of [...seeThrough].sort().slice(0, 30))
		notProposed.push({ what: p, why: "dates or a numbered sequence: not topics" });

	const groups: Group[] = [];
	const membersUnder = (f: string): Set<string> => new Set(live.filter((n) => under(n.path, f)).map((n) => n.path));
	const inbox = cfg.inbox?.replace(/\/+$/, "") ?? null;
	const daily = cfg.daily?.replace(/\/+$/, "") ?? null;

	// 3a. Johnny.Decimal: areas and categories, both ticked (a numbered system).
	const jdHandled = new Set<string>();
	for (const f of folders.values()) {
		const areas = f.children.filter((c) => !masked(c) && jdArea(basename(c)));
		if (areas.length < 2) continue;
		const cats = areas.flatMap((a) => (folders.get(a)?.children ?? []).filter((c) => !masked(c)));
		const inRange = cats.filter((c) => {
			const n = jdCategory(basename(c));
			const r = jdArea(basename(parentOf(c)));
			return n !== null && r !== null && n >= r.from && n <= r.to;
		});
		if (cats.length && inRange.length / cats.length < 0.7) continue;
		jdHandled.add(f.path);
		for (const a of areas) {
			jdHandled.add(a);
			const s = stripName(basename(a), false);
			const archived = ARCHIVE.has(fold(s.name)) ? ["in an archive"] : [];
			groups.push({
				signal: "johnny-decimal",
				at: f.path,
				key: a,
				name: s.name,
				alias: s.alias,
				aliases: [],
				kind: "",
				label: "Numbered areas",
				rules: [{ kind: "folder", path: a }],
				members: membersUnder(a),
				family: "folder",
				folder: a,
				container: f.path,
				depth: -1,
				untick: archived,
				numbered: true,
			});
		}
		for (const c of inRange) {
			const s = stripName(basename(c), false, true);
			const archived = ARCHIVE.has(fold(stripName(basename(parentOf(c)), false).name)) ? ["in an archive"] : [];
			groups.push({
				signal: "johnny-decimal",
				at: parentOf(c),
				key: c,
				name: s.name,
				alias: s.alias,
				aliases: [],
				kind: stripName(basename(parentOf(c)), false).name,
				label: "Numbered categories",
				rules: [{ kind: "folder", path: c }],
				members: membersUnder(c),
				family: "folder",
				folder: c,
				container: parentOf(c),
				depth: -1,
				untick: archived,
				numbered: true,
			});
		}
	}

	// 3b. Container folders: ≥ 2 children of ≥ 5 notes holding ≥ 50% of the folder's notes.
	const containers: string[] = [];
	for (const f of folders.values()) {
		if (masked(f.path) || jdHandled.has(f.path) || f.path === inbox || f.path === daily || seeThroughAll(f.path))
			continue;
		const kids = f.children.filter((c) => !masked(c) && !seeThroughAll(c) && !jdHandled.has(c));
		const qualifying = kids.filter((c) => (folders.get(c)?.sub ?? 0) >= 5);
		const inKids = qualifying.reduce((s, c) => s + (folders.get(c)?.sub ?? 0), 0);
		if (qualifying.length < 2 || !f.sub || inKids / f.sub < 0.5) continue;
		containers.push(f.path);
		const depth = f.path === "" ? 0 : f.path.split("/").length;
		const scheme = sharesScheme(kids.map(basename));
		const archive = ARCHIVE.has(fold(stripName(f.name, true).name));
		const kind =
			f.path === ""
				? ""
				: stripName(f.name, sharesScheme((folders.get(f.parent ?? "")?.children ?? []).map(basename))).name;
		for (const c of kids) {
			const members = membersUnder(c);
			if (!members.size) continue;
			const dated = [...members].filter((p) => DATED.test(basename(p))).length;
			if (dated / members.size >= 0.8) {
				notProposed.push({
					what: c,
					why: `date-named: ${dated} of its ${members.size} notes are named by a date; dates are not topics`,
				});
				continue;
			}
			const s = stripName(basename(c), scheme);
			const untick: string[] = [];
			if (archive) untick.push("in an archive");
			if (c === inbox) untick.push("the inbox");
			if (c === daily) untick.push("the daily notes");
			groups.push({
				signal: "container-folder",
				at: f.path,
				key: c,
				name: s.name,
				alias: s.alias,
				aliases: [],
				kind,
				label: `Subfolders of ${f.path === "" ? "the vault" : f.path}`,
				rules: [{ kind: "folder", path: c }],
				members,
				family: "folder",
				folder: c,
				container: f.path,
				depth,
				untick,
			});
		}
	}

	// 3c. Properties: link keys and category keys.
	const S = support(N);
	type KeyStat = {
		key: string;
		notes: Set<string>;
		elements: number;
		links: number;
		byTarget: Map<string, Set<string>>;
		byValue: Map<string, { spellings: Map<string, number>; notes: Set<string> }>;
		long: number;
		lens: number;
	};
	const stats = new Map<string, KeyStat>();
	for (const n of live) {
		for (const key of Object.keys(n.props)) {
			const lower = key.toLowerCase();
			if (SYSTEM_KEYS.has(lower) || NOT_SORTING_TYPES.has(cfg.types[key] ?? cfg.types[lower] ?? "")) continue;
			const vs = values(n.props, key);
			if (!vs.length) continue;
			let s = stats.get(lower);
			if (!s) {
				s = {
					key,
					notes: new Set(),
					elements: 0,
					links: 0,
					byTarget: new Map(),
					byValue: new Map(),
					long: 0,
					lens: 0,
				};
				stats.set(lower, s);
			}
			s.notes.add(n.path);
			for (const v of vs) {
				s.elements++;
				if (isLinkText(v)) {
					s.links++;
					continue;
				}
				const text =
					typeof v === "string" ? v.trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
				if (!text) continue;
				s.lens += text.length;
				if (text.length > 40 || text.split(/\s+/).length > 5 || /\n/.test(text)) s.long++;
				const f = fold(text);
				const e = s.byValue.get(f) ?? { spellings: new Map<string, number>(), notes: new Set<string>() };
				e.spellings.set(text, (e.spellings.get(text) ?? 0) + 1);
				e.notes.add(n.path);
				s.byValue.set(f, e);
			}
			for (const t of n.links[lower] ?? []) {
				const set = s.byTarget.get(t) ?? new Set<string>();
				set.add(n.path);
				s.byTarget.set(t, set);
			}
		}
	}
	const kindKeys = new Map<string, Group[]>();
	for (const s of [...stats.values()].sort((a, b) => a.key.localeCompare(b.key))) {
		if (s.notes.size < S) continue;
		// Journal fields (weather, mood) live on date-named notes: not topics (links from them still count).
		const onDated = [...s.notes].filter((p) => DATED.test(basename(p))).length;
		const linky = s.elements > 0 && s.links / s.elements >= 0.8;
		if (!linky && onDated / s.notes.size >= 0.8) {
			notProposed.push({
				what: `values of ${s.key}`,
				why: "set on date-named notes (a journal field), not topics",
			});
			continue;
		}
		if (s.elements && s.links / s.elements >= 0.8) {
			const big = [...s.byTarget.values()].filter((x) => x.size >= 5);
			const covered = new Set(big.flatMap((x) => [...x])).size;
			const spreadThin = covered / s.notes.size < 0.5;
			if (spreadThin)
				notProposed.push({
					what: `values of ${s.key}`,
					why: "each value is on a few notes (like people or sources)",
				});
			const keyGroups: Group[] = [];
			for (const [target, set] of [...s.byTarget].sort(
				(a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]),
			)) {
				if (set.size < (spreadThin ? 10 : LIST)) continue;
				if (spreadThin && keyGroups.length >= 20) break;
				keyGroups.push({
					signal: "link-property",
					at: s.key,
					key: target,
					name: basename(target),
					alias: null,
					aliases: aliasesOf(byPath.get(target)),
					kind: s.key,
					label: `Links in ${s.key}`,
					rules: [{ kind: "property", key: s.key, target }],
					members: new Set(set),
					family: "property",
					target,
					untick: spreadThin ? ["its values are spread thin"] : [],
				});
			}
			stripSharedAffix(keyGroups);
			groups.push(...keyGroups);
			kindKeys.set(`property:${s.key}`, keyGroups);
			continue;
		}
		// Plain values: few, short, repeated; not ids, dates, numbers, URLs or yes/no.
		const vals = [...s.byValue.values()];
		const distinct = vals.length;
		const allText = vals.flatMap((e) => [...e.spellings.keys()]);
		const numeric = allText.filter((t) => /^-?\d+([.,]\d+)?$/.test(t) || /^\d{4}-\d{2}(-\d{2})?/.test(t)).length;
		const urls = allText.filter((t) => /^[a-z]+:\/\//i.test(t)).length;
		const notesWith = s.notes.size;
		const constant = distinct === 1;
		if (
			!distinct ||
			constant ||
			distinct > 50 ||
			distinct / notesWith > 0.5 ||
			s.long / Math.max(1, s.elements) > 0.2 ||
			numeric / allText.length > 0.5 ||
			urls / allText.length >= 0.8 ||
			notesWith / distinct < 3
		)
			continue;
		if (
			distinct === 2 &&
			vals.every((e) => /^(true|false|yes|no|y|n|on|off|0|1)$/i.test([...e.spellings.keys()][0] ?? ""))
		)
			continue;
		const keyGroups: Group[] = [];
		for (const [f, e] of [...s.byValue].sort(
			(a, b) => b[1].notes.size - a[1].notes.size || a[0].localeCompare(b[0]),
		)) {
			if (e.notes.size < LIST) continue;
			const name = [...e.spellings].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? f;
			keyGroups.push({
				signal: "category-property",
				at: s.key,
				key: f,
				name,
				alias: null,
				aliases: [],
				kind: s.key,
				label: `Values of ${s.key}`,
				rules: [{ kind: "property", key: s.key, value: name }],
				members: new Set(e.notes),
				family: "property",
				untick: [],
			});
		}
		groups.push(...keyGroups);
		kindKeys.set(`property:${s.key}`, keyGroups);
	}

	// 3d. Tag hierarchies: a root with ≥ 2 children used on ≥ S(N) notes.
	type TagStat = {
		notes: Set<string>;
		children: Map<string, { spellings: Map<string, number>; notes: Set<string> }>;
		spelling: Map<string, number>;
	};
	const roots = new Map<string, TagStat>();
	for (const n of live) {
		for (const raw of new Set(n.tags)) {
			const t = raw.replace(/^#/, "");
			const parts = t.split("/");
			if (parts.length < 2 || !parts[0] || !parts[1]) continue;
			const root = parts[0].toLowerCase();
			const r = roots.get(root) ?? {
				notes: new Set<string>(),
				children: new Map<string, { spellings: Map<string, number>; notes: Set<string> }>(),
				spelling: new Map<string, number>(),
			};
			r.notes.add(n.path);
			r.spelling.set(parts[0], (r.spelling.get(parts[0]) ?? 0) + 1);
			const child = parts[1].toLowerCase();
			const c = r.children.get(child) ?? { spellings: new Map<string, number>(), notes: new Set<string>() };
			c.notes.add(n.path);
			c.spellings.set(parts[1], (c.spellings.get(parts[1]) ?? 0) + 1);
			r.children.set(child, c);
			roots.set(root, r);
		}
	}
	for (const [root, r] of [...roots].sort((a, b) => a[0].localeCompare(b[0]))) {
		if (r.children.size < 2 || r.notes.size < S) continue;
		const rootName = [...r.spelling].sort((a, b) => b[1] - a[1])[0]?.[0] ?? root;
		const keyGroups: Group[] = [];
		for (const [child, c] of [...r.children].sort(
			(a, b) => b[1].notes.size - a[1].notes.size || a[0].localeCompare(b[0]),
		)) {
			if (c.notes.size < LIST) continue;
			const name = [...c.spellings].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? child;
			keyGroups.push({
				signal: "tag-hierarchy",
				at: `#${root}`,
				key: child,
				name,
				alias: null,
				aliases: [],
				kind: `#${rootName}`,
				label: `Children of #${rootName}`,
				rules: [{ kind: "tag", tag: `#${root}/${child}` }],
				members: new Set(c.notes),
				family: "tag",
				untick: [],
			});
		}
		groups.push(...keyGroups);
		kindKeys.set(`tag:${root}`, keyGroups);
	}

	// 3e. Flat tags never make a scope alone; one with a group's name joins it (agreement).
	const names = new Set(groups.map((g) => compact(g.name)));
	const flat = new Map<string, { spellings: Map<string, number>; notes: Set<string> }>();
	for (const n of live)
		for (const raw of new Set(n.tags)) {
			const t = raw.replace(/^#/, "");
			if (t.includes("/") || !names.has(compact(t))) continue;
			const e = flat.get(t.toLowerCase()) ?? { spellings: new Map<string, number>(), notes: new Set<string>() };
			e.notes.add(n.path);
			e.spellings.set(t, (e.spellings.get(t) ?? 0) + 1);
			flat.set(t.toLowerCase(), e);
		}
	const flatGroups: Group[] = [];
	for (const [tag, e] of [...flat].sort((x, y) => x[0].localeCompare(y[0]))) {
		const name = [...e.spellings].sort((x, y) => y[1] - x[1])[0]?.[0] ?? tag;
		flatGroups.push({
			signal: "flat-tag",
			at: "#",
			key: tag,
			name,
			alias: null,
			aliases: [],
			kind: "",
			label: "Tags",
			rules: [{ kind: "tag", tag: `#${tag}` }],
			members: new Set(e.notes),
			family: "tag",
			untick: [],
		});
	}
	groups.push(...flatGroups);

	// 4. Facet test: values that partition notes and recur across topics are kinds, not topics.
	const topics = groups.filter(
		(g) => g.family === "folder" || g.signal === "link-property" || g.signal === "tag-hierarchy",
	);
	const kinds = new Set<Group>();
	const sets = new Map<string, Group[]>();
	for (const t of topics) {
		const key = t.family === "folder" ? `folder:${t.container ?? ""}` : `${t.signal}:${t.at}`;
		sets.set(key, [...(sets.get(key) ?? []), t]);
	}
	const topicSets = [...sets.values()];
	const folderGroups = groups.filter((g) => g.family === "folder" && g.signal !== "flat-tag");
	const folderNames = new Set(folderGroups.map((g) => compact(g.name)));
	const folderPaths = folderGroups.map((g) => g.folder ?? "").filter(Boolean);
	for (const [id, gs] of kindKeys) {
		// Any number of values: real `type` keys have dozens; the partition and spread tests decide.
		if (gs.length < 2) continue;
		const keyNotes = new Set(gs.flatMap((g) => [...g.members]));
		const count = new Map<string, number>();
		for (const g of gs) for (const p of g.members) count.set(p, (count.get(p) ?? 0) + 1);
		const single = [...count.values()].filter((c) => c === 1).length;
		if (single / keyNotes.size < 0.9) continue;
		if (gs.length === 2) {
			for (const g of gs) kinds.add(g);
			notProposed.push({
				what: id.replace(/^property:/, "values of ").replace(/^tag:/, "children of #"),
				why: "two values that split notes in two: a state, not a topic",
			});
			continue;
		}
		// Values that agree with folders (same names, or links to notes in them) are the topics themselves.
		const agreeing = gs.filter(
			(g) =>
				folderNames.has(compact(g.name)) ||
				(g.target !== undefined && folderPaths.some((f) => under(g.target as string, f))),
		).length;
		if (agreeing / gs.length >= 0.5) continue;
		// Judged within one set of sibling topics at a time (a container's children, one link key's
		// targets, one tag root's children): big parent folders and tiny nested ones must not blur it.
		const isKind = topicSets.some((set) => {
			const others = set.filter((t) => !gs.includes(t));
			const touching = others.filter((t) => [...t.members].some((p) => keyNotes.has(p)));
			const covered = new Set(touching.flatMap((t) => [...t.members].filter((p) => keyNotes.has(p)))).size;
			if (touching.length < 3 || covered / keyNotes.size < 0.3) return false;
			// Spread: a value's notes sit in ≥ 3 of these topics, none holding half of them (weighted by notes).
			const spread = gs.filter((g) => {
				const shares = touching
					.map((t) => [...g.members].filter((p) => t.members.has(p)).length)
					.filter((x) => x > 0);
				return shares.length >= 3 && Math.max(...shares) < g.members.size / 2;
			});
			const spreadNotes = spread.reduce((n, g) => n + g.members.size, 0);
			const totalNotes = gs.reduce((n, g) => n + g.members.size, 0);
			// Or: each topic holds 3 or more of its values (a kind recurs inside every topic).
			const per = touching
				.map((t) => gs.filter((g) => [...g.members].some((p) => t.members.has(p))).length)
				.sort((a, b) => a - b);
			const median = per[Math.floor(per.length / 2)] ?? 0;
			return spreadNotes / totalNotes >= 0.6 || median >= 3;
		});
		if (!isKind) continue;
		for (const g of gs) kinds.add(g);
		notProposed.push({
			what: id.replace(/^property:/, "values of ").replace(/^tag:/, "children of #"),
			why: "kinds of notes (they recur across your topics), not topics",
		});
	}
	const candidates = groups.filter((g) => !kinds.has(g));

	// 5. Merge where signals agree (union-find), never two of one origin, never two folders.
	const parent = candidates.map((_, i) => i);
	const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i] as number)));
	const comp = new Map<number, { origins: Set<string>; folders: number }>(
		candidates.map((g, i) => [
			i,
			{ origins: new Set([`${g.signal}|${g.at}`]), folders: g.family === "folder" ? 1 : 0 },
		]),
	);
	const join = (a: number, b: number): void => {
		const ra = find(a);
		const rb = find(b);
		if (ra === rb) return;
		const ca = comp.get(ra);
		const cb = comp.get(rb);
		if (!ca || !cb) return;
		if ([...ca.origins].some((o) => cb.origins.has(o)) || ca.folders + cb.folders > 1) return;
		parent[rb] = ra;
		comp.set(ra, { origins: new Set([...ca.origins, ...cb.origins]), folders: ca.folders + cb.folders });
	};
	const folderNote = new Map<string, string>();
	for (const g of candidates)
		if (g.folder) {
			const own = fold(g.name);
			const fn = live.find(
				(n) => parentOf(n.path) === g.folder && fold(stripName(basename(n.path), false).name) === own,
			);
			if (fn) folderNote.set(g.folder, fn.path);
		}
	const byName = new Map<string, number[]>();
	candidates.forEach((g, i) => {
		if (g.untick.includes("in an archive")) return;
		const k = compact(g.name);
		byName.set(k, [...(byName.get(k) ?? []), i]);
	});
	for (const idx of byName.values())
		for (let x = 0; x < idx.length; x++)
			for (let y = x + 1; y < idx.length; y++) {
				const a = candidates[idx[x] as number] as Group;
				const b = candidates[idx[y] as number] as Group;
				if (a.family !== b.family) join(idx[x] as number, idx[y] as number);
			}
	// Two link keys that point to the same note (topics: [[X]], up: [[X]]) are one group.
	const byTarget = new Map<string, number[]>();
	candidates.forEach((g, i) => {
		if (g.target) byTarget.set(g.target, [...(byTarget.get(g.target) ?? []), i]);
	});
	for (const idx of byTarget.values()) for (let x = 1; x < idx.length; x++) join(idx[0] as number, idx[x] as number);
	// A link joins a folder when it points to the folder's own note, or into the closest folder group
	// that also holds most of the notes carrying the link (a map in Atlas/Maps is not "Maps").
	candidates.forEach((a, i) => {
		const t = a.target;
		if (!t) return;
		let closest = -1;
		candidates.forEach((b, j) => {
			if (!b.folder || a === b || !under(t, b.folder)) return;
			if (folderNote.get(b.folder) === t) {
				join(i, j);
				closest = -2;
			} else if (
				closest !== -2 &&
				(closest < 0 || b.folder.length > ((candidates[closest] as Group).folder?.length ?? 0))
			)
				closest = j;
		});
		if (closest < 0) return;
		const b = candidates[closest] as Group;
		const inside = [...a.members].filter((p) => b.members.has(p)).length;
		if (inside / a.members.size >= 0.5) join(i, closest);
	});
	const merged = new Map<number, Group[]>();
	candidates.forEach((g, i) => merged.set(find(i), [...(merged.get(find(i)) ?? []), g]));
	for (const [k, gs] of merged) if (gs.every((g) => g.signal === "flat-tag")) merged.delete(k);

	// 6. Levels: the container whose children agree with another signal, else a numbered system, else the shallowest.
	const agreeing = new Set<string>();
	for (const c of containers) {
		const kids = candidates.filter((g) => g.container === c && g.signal === "container-folder");
		if (!kids.length) continue;
		const agreed = kids.filter((g) =>
			(merged.get(find(candidates.indexOf(g))) ?? []).some(
				(x) => x.family !== "folder" && x.signal !== "flat-tag",
			),
		);
		if (agreed.length / kids.length >= 0.5) agreeing.add(c);
	}
	// Per branch, top-down: a container whose children agree is primary; one with agreement below it
	// defers to that level; otherwise the shallowest container on the branch is; all below a primary one are not.
	const isContainer = new Set(containers);
	const containerParent = (c: string): string | null => {
		for (let d = c === "" ? null : parentOf(c); d !== null; d = d === "" ? null : parentOf(d))
			if (isContainer.has(d)) return d;
		return null;
	};
	const agreeBelow = (c: string): boolean => [...agreeing].some((a) => a !== c && under(a, c));
	const primaryOf = new Map<string, boolean>();
	const decide = (c: string): boolean => {
		const known = primaryOf.get(c);
		if (known !== undefined) return known;
		const up = containerParent(c);
		let above = false;
		for (let a = up; a !== null; a = containerParent(a)) if (decide(a)) above = true;
		const result = agreeing.has(c) ? !above || !agreeing.has(up ?? "\u0000") : !above && !agreeBelow(c);
		primaryOf.set(c, result);
		return result;
	};
	const primary = (c: string): boolean => decide(c);

	// Name, count, default.
	const proposals: Proposal[] = [];
	for (const gs of merged.values()) {
		const rules: Rule[] = [];
		for (const g of gs)
			for (const r of g.rules) if (!rules.some((x) => JSON.stringify(x) === JSON.stringify(r))) rules.push(r);
		const folderG = gs.find((g) => g.family === "folder");
		// Several link keys to one note: the name with its shared affix stripped ("Cooking", not "Cooking MOC").
		const linkG = gs
			.filter((g) => g.signal === "link-property")
			.sort((x, y) => x.name.length - y.name.length || x.name.localeCompare(y.name))[0];
		const valueG = gs.find((g) => g.signal === "category-property");
		const tagG = gs.find((g) => g.family === "tag");
		const head = folderG ?? linkG ?? valueG ?? tagG ?? gs[0];
		if (!head) continue;
		const note = folderG?.folder ? folderNote.get(folderG.folder) : undefined;
		const name = note ? basename(note) : head.name;
		const aliasList = [
			...gs.map((g) => g.alias).filter((a): a is string => !!a),
			...gs.flatMap((g) => g.aliases),
			...aliasesOf(note ? byPath.get(note) : undefined),
		];
		const aliases = [...new Map(aliasList.filter((a) => fold(a) !== fold(name)).map((a) => [fold(a), a])).values()];
		const counted = rules.map((rule) => ({ rule, count: live.filter((n) => matches(rule, n)).length }));
		const members = live.filter((n) => rules.some((r) => matches(r, n))).length;
		if (!members) continue;
		const untick = [...new Set(gs.flatMap((g) => g.untick))];
		if (members < TICK) untick.push(`only ${members} note${members === 1 ? "" : "s"}`);
		if (folderG?.signal === "container-folder" && folderG.container !== undefined && !primary(folderG.container))
			untick.push("a level below or above the main one");
		if (/^[\p{N}\p{P}\p{S}\s]+$/u.test(name)) untick.push("the name is only a number or a symbol");
		if (name.length > 60) untick.push("a long name");
		const origins = [head, ...gs.filter((g) => g !== head)].map((g) => ({
			signal: g.signal,
			at: g.at,
			key: g.key,
			v: V,
		}));
		proposals.push({
			id: scopeId(name, rules),
			name,
			aliases,
			kind: head.kind,
			group: head.label,
			rules: counted,
			members,
			ticked: untick.length === 0,
			untick,
			origins,
		});
	}
	const order = ["johnny-decimal", "container-folder", "link-property", "category-property", "tag-hierarchy"];
	proposals.sort(
		(a, b) =>
			order.indexOf(a.origins[0]?.signal ?? "") - order.indexOf(b.origins[0]?.signal ?? "") ||
			a.group.localeCompare(b.group) ||
			b.members - a.members ||
			a.name.localeCompare(b.name),
	);
	return { proposals, notProposed, notes: N };
};

/**
 * A token most names in one group share ("Cooking MOC", "Music Theory MOC"): stripped from the names
 * and kept as an alias, when ≥ 3 names and ≥ 60% of them share it (found by counting, not from a list).
 */
const stripSharedAffix = (gs: Group[]): void => {
	if (gs.length < 3) return;
	for (const end of ["first", "last"] as const) {
		const count = new Map<string, number>();
		for (const g of gs) {
			const words = g.name.split(/\s+/);
			if (words.length < 2) continue;
			const w = fold(end === "first" ? (words[0] as string) : (words[words.length - 1] as string));
			count.set(w, (count.get(w) ?? 0) + 1);
		}
		const [token, n] = [...count].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
		if (!token || n / gs.length < 0.6) continue;
		for (const g of gs) {
			const words = g.name.split(/\s+/);
			if (words.length < 2) continue;
			const at = end === "first" ? 0 : words.length - 1;
			if (fold(words[at] as string) !== token) continue;
			g.aliases = [...g.aliases, g.name];
			g.name = words.filter((_, k) => k !== at).join(" ");
		}
		return;
	}
};
