import {
	type App,
	Notice,
	PluginSettingTab,
	requireApiVersion,
	Setting,
	type SettingDefinition,
	type SettingDefinitionItem,
	type SettingDefinitionPage,
	type SettingPage,
} from "obsidian";
import { BUILD_ID } from "./build-id";
import { openSettingPage } from "./internals";
import { obsidianSnapshot } from "./scopes/snapshot-obsidian";
import { STEM_LANGUAGES } from "./engine/stem";
import { clearIndex, rebuild, statusNow } from "./index-status";
import { createGeneratePage } from "./settings/generate-page";
import { pickFolder } from "./settings/rule-pickers";
import { type ScopesHost, scopesPage } from "./settings/scopes-page";
import type JetSearchPlugin from "./main";

const LANGUAGE_NAMES: Record<string, string> = {
	en: "English",
	fr: "French",
	de: "German (and its compound words)",
	es: "Spanish",
	it: "Italian",
	pt: "Portuguese",
	nl: "Dutch (and compounds)",
	sv: "Swedish (and compounds)",
	ar: "Arabic",
};

/** Control keys of the word-forms toggles: `stem:<language>`. */
const STEM = "stem:";

/**
 * Jet's settings tab: how Jet opens, what it shows, what it indexes, and the index.
 * Declared once (`getSettingDefinitions`), so Obsidian 1.13+ draws it and finds it in its settings
 * search; older apps draw the same definitions through `display()`.
 */
