/**
 * The Scopes page of Jet's settings (option C): one row in
 * Jet's tab opens it; it holds "Find scopes" (Generate), "When new ones appear", and the list of
 * scopes, each a page of its own (name, aliases, mode, rules, combine, delete). Declared with
 * Obsidian 1.13's settings definitions, so its search finds scopes by name.
 */
import {
	type App,
	Menu,
	type Setting,
	type SettingDefinition,
	type SettingDefinitionItem,
	type SettingDefinitionPage,
	type SettingGroupItem,
	type SettingPage,
} from "obsidian";
import { closeSettingPage } from "../internals";
import { autoOffer } from "../scopes/auto";
import { type Mode, type Rule, type Scope, scopeId } from "../scopes/model";
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
	/** Open the Generate review (first time) or the review of what is new; false when it cannot from a button. */
	generate(): boolean;
	/** The Generate page itself (for a navigable row when a button cannot open it). */
	generatePage(): SettingPage;
	/** Whether a button can open a settings page (Obsidian's internal openPage). */
	canOpenPages(): boolean;
	/** How many new scopes Jet has noticed since the last generation. */
	newCount(): number;
};

export const SCOPES_INTRO =
	"Type a scope's name or alias at the start of a search, then ⇥ to search only its notes. " +
	"A note is in a scope when any of its rules matches; a link counts by the note it opens.";

export const MODE_LABEL: Record<Mode, string> = { suggest: "Suggest", auto: "Auto", "in-only": "in: only" };

