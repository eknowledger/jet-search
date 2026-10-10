/**
 * What the Scopes tab of Jet's settings shares: the host it needs, the words for
 * modes, rules and counts, adding a scope by hand and the "Add rule" menu. The tab draws the list; one
 * scope is edited in `scope-editor.ts`.
 */
import { type App, Menu } from "obsidian";
import { autoRisk } from "../scopes/auto";
import { type Mode, modeOf, type OwnMode, type Rule, type Scope, scopeId } from "../scopes/model";
import { pickFolder, pickProperty, pickTag } from "./rule-pickers";

/** What the page needs from the plugin. */
export type ScopesHost = {
	app: App;
	/** The live list (edits change it in place). */
	scopes(): Scope[];
	save(): void;
	/** Note counts, or null when they are not worked out (the tab is not on screen). */
	count(id: string): number | null;
	ruleCount(rule: Rule): number | null;
	/** How often the name is written outside the scope, or null until measured (asks for it). */
	mentions(id: string): { value: number; outside: number } | null;
	/** The scopes changed: members again, and the page drawn again. */
	changed(): void;
	/** Open the Generate review (first time) or the review of what is new: a page, or a dialog before 1.13. */
	generate(): void;
	/** Whether a button can open a settings page (Obsidian's internal openPage, 1.13+). */
	canOpenPages(): boolean;
	/** How many new scopes Jet has noticed since the last generation. */
	newCount(): number;
	/** The mode every scope follows unless it chose its own. */
	everyMode(): OwnMode;
};

export const SCOPES_INTRO =
	"Type a scope's name or alias at the start of a search, then ⇥ to search only its notes. " +
	"A note is in a scope when any of its rules matches; a link counts by the note it opens.";

export const MODE_LABEL: Record<Mode, string> = {
	default: "Like every scope",
	suggest: "Suggest",
	auto: "Auto",
	"in-only": "in: only",
};

/** "18 scopes · 2 on Auto", "18 scopes · 2 new", or "None yet". */
export const scopesSummary = (h: ScopesHost): string => {
	const all = h.scopes();
	if (!all.length) return "None yet";
	const fresh = h.newCount();
	const auto = all.filter((s) => modeOf(s, h.everyMode()) === "auto").length;
	const tail = fresh ? ` · ${fresh} new` : auto ? ` · ${auto} on Auto` : "";
	return `${all.length} scope${all.length === 1 ? "" : "s"}${tail}`;
};

/** One rule in words: "folder 2.Projects/Cobalt", "project → Cobalt", "category = Recipe", "#client/acme". */
export const ruleText = (r: Rule): string => {
	switch (r.kind) {
		case "folder":
			return `folder ${r.path}`;
		case "tag":
			return r.tag;
		case "property":
			return "target" in r
				? `${r.key} → ${(r.target.split("/").pop() ?? r.target).replace(/\.md$/i, "")}`
				: `${r.key} = ${r.value}`;
	}
};

const plural = (n: number): string => `${n.toLocaleString()} note${n === 1 ? "" : "s"}`;

/** A scope in a line: its rules, and its notes when counted. */
export const scopeDesc = (h: ScopesHost, s: Scope): string => {
	const n = h.count(s.id);
	const rules = s.rules.length ? s.rules.map(ruleText).join(" · ") : "No rules yet";
	return n === null ? rules : `${rules} · ${plural(n)}`;
};

/** A new scope, by hand ("New scope", "New scope 2"…), with a unique id; returns it. */
export const addScope = (h: ScopesHost): Scope => {
	const all = h.scopes();
	let name = "New scope";
	for (let n = 2; all.some((s) => s.name === name); n++) name = `New scope ${n}`;
	// Unique among the ids there are (a scope renamed from "New scope" keeps its old id).
	let id = scopeId(name, []);
	for (let n = 2; all.some((s) => s.id === id); n++) id = `${scopeId(name, [])}-${n}`;
	const s: Scope = {
		id,
		name,
		aliases: [],
		kind: "",
		rules: [],
		combine: "any",
		mode: "default",
		source: "manual",
	};
	all.push(s);
	h.save();
	h.changed();
	return s;
};

/**
 * "When typed": Auto is offered only for a name rarely written
 * outside the scope, or, for a name with capitals inside it, only as written; the page says why.
 */
/** "When typed" for one scope: its name, what it says, and the modes offered. */
export type WhenTyped = {
	name: string;
	desc: string;
	control: { type: "dropdown"; key: string; options: Record<string, string> };
};

export const whenTyped = (h: Pick<ScopesHost, "mentions" | "everyMode">, s: Scope): WhenTyped => {
	const m = h.mentions(s.id);
	const risk = autoRisk(m ? m.value : null);
	const why = !m
		? `Checking how often “${s.name}” is written outside it…`
		: risk === "common"
			? `Careful with Auto: “${s.name}” is written in ${plural(m.outside)} outside it, so ordinary searches with that word would be scoped.`
			: `“${s.name}” is rare outside it (${plural(m.outside)}): Auto is safe.`;
	const options: Record<string, string> = {
		default: `Like every scope (${MODE_LABEL[h.everyMode()]})`,
		suggest: "Suggest",
		auto: "Auto",
		"in-only": "in: only",
	};
	return {
		name: "When typed",
		desc:
			`Suggest: ⇥ accepts. Auto: applied as soon as the name or an alias is followed by a space, in any casing (⌫ right after undoes it). ` +
			`in: only: only in:${s.name} or @${s.name}. ${why}`,
		control: { type: "dropdown", key: `scope:${s.id}:mode`, options },
	};
};

/** Under a rule: what it covers, and its count. */
export const ruleDesc = (r: Rule, n: number | null): string => {
	const what =
		r.kind === "folder"
			? "With its subfolders"
			: r.kind === "tag"
				? "And its nested tags"
				: "target" in r
					? "Any spelling of the link that opens the same note"
					: "Any case";
	return n === null ? what : `${what} · ${plural(n)}`;
};

/** "Add rule": a folder, a property value or a tag, picked from the vault. */
export const ruleMenu = (app: App, el: HTMLElement, onPick: (r: Rule) => void): void => {
	const add = (r: Rule | null): void => {
		if (r) onPick(r);
	};
	const menu = new Menu();
	menu.addItem((i) =>
		i
			.setTitle("Folder…")
			.setIcon("folder")
			.onClick(() => pickFolder(app, add)),
	);
	menu.addItem((i) =>
		i
			.setTitle("Property value…")
			.setIcon("link")
			.onClick(() => pickProperty(app, add)),
	);
	menu.addItem((i) =>
		i
			.setTitle("Tag…")
			.setIcon("hash")
			.onClick(() => pickTag(app, add)),
	);
	const r = el.getBoundingClientRect();
	menu.showAtPosition({ x: r.left, y: r.bottom });
};