export class JetSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly owner: JetSearchPlugin,
	) {
		super(app, owner);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: "group",
				heading: "Open",
				items: [
					{
						name: "Open with a double tap of ⇧",
						desc: "Two quick taps of ⇧. Off when another plugin already handles a double tap of ⇧.",
						aliases: ["Shift-Shift", "double shift", "shortcut", "hotkey"],
						control: { type: "toggle", key: "doubleShift" },
					},
					{
						name: "Double tap window",
						desc: "The two taps must come within this time.",
						aliases: ["Shift-Shift"],
						control: {
							type: "dropdown",
							key: "shiftInterval",
							options: { "250": "250 ms", "350": "350 ms", "500": "500 ms" },
						},
					},
					{
						name: "Open in a new tab",
						desc: "↵ opens results in a new tab, and ⌘↵ in the same tab.",
						control: { type: "toggle", key: "newTab" },
					},
				],
			},
			// Scopes: one row, opening the Scopes page (option C).
			{ type: "group", items: [scopesPage(this.scopesHost())] },
			{
				type: "group",
				heading: "Results",
				items: [
					{
						name: "Show excerpts",
						desc: "A line around the best hit under each result found in the text.",
						aliases: ["snippet"],
						control: { type: "toggle", key: "excerpts" },
					},
					{
						name: "Show the preview",
						desc: "The selected note, shown next to the results.",
						control: { type: "toggle", key: "preview" },
					},
				],
			},
			{
				type: "group",
				heading: "Word forms",
				items: STEM_LANGUAGES.map((lang) => ({
					name: LANGUAGE_NAMES[lang] ?? lang,
					desc: lang === "en" ? "Running finds run; meetings finds meeting." : "",
					aliases: ["stemming", "language", "plural"],
					control: { type: "toggle", key: `${STEM}${lang}` },
				})),
			},
			{
				type: "group",
				heading: "Index",
				items: [
					this.excludedPage(),
					{
						name: "Index",
						desc: "Notes indexed, size and last update.",
						aliases: ["rebuild", "status", "size"],
						render: (row) => this.drawStatus(row),
					},
					{
						name: "Clear the index on this device",
						desc: "It is kept outside the vault, one per vault; the next search builds it again.",
						aliases: ["delete", "reset"],
						render: (row) => this.drawClear(row),
					},
				],
			},
			{ name: "Version", desc: `${this.owner.manifest.version} (build ${BUILD_ID})` },
		];
	}

	getControlValue(key: string): unknown {
		const s = this.owner.data.settings;
		const scope = this.scopeKey(key);
		if (scope) return scope.field === "mode" ? scope.s.mode : scope.s.combine;
		if (key === "scopesWhenNew") return s.scopesWhenNew;
		if (key.startsWith(STEM)) return s.stemming.includes(key.slice(STEM.length));
		switch (key) {
			case "doubleShift":
				return s.doubleShift;
			case "shiftInterval":
				return String(s.shiftInterval);
			case "newTab":
				return s.newTab;
			case "excerpts":
				return s.excerpts;
			case "preview":
				return s.preview;
			case "exclude":
				return s.exclude.join("\n");
			default:
				return undefined;
		}
	}

	setControlValue(key: string, value: unknown): void {
		const s = this.owner.data.settings;
		const scope = this.scopeKey(key);
		if (scope) {
			if (scope.field === "mode" && (value === "suggest" || value === "auto" || value === "in-only"))
				scope.s.mode = value;
			if (scope.field === "combine") {
				scope.s.combine = value === "all" ? "all" : "any";
				this.owner.scopes.reset();
			}
			this.owner.save();
			this.redraw();
			return;
		}
		if (key === "scopesWhenNew") {
			s.scopesWhenNew = value === "add" || value === "nothing" ? value : "tell";
			this.owner.save();
			return;
		}
		if (key.startsWith(STEM)) {
			const lang = key.slice(STEM.length);
			s.stemming = value === true ? [...new Set([...s.stemming, lang])] : s.stemming.filter((x) => x !== lang);
			this.owner.save();
			if (this.owner.client.running) void this.owner.client.call({ op: "configure", stemming: s.stemming });
			return;
		}
		switch (key) {
			case "doubleShift":
				s.doubleShift = value === true;
				break;
			case "shiftInterval":
				s.shiftInterval = Number(value);
				break;
			case "newTab":
				s.newTab = value === true;
				break;
			case "excerpts":
				s.excerpts = value === true;
				break;
			case "preview":
				s.preview = value === true;
				break;
			case "exclude":
				s.exclude = String(value)
					.split("\n")
					.map((x) => x.trim().replace(/\/$/, ""))
					.filter(Boolean);
				break;
			default:
				return;
		}
		this.owner.save();
	}

	/** Obsidian before 1.13 only (1.13+ draws the definitions itself): the same definitions, by hand. */
	display(): void {
		this.drawAll();
	}

	private drawAll(): void {
		const el = this.containerEl;
		el.replaceChildren();
		for (const item of this.getSettingDefinitions()) {
			if ("type" in item && item.type === "group") {
				if (item.heading) new Setting(el).setName(item.heading).setHeading();
				for (const d of item.items ?? []) {
					if (!("type" in d)) this.drawClassic(el, d);
					else if (d.name === "Folders to leave out") this.drawExcludedClassic(el);
				}
			} else if (!("type" in item)) this.drawClassic(el, item);
		}
	}

	/** Before 1.13 (no settings pages): the folders to leave out as a text box, one per line. */
	private drawExcludedClassic(el: HTMLElement): void {
		const s = this.owner.data.settings;
		new Setting(el)
			.setName("Folders to leave out")
			.setDesc("One folder per line. Obsidian's excluded files are left out too. Rebuild after changing.")
			.addTextArea((t) =>
				t.setValue(s.exclude.join("\n")).onChange((v) => void this.setControlValue("exclude", v)),
			);
	}

	private drawClassic(el: HTMLElement, d: SettingDefinition): void {
		const row = new Setting(el).setName(d.name);
		if (typeof d.desc === "string" && d.desc) row.setDesc(d.desc);
		if (d.render) {
			d.render(row, undefined as never);
			return;
		}
		const c = d.control;
		if (!c) return;
		const v = this.getControlValue(c.key);
		const set = (x: unknown): void => void this.setControlValue(c.key, x);
		if (c.type === "toggle") row.addToggle((t) => t.setValue(v === true).onChange(set));
		else if (c.type === "dropdown")
			row.addDropdown((x) => x.addOptions(c.options).setValue(String(v)).onChange(set));
		else if (c.type === "textarea")
			row.addTextArea((t) => t.setValue(typeof v === "string" ? v : "").onChange(set));
	}

	/** Drawn at once, never changed later: a late change of the text made Obsidian 1.14 redraw the tab forever. */
	private drawStatus(row: Setting): void {
		const x = statusNow(this.owner);
		row.setDesc(`${x.state} · ${x.notes} · ${x.size} · updated ${x.updated}`);
		row.addButton((b) =>
			b.setButtonText("Rebuild").onClick(() => {
				b.setDisabled(true).setButtonText("Rebuilding…");
				void rebuild(this.owner).then(
					() => this.redraw(),
					(e: unknown) => {
						console.error("Jet Search: rebuild failed", e);
						new Notice("The search index could not be rebuilt (see the console).");
						b.setDisabled(false).setButtonText("Rebuild");
					},
				);
			}),
		);
	}

	private drawClear(row: Setting): void {
		row.addButton((b) => {
			b.setButtonText("Clear").onClick(() => void clearIndex(this.owner).then(() => this.redraw()));
			b.buttonEl.addClass("mod-warning");
		});
	}

	/** Folders to leave out: a page with a list, like Obsidian's own "Excluded files". */
	private excludedPage(): SettingDefinitionPage {
		const s = this.owner.data.settings;
		const changed = (): void => {
			this.owner.save();
			this.redraw();
		};
		return {
			type: "page",
			name: "Folders to leave out",
			desc: "Never searched. Obsidian's excluded files are left out too. Rebuild the index after changing.",
			displayValue: () =>
				s.exclude.length ? `${s.exclude.length} folder${s.exclude.length === 1 ? "" : "s"}` : "None",
			items: [
				{
					type: "list",
					items: s.exclude.map((path) => ({ name: path })),
					emptyState: "No folders left out.",
					onDelete: (i) => {
						s.exclude.splice(i, 1);
						changed();
					},
					addItem: {
						name: "Add folder",
						action: () =>
							pickFolder(this.app, (r) => {
								if (r?.kind !== "folder" || s.exclude.includes(r.path)) return;
								s.exclude.push(r.path);
								changed();
							}),
					},
				},
			],
		};
	}

	/** `scope:<id>:mode` and `scope:<id>:combine` control keys. */
	private scopeKey(key: string): { s: import("./scopes/model").Scope; field: "mode" | "combine" } | null {
		const m = /^scope:(.+):(mode|combine)$/.exec(key);
		const s = m ? this.owner.data.scopes.find((x) => x.id === m[1]) : undefined;
		return m && s ? { s, field: m[2] as "mode" | "combine" } : null;
	}

	/**
	 * What the Scopes page needs. Counts are worked out only while the tab is on screen: Obsidian also
	 * asks for the definitions when the plugin loads (for its settings search), and Jet does nothing at start.
	 */
	private scopesHost(): ScopesHost {
		const keeper = this.owner.scopes;
		const shown = (): boolean => this.containerEl.isConnected;
		return {
			app: this.app,
			scopes: () => this.owner.data.scopes,
			save: () => this.owner.save(),
			count: (id) => {
				if (!shown()) return null;
				keeper.ensure();
				return keeper.count(id);
			},
			ruleCount: (r) => (shown() ? keeper.ruleCount(r) : null),
			changed: () => {
				keeper.reset();
				this.redraw();
			},
			generate: () => {
				const page = this.generatePage();
				return !!page && openSettingPage(this.app, page);
			},
			generatePage: () => this.generatePage() as SettingPage,
			canOpenPages: () => !!(this.app as unknown as { setting?: { openPage?: unknown } }).setting?.openPage,
			newCount: () => 0,
		};
	}

	private generatePage(): SettingPage | null {
		return createGeneratePage({
			app: this.app,
			scopes: () => this.owner.data.scopes,
			setScopes: (scopes) => {
				this.owner.data.scopes = scopes;
			},
			save: () => this.owner.save(),
			changed: () => {
				this.owner.scopes.reset();
				this.redraw();
			},
			snapshot: () => obsidianSnapshot(this.app, this.owner.data.settings.exclude),
		});
	}

	/** Draw the tab again with fresh values (after a rebuild or a clear). */
	private redraw(): void {
		// Before 1.13 there is no update(): draw by hand.
		if (requireApiVersion("1.13.0")) this.update();
		else this.drawAll();
	}
}
