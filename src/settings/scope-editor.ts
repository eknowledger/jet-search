/**
 * Editing one scope: its name, aliases, how it applies when typed, its
 * rules and how they combine. On Obsidian 1.13+ it is a settings page that saves each change, as
 * Obsidian's own pages do; before 1.13 (no pages) it is a dialog with Save, Cancel and Delete.
 * One renderer draws both.
 */
import * as obsidian from "obsidian";
import { Modal, type SettingPage, setIcon } from "obsidian";
import { closeSettingPage, openSettingPage } from "../internals";
import type { Rule, Scope } from "../scopes/model";
import { ruleDesc, ruleMenu, ruleText, type ScopesHost, whenTyped } from "./scopes-page";

const plural = (n: number): string => `${n.toLocaleString()} note${n === 1 ? "" : "s"}`;

/** One row as Obsidian draws a setting: its name and description, then its control. */
export const settingRow = (parent: HTMLElement, name: string, desc = ""): HTMLElement => {
	const row = parent.createDiv({ cls: "setting-item" });
	const info = row.createDiv({ cls: "setting-item-info" });
	info.createDiv({ cls: "setting-item-name", text: name });
	if (desc) info.createDiv({ cls: "setting-item-description", text: desc });
	return row.createDiv({ cls: "setting-item-control" });
};

/** A text box that keeps what you typed when it loses focus or on ↵ (saving while typing would redraw under the caret). */
const textBox = (el: HTMLElement, value: string, set: (v: string) => void): HTMLInputElement => {
	const t = el.createEl("input", { attr: { type: "text" } });
	t.value = value;
	t.addEventListener("blur", () => set(t.value));
	t.addEventListener("keydown", (e) => {
		if (e.key === "Enter") t.blur();
	});
	return t;
};

/**
 * Draw the editor for `s` into `el`. `changed` runs after each edit (the page saves; the dialog only
 * redraws its copy). Counts come from the scope as saved.
 */
export const drawScopeEditor = (el: HTMLElement, h: ScopesHost, s: Scope, changed: () => void): void => {
	el.empty();
	el.addClass("jet-sed");
	const redraw = (): void => {
		changed();
		drawScopeEditor(el, h, s, changed);
	};
	textBox(settingRow(el, "Name", "The chip's label, and the word that starts the scope."), s.name, (v) => {
		const name = v.trim();
		if (!name || name === s.name) return;
		s.name = name;
		redraw();
	});
	textBox(settingRow(el, "Aliases", "More words that start it, separated by commas."), s.aliases.join(", "), (v) => {
		const aliases = v
			.split(",")
			.map((a) => a.trim())
			.filter(Boolean);
		if (aliases.join(",") === s.aliases.join(",")) return;
		s.aliases = aliases;
		redraw();
	});
	const typed = whenTyped(h, s);
	const sel = settingRow(el, typed.name, typed.desc).createEl("select", { cls: "dropdown" });
	for (const [v, label] of Object.entries(typed.control.options))
		sel.createEl("option", { text: label, attr: { value: v } });
	sel.value = s.mode;
	sel.addEventListener("change", () => {
		const v = sel.value;
		if (v === "default" || v === "suggest" || v === "auto" || v === "in-only") s.mode = v;
		redraw();
	});
	// The rules, each with its count and ×; "Add rule" offers a folder, a property value or a tag.
	const rules = el.createDiv({ cls: "jet-sed-rules" });
	const head = settingRow(rules, "Matches", s.rules.length ? "" : "No rules yet: this scope has no notes.");
	const add = head.createEl("button", { text: "Add rule" });
	add.addEventListener("click", () =>
		ruleMenu(h.app, add, (r: Rule) => {
			s.rules.push(r);
			redraw();
		}),
	);
	s.rules.forEach((r, i) => {
		const c = settingRow(rules, ruleText(r), ruleDesc(r, h.ruleCount(r)));
		const x = c.createEl("button", { cls: "clickable-icon", attr: { "aria-label": `Remove ${ruleText(r)}` } });
		setIcon(x, "x");
		x.addEventListener("click", () => {
			s.rules.splice(i, 1);
			redraw();
		});
	});
	const comb = settingRow(el, "Combine rules", "Any: a note in any rule. All: only notes in every rule.").createEl(
		"select",
		{ cls: "dropdown" },
	);
	comb.createEl("option", { text: "Any rule", attr: { value: "any" } });
	comb.createEl("option", { text: "All rules", attr: { value: "all" } });
	comb.value = s.combine;
	comb.addEventListener("change", () => {
		s.combine = comb.value === "all" ? "all" : "any";
		redraw();
	});
	const n = h.count(s.id);
	settingRow(
		el,
		"Notes in this scope",
		(n === null ? "" : `${plural(n)}. `) +
			(s.source === "generated" ? "Generated; your edits are kept when you generate again." : "Added by hand."),
	);
};

/** Delete a scope from the list. */
const remove = (h: ScopesHost, s: Scope): void => {
	const all = h.scopes();
	const i = all.indexOf(s);
	if (i >= 0) all.splice(i, 1);
	h.save();
	h.changed();
};

/** What a settings page is to Jet; Obsidian's `SettingPage` (1.13+) provides it. */
type PageBase = { containerEl: HTMLElement; title: string; display(): void };

/** Open the editor: a page on Obsidian 1.13+, a dialog before. */
export const openScopeEditor = (h: ScopesHost, s: Scope): void => {
	const Base = (obsidian as unknown as { SettingPage?: new () => PageBase }).SettingPage;
	if (Base && h.canOpenPages()) {
		const Page = class extends Base {
			constructor() {
				super();
				this.title = s.name;
			}
			display(): void {
				const save = (): void => {
					h.save();
					h.changed();
					this.title = s.name;
				};
				this.containerEl.empty();
				drawScopeEditor(this.containerEl.createDiv(), h, s, save);
				const del = settingRow(this.containerEl, "Delete this scope").createEl("button", {
					cls: "mod-warning",
					text: "Delete",
				});
				del.addEventListener("click", () => {
					remove(h, s);
					closeSettingPage(h.app);
				});
			}
		};
		if (openSettingPage(h.app, new Page() as unknown as SettingPage)) return;
	}
	new ScopeEditModal(h, s).open();
};

/** Before Obsidian 1.13: a copy is edited; Save writes it, Cancel leaves the scope as it was. */
export class ScopeEditModal extends Modal {
	private readonly draft: Scope;

	constructor(
		private readonly h: ScopesHost,
		private readonly target: Scope,
	) {
		super(h.app);
		this.draft = structuredClone(target);
	}

	onOpen(): void {
		this.modalEl.addClass("jet-sed-modal");
		this.draw();
	}

	private draw(): void {
		this.titleEl.setText(`Edit scope · ${this.draft.name}`);
		const body = this.contentEl;
		body.empty();
		drawScopeEditor(body.createDiv(), this.h, this.draft, () =>
			this.titleEl.setText(`Edit scope · ${this.draft.name}`),
		);
		const btns = body.createDiv({ cls: "modal-button-container" });
		btns.createEl("button", { cls: "mod-warning", text: "Delete scope" }).addEventListener("click", () => {
			remove(this.h, this.target);
			this.close();
		});
		btns.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		btns.createEl("button", { cls: "mod-cta", text: "Save" }).addEventListener("click", () => this.save());
	}

	/** The copy becomes the scope (same object, so the list and the keeper see the change). */
	save(): void {
		Object.assign(this.target, structuredClone(this.draft));
		this.h.save();
		this.h.changed();
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