/** "18 scopes · 2 on Auto", "18 scopes · 2 new", or "None yet". */
export const scopesSummary = (h: ScopesHost): string => {
	const all = h.scopes();
	if (!all.length) return "None yet";
	const fresh = h.newCount();
	const auto = all.filter((s) => s.mode === "auto").length;
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

const scopeDesc = (h: ScopesHost, s: Scope): string => {
	const n = h.count(s.id);
	const rules = s.rules.length ? s.rules.map(ruleText).join(" · ") : "No rules yet";
	return n === null ? rules : `${rules} · ${plural(n)}`;
};

/** The row in Jet's tab, and everything below it. */
export const scopesPage = (h: ScopesHost): SettingDefinitionPage => {
	const all = h.scopes();
	const generatedBefore = all.some((s) => s.source === "generated");
	const fresh = h.newCount();
	const findName = generatedBefore ? "Find new scopes" : "Find scopes in your vault";
	const findDesc = generatedBefore
		? fresh
			? `${fresh} new since you last generated.`
			: "Looks at your folders, properties and tags again; shows only what is new or changed."
		: "Looks at your folders, properties and tags for groups of notes, and proposes a scope for each. " +
			"Run it again at any time: it shows only what is new or changed.";
	const findPage: SettingDefinitionPage = {
		type: "page",
		name: findName,
		desc: findDesc,
		page: () => h.generatePage(),
	};
	const find: SettingDefinition = {
		name: findName,
		desc: generatedBefore
			? fresh
				? `${fresh} new since you last generated.`
				: "Looks at your folders, properties and tags again; shows only what is new or changed."
			: "Looks at your folders, properties and tags for groups of notes, and proposes a scope for each. " +
				"Run it again at any time: it shows only what is new or changed.",
		aliases: ["generate", "scopes"],
		render: (row) => {
			row.addButton((b) =>
				b
					.setButtonText(fresh ? `Review ${fresh} new…` : generatedBefore ? "Find new…" : "Generate…")
					.setCta()
					.onClick(() => h.generate()),
			);
		},
	};
	const whenNew: SettingDefinition = {
		name: "When new ones appear",
		desc: "Jet checks after changes in your vault (a new folder that fits a pattern, a new property value).",
		control: {
			type: "dropdown",
			key: "scopesWhenNew",
			options: { tell: "Tell me", add: "Add them", nothing: "Do nothing" },
		},
	};
	return {
		type: "page",
		name: "Scopes",
		desc: SCOPES_INTRO,
		displayValue: () => scopesSummary(h),
		items: [
			{ type: "group", items: [h.canOpenPages() ? find : findPage, whenNew] },
			{
				type: "list",
				items: all.map((s) => scopePage(h, s)),
				emptyState: "No scopes yet. Generate them, or + to add one by hand.",
				addItem: { name: "Add scope", action: () => addScope(h) },
				search: {
					placeholder: "Search scopes...",
					match: (def, q) => def.name.toLowerCase().includes(q.trim().toLowerCase()),
				},
			},
		],
	};
};

const addScope = (h: ScopesHost): void => {
	const all = h.scopes();
	let name = "New scope";
	for (let n = 2; all.some((s) => s.name === name); n++) name = `New scope ${n}`;
	all.push({
		id: scopeId(name, []),
		name,
		aliases: [],
		kind: "",
		rules: [],
		combine: "any",
		mode: "suggest",
		source: "manual",
	});
	h.save();
	h.changed();
};

/** A text box that saves when it loses focus (saving while typing would redraw the page under the caret). */
const textOnBlur = (row: Setting, value: string, save: (v: string) => void): void => {
	row.addText((t) => {
		t.setValue(value);
		t.inputEl.addEventListener("blur", () => save(t.getValue()));
	});
};

/**
 * "When typed": Auto is offered only for a name rarely written
 * outside the scope, or, for a name with capitals inside it, only as written; the page says why.
 */
export const whenTyped = (h: ScopesHost, s: Scope): SettingDefinition => {
	const m = h.mentions(s.id);
	const offer = autoOffer(s.name, m ? m.value : null);
	const why = !m
		? `Checking how often “${s.name}” is written outside it…`
		: `“${s.name}” is written in ${plural(m.outside)} outside it (${m.value.toFixed(1)} per note in it): ` +
			(offer === "any"
				? "Auto is safe."
				: offer === "case"
					? `Auto applies only when typed as “${s.name}”.`
					: "too common for Auto, so it stays Suggest.");
	const options: Record<string, string> = { suggest: "Suggest" };
	if (offer !== "no" || s.mode === "auto") options.auto = offer === "case" ? `Auto (as “${s.name}”)` : "Auto";
	options["in-only"] = "in: only";
	return {
		name: "When typed",
		desc: `Suggest: ⇥ accepts. Auto: applied at once. in: only: only in:${s.name} or @${s.name}. ${why}`,
		control: { type: "dropdown", key: `scope:${s.id}:mode`, options },
	};
};

/** A scope's own page: its row in the list opens it. */
const scopePage = (h: ScopesHost, s: Scope): SettingDefinitionPage => {
	const n = h.count(s.id);
	const identity: SettingDefinition[] = [
		{
			name: "Name",
			desc: "The chip's label, and the word that starts the scope.",
			render: (row) =>
				textOnBlur(row, s.name, (v) => {
					const name = v.trim();
					if (!name || name === s.name) return;
					s.name = name;
					h.save();
					h.changed();
				}),
		},
		{
			name: "Aliases",
			desc: "More words that start it, separated by commas.",
			render: (row) =>
				textOnBlur(row, s.aliases.join(", "), (v) => {
					const aliases = v
						.split(",")
						.map((a) => a.trim())
						.filter(Boolean);
					if (aliases.join(",") === s.aliases.join(",")) return;
					s.aliases = aliases;
					h.save();
					h.changed();
				}),
		},
		whenTyped(h, s),
	];
	const rules: SettingGroupItem[] = s.rules.map((r) => ({ name: ruleText(r), desc: ruleDesc(r, h.ruleCount(r)) }));
	const rest: SettingDefinition[] = [
		{
			name: "Combine rules",
			desc: "Any: a note in any rule. All: only notes in every rule.",
			control: { type: "dropdown", key: `scope:${s.id}:combine`, options: { any: "Any rule", all: "All rules" } },
		},
		{
			name: "Notes in this scope",
			desc:
				(n === null ? "" : `${plural(n)}. `) +
				(s.source === "generated"
					? "Generated; your edits are kept when you generate again."
					: "Added by hand."),
		},
		{
			name: "Delete this scope",
			render: (row) => {
				row.addButton((b) => {
					b.buttonEl.addClass("mod-warning");
					b.setButtonText("Delete").onClick(() => {
						const all = h.scopes();
						const i = all.indexOf(s);
						if (i >= 0) all.splice(i, 1);
						h.save();
						closeSettingPage(h.app);
						h.changed();
					});
				});
			},
		},
	];
	const items: SettingDefinitionItem[] = [
		{ type: "group", items: identity },
		{
			type: "list",
			heading: "Matches",
			items: rules,
			emptyState: "No rules yet: this scope has no notes.",
			onDelete: (i) => {
				s.rules.splice(i, 1);
				h.save();
				h.changed();
			},
			addItem: { name: "Add rule", action: (el) => ruleMenu(h, s, el) },
		},
		{ type: "group", items: rest },
	];
	return {
		type: "page",
		name: s.name,
		desc: scopeDesc(h, s),
		displayValue: MODE_LABEL[s.mode],
		items,
	};
};

const ruleDesc = (r: Rule, n: number | null): string => {
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

const ruleMenu = (h: ScopesHost, s: Scope, el: HTMLElement): void => {
	const add = (r: Rule | null): void => {
		if (!r) return;
		s.rules.push(r);
		h.save();
		h.changed();
	};
	const menu = new Menu();
	menu.addItem((i) =>
		i
			.setTitle("Folder…")
			.setIcon("folder")
			.onClick(() => pickFolder(h.app, add)),
	);
	menu.addItem((i) =>
		i
			.setTitle("Property value…")
			.setIcon("link")
			.onClick(() => pickProperty(h.app, add)),
	);
	menu.addItem((i) =>
		i
			.setTitle("Tag…")
			.setIcon("hash")
			.onClick(() => pickTag(h.app, add)),
	);
	const r = el.getBoundingClientRect();
	menu.showAtPosition({ x: r.left, y: r.bottom });
};
