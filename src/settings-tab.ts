/**
 * Jet's settings tab, drawn like Jade's: a header with live
 * numbers, a search over Jet's own settings, tabs by subject, one card per feature with its options
 * under it. Jet draws it itself, so it looks the same on Obsidian 1.8–1.12; only editing a
 * scope and the Generate review differ there (a dialog instead of a page). Every value is read and
 * written through `getControlValue` / `setControlValue`, one place per setting.
 */
import { type App, Menu, Notice, PluginSettingTab, setIcon } from "obsidian";
import { BUILD_ID } from "./build-id";
import { STEM_LANGUAGES } from "./engine/stem";
import { clearIndex, rebuild, statusNow } from "./index-status";
import { hotkeyLabel, openHotkeys, openJetSettings, tapOwnedElsewhere } from "./internals";
import {
	clashes,
	type Combo,
	comboLabel,
	KEY_ACTIONS,
	type KeyAction,
	keyMap,
	comboOf,
	refusal,
	sameCombo,
	tapKeyNames,
	tapLabel,
	type TapKey,
} from "./keys/keymap";
import { MODEL } from "./meaning/model";
import { modeOf, type Scope } from "./scopes/model";
import { obsidianSnapshot } from "./scopes/snapshot-obsidian";
import { type GenerateHost, openGenerate } from "./settings/generate-page";
import { MEANING_LONG, MEANING_WHAT, MeaningConfirm, questionsText } from "./settings/meaning-settings";
import { pickFolder } from "./settings/rule-pickers";
import { openScopeEditor, settingRow } from "./settings/scope-editor";
import { addScope, MODE_LABEL, type ScopesHost } from "./settings/scopes-page";
import type JetSearchPlugin from "./main";
import { fail } from "./diag/diag";
import { TRACE_MINUTES, trace } from "./diag/trace";

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
/** Control keys of the keys in the window: `key:<action>` (a combo, or null for the default). */
const KEY = "key:";

export type SettingsPage = "open" | "results" | "scopes" | "meaning" | "index" | "advanced";

const TABS: ReadonlyArray<{ id: SettingsPage; name: string; lead: string }> = [
	{ id: "open", name: "Open & keys", lead: "Opening Jet, and the keys inside it." },
	{ id: "results", name: "Results", lead: "What a search shows." },
	{ id: "scopes", name: "Scopes", lead: "Search inside a project, an area or any group of notes." },
	{ id: "meaning", name: "Search by meaning", lead: "Questions answered by notes that mean the same, in any words." },
	{ id: "index", name: "Index", lead: "The search index on this device." },
	{ id: "advanced", name: "Advanced", lead: "Word forms, folders to leave out, and the version." },
];

type Card = { card: HTMLElement; row: HTMLElement; opts: () => HTMLElement };

// Drawn by Jet itself: the same tabs and cards on Obsidian 1.8–1.12 and 1.13+;
// its own search box replaces Obsidian's settings search for these settings.
export class JetSettingTab extends PluginSettingTab {
	private page: SettingsPage = "open";
	private query = "";
	/** Between display() and hide(): changes draw the tab again. */
	private shown = false;
	/** The action waiting for a key press, and why the last key was refused. */
	private recording: KeyAction | null = null;
	private keyMsg = "";
	private stopRecording: (() => void) | null = null;

	constructor(
		app: App,
		private readonly owner: JetSearchPlugin,
	) {
		super(app, owner);
	}

	// ── Values ──────────────────────────────────────────────────────────────────

	getControlValue(key: string): unknown {
		const s = this.owner.data.settings;
		const scope = this.scopeKey(key);
		if (scope) return scope.field === "mode" ? scope.s.mode : scope.s.combine;
		if (key.startsWith(KEY)) {
			const a = KEY_ACTIONS.find((x) => x.id === key.slice(KEY.length));
			return a ? comboLabel(keyMap(s.keys)[a.id]) : undefined;
		}
		if (key === "traceMinutes") return String(s.traceMinutes);
		if (key === "traceNextStart") return s.traceNextStart;
		if (key === "scopesWhenNew") return s.scopesWhenNew;
		if (key === "scopeMode") return s.scopeMode;
		if (key === "scopeAnother") return s.scopeAnother;
		if (key === "meaning") return s.meaning && this.owner.meaning.installed();
		if (key === "questionShows") return s.questionShows;
		if (key === "bothLayout") return s.bothLayout;
		if (key === "meaningLong") return s.meaningLong;
		if (key === "answers") return s.answers;
		if (key.startsWith(STEM)) return s.stemming.includes(key.slice(STEM.length));
		switch (key) {
			case "tapKey":
				return s.tapKey;
			case "shiftInterval":
				return String(s.shiftInterval);
			case "newTab":
				return s.newTab;
			case "excerpts":
				return s.excerpts;
			case "preview":
				return s.preview;
			case "persistFilters":
				return s.persistFilters;
			case "fixKeys":
				return s.fixKeys;
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
			if (
				scope.field === "mode" &&
				(value === "default" || value === "suggest" || value === "auto" || value === "in-only")
			)
				scope.s.mode = value;
			if (scope.field === "combine") {
				scope.s.combine = value === "all" ? "all" : "any";
				this.owner.scopes.reset();
			}
			this.owner.save();
			this.redraw();
			return;
		}
		if (key.startsWith(KEY)) {
			this.setKey(key.slice(KEY.length), value);
			return;
		}
		if (key === "meaning") {
			const m = this.owner.meaning;
			if (value === true && !m.installed()) {
				// Nothing is fetched before you confirm.
				new MeaningConfirm(this.app, m, this.app.vault.getMarkdownFiles().length, () => this.redraw()).open();
				return;
			}
			void m
				.set(value === true)
				.catch((e: unknown) => fail("meaning.switch", "Jet Search: search by meaning could not be switched", e))
				.then(() => this.redraw());
			return;
		}
		if (key === "traceMinutes") {
			const n = Number(value);
			if ((TRACE_MINUTES as readonly number[]).includes(n)) s.traceMinutes = n;
			this.owner.save();
			return;
		}
		if (key === "traceNextStart") {
			s.traceNextStart = value === true;
			this.owner.save();
			return;
		}
		if (key === "questionShows") {
			if (value === "both" || value === "meaning" || value === "words") s.questionShows = value;
			this.owner.save();
			return;
		}
		if (key === "bothLayout") {
			if (value === "groups" || value === "first" || value === "ranked") s.bothLayout = value;
			this.owner.save();
			return;
		}
		if (key === "meaningLong") {
			s.meaningLong = value === true;
			this.owner.save();
			return;
		}
		if (key === "answers") {
			s.answers = value === true;
			this.owner.save();
			return;
		}
		if (key === "scopeMode") {
			s.scopeMode = value === "auto" || value === "in-only" ? value : "suggest";
			this.owner.save();
			this.redraw();
			return;
		}
		if (key === "scopesWhenNew") {
			s.scopesWhenNew = value === "add" || value === "nothing" ? value : "tell";
			this.owner.save();
			return;
		}
		if (key === "scopeAnother") {
			s.scopeAnother = value === "switch" ? "switch" : "add";
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
			case "tapKey":
				if (tapKeyNames().some(([k]) => k === value)) s.tapKey = value as TapKey;
				this.owner.save();
				// The window's row comes and goes with it; the keys card's ⇧⇧ follows.
				this.redraw();
				return;
			case "shiftInterval":
				{
					// Only a window the setting offers a range for; anything else is ignored.
					const n = Number(value);
					if (Number.isFinite(n) && n >= 150 && n <= 1000) s.shiftInterval = n;
				}
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
			case "persistFilters":
				s.persistFilters = value === true;
				if (!s.persistFilters) this.owner.data.last = null;
				break;
			case "fixKeys":
				s.fixKeys = value === true;
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

	/**
	 * A key for an action: a combo, or null for its default. Refused (and said why, under the keys)
	 * when Jet keeps it, it types text or another action has it.
	 */
	private setKey(id: string, value: unknown): void {
		const a = KEY_ACTIONS.find((x) => x.id === id);
		if (!a) return;
		const keys = this.owner.data.settings.keys;
		const c = value as Combo | null;
		if (c === null) {
			// Its default back, unless another action has that key now (both would sit on it).
			const rest = { ...keys };
			delete rest[a.id];
			const why = refusal(keyMap(rest), a.id, a.key);
			if (why) {
				this.keyMsg = `${why} Change that one first.`;
				this.redraw();
				return;
			}
			delete keys[a.id];
		} else {
			if (!c || typeof c.key !== "string" || !Array.isArray(c.mods)) return;
			const why = refusal(keyMap(keys), a.id, c);
			if (why) {
				this.keyMsg = why;
				this.redraw();
				return;
			}
			if (sameCombo(c, a.key)) delete keys[a.id];
			else keys[a.id] = { mods: [...c.mods], key: c.key };
		}
		this.keyMsg = "";
		this.owner.save();
		this.redraw();
	}

	/** `scope:<id>:mode` and `scope:<id>:combine` control keys. */
	private scopeKey(key: string): { s: Scope; field: "mode" | "combine" } | null {
		const m = /^scope:(.+):(mode|combine)$/.exec(key);
		const s = m ? this.owner.data.scopes.find((x) => x.id === m[1]) : undefined;
		return m && s ? { s, field: m[2] as "mode" | "combine" } : null;
	}

	// ── Drawing ────────────────────────────────────────────────────────────────

	display(): void {
		this.shown = true;
		const root = this.containerEl;
		root.empty();
		root.addClass("jet-settings");
		this.header(root);
		this.tabs(root);
		this.drawBody(root.createDiv({ cls: "jet-set-body" }));
	}

	hide(): void {
		this.shown = false;
		this.stopRecording?.();
	}

	/** Open the settings at a page (the window's "Manage ↗", a chip's "Edit scope"), and a scope's editor. */
	openAt(page: SettingsPage, scopeId?: string): void {
		this.page = page;
		this.query = "";
		openJetSettings(this.app, this.owner.manifest.id);
		const s = scopeId ? this.owner.data.scopes.find((x) => x.id === scopeId) : undefined;
		if (s)
			openScopeEditor(
				this.scopesHost(() => true),
				s,
			);
	}

	/** Draw the tab again with fresh values (after a rebuild or a clear, or a change made elsewhere). */
	refresh(): void {
		this.redraw();
	}

	/** Drawn again in place, where you were scrolled to, typing in the search box if you were. */
	private redraw(): void {
		if (!this.shown) return;
		const top = this.containerEl.scrollTop;
		const box = this.containerEl.querySelector<HTMLInputElement>("input.jet-set-search");
		const typing = !!box && box.ownerDocument.activeElement === box;
		const caret = typing ? [box.selectionStart ?? 0, box.selectionEnd ?? 0] : null;
		this.display();
		this.containerEl.scrollTop = top;
		if (caret) {
			const again = this.containerEl.querySelector<HTMLInputElement>("input.jet-set-search");
			again?.focus();
			again?.setSelectionRange(caret[0] ?? 0, caret[1] ?? 0);
		}
	}

	/** Search by meaning's progress: drawn again only while its tab is the one shown (twice a second at most). */
	progressChanged(): void {
		if (this.page === "meaning" && !this.query) this.redraw();
	}

	private header(root: HTMLElement): void {
		const head = root.createDiv({ cls: "jet-set-head" });
		const title = head.createDiv({ cls: "jet-set-title" });
		title.createDiv({ cls: "jet-set-mark", text: "J" });
		const text = title.createDiv({ cls: "jet-set-heading" });
		text.createDiv({ cls: "jet-set-h", text: "Jet Search" });
		text.createDiv({
			cls: "jet-set-sub",
			text: "Find any note as you type: names, text, scopes, filters and meaning.",
		});
		// Drawn at once and never changed later: a late change of the text made Obsidian 1.14 redraw forever.
		const x = statusNow(this.owner);
		const chips = title.createDiv({ cls: "jet-set-chips" });
		const chip = (strong: string, rest: string): void => {
			const c = chips.createSpan({ cls: "jet-set-chip" });
			c.createEl("b", { text: strong });
			c.appendText(rest);
		};
		if (this.owner.data.indexedAt === null) chip("Index", " not built yet");
		else chip(this.owner.feeder.indexable().toLocaleString(), " notes indexed");
		const n = this.owner.data.scopes.length;
		chip(String(n), ` scope${n === 1 ? "" : "s"}`);
		if (x.size !== "—") chip(x.size.replace(/ on this device$/, ""), " on this device");
		const search = head.createEl("input", {
			cls: "jet-set-search",
			attr: { type: "search", placeholder: "Search these settings: a key, a scope, what it does…" },
		});
		search.value = this.query;
		search.addEventListener("input", () => {
			this.stopRecording?.();
			this.query = search.value.trim().toLowerCase();
			const body = this.containerEl.querySelector<HTMLElement>(".jet-set-body");
			if (body) this.drawBody(body);
			for (const t of Array.from(this.containerEl.querySelectorAll(".jet-set-tab")))
				t.toggleClass("is-active", !this.query && t.getAttr("data-page") === this.page);
		});
	}

	private tabs(root: HTMLElement): void {
		const bar = root.createDiv({ cls: "jet-set-tabs", attr: { role: "tablist" } });
		for (const t of TABS) {
			const el = bar.createDiv({
				cls: `jet-set-tab${this.page === t.id && !this.query ? " is-active" : ""}`,
				text: t.name,
				attr: { "data-page": t.id, role: "tab", tabindex: "0" },
			});
			const go = (): void => {
				// A key waiting for its press is let go: the press would land on a page you no longer see.
				this.stopRecording?.();
				this.page = t.id;
				this.query = "";
				this.redraw();
			};
			el.addEventListener("click", go);
			el.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") go();
			});
		}
	}

	private drawBody(body: HTMLElement): void {
		body.empty();
		if (this.query) {
			this.searchResults(body);
			return;
		}
		const t = TABS.find((x) => x.id === this.page) ?? TABS[0];
		if (!t) return;
		body.createDiv({ cls: "jet-set-lead", text: t.lead });
		this.drawPage(body, t.id);
	}

	private drawPage(body: HTMLElement, page: SettingsPage): void {
		if (page === "open") this.openPage(body);
		else if (page === "results") this.resultsPage(body);
		else if (page === "scopes") this.scopesPage(body);
		else if (page === "meaning") this.meaningPage(body);
		else if (page === "index") this.indexPage(body);
		else this.advancedPage(body);
	}

	/**
	 * Every page's cards, kept where the search matches ("window" found the Keys
	 * card by its description). Names first: a card's name or search words keep it whole; a row's name
	 * (a setting, a key's action, a scope) keeps that row in its card. Descriptions count only when no
	 * name matches anywhere.
	 */
	private searchResults(body: HTMLElement): void {
		const q = this.query;
		const lead = body.createDiv({ cls: "jet-set-lead" });
		const draw = (): HTMLElement => {
			const all = body.createDiv();
			for (const t of TABS) this.drawPage(all, t.id);
			return all;
		};
		const has = (t: string | null | undefined): boolean => (t ?? "").toLowerCase().includes(q);
		const ROWS = ".setting-item, .jet-set-scope, tr";
		const rowName = (r: HTMLElement): string =>
			r.querySelector(".setting-item-name, b, td")?.textContent ?? r.textContent ?? "";
		const filter = (all: HTMLElement, byDesc: boolean): number => {
			let n = 0;
			for (const card of Array.from(all.querySelectorAll<HTMLElement>(".jet-set-card"))) {
				const name = card.querySelector(".jet-set-name")?.textContent ?? "";
				const head = byDesc ? (card.dataset.search ?? "") : `${name} ${card.dataset.words ?? ""}`;
				if (has(head)) {
					n++;
					continue;
				}
				let kept = 0;
				for (const r of Array.from(card.querySelectorAll<HTMLElement>(ROWS)))
					if (has(byDesc ? r.textContent : rowName(r))) kept++;
					else r.remove();
				if (kept) n++;
				else card.remove();
			}
			return n;
		};
		let all = draw();
		let n = filter(all, false);
		if (!n) {
			all.remove();
			all = draw();
			n = filter(all, true);
		}
		lead.setText(n ? `${n} matching` : "Nothing matches.");
	}

	/** One feature (Jade's cards): its icon, name and what it does, a control on the right, options under. */
	private card(
		parent: HTMLElement,
		o: { icon: string; name: string; desc: string; aliases?: string; off?: boolean; bold?: string },
	): Card {
		const card = parent.createDiv({
			cls: `jet-set-card${o.off ? " is-off" : ""}`,
			attr: { "data-search": `${o.name} ${o.desc} ${o.aliases ?? ""}`, "data-words": o.aliases ?? "" },
		});
		const row = card.createDiv({ cls: "jet-set-row" });
		setIcon(row.createDiv({ cls: "jet-set-icon" }), o.icon);
		const text = row.createDiv({ cls: "jet-set-text" });
		text.createDiv({ cls: "jet-set-name", text: o.name });
		if (o.desc) {
			const d = text.createDiv({ cls: "jet-set-desc" });
			// One phrase in bold (a command's name).
			const at = o.bold ? o.desc.indexOf(o.bold) : -1;
			if (at < 0 || !o.bold) d.setText(o.desc);
			else {
				d.appendText(o.desc.slice(0, at));
				d.createEl("b", { text: o.bold });
				d.appendText(o.desc.slice(at + o.bold.length));
			}
		}
		let opts: HTMLElement | null = null;
		return { card, row, opts: () => (opts ??= card.createDiv({ cls: "jet-set-opts" })) };
	}

	/** A switch for a setting, as Obsidian draws one. */
	private toggle(el: HTMLElement, key: string): HTMLElement {
		const t = el.createDiv({
			cls: `checkbox-container${this.getControlValue(key) === true ? " is-enabled" : ""}`,
			attr: { role: "switch", "data-key": key, tabindex: "0" },
		});
		const flip = (): void => {
			this.setControlValue(key, this.getControlValue(key) !== true);
			// As it is now (search by meaning waits for your confirm before it is on).
			t.toggleClass("is-enabled", this.getControlValue(key) === true);
		};
		t.addEventListener("click", flip);
		t.addEventListener("keydown", (e) => {
			if (e.key === " " || e.key === "Enter") {
				e.preventDefault();
				flip();
			}
		});
		return t;
	}

	private dropdown(
		el: HTMLElement,
		key: string,
		options: ReadonlyArray<readonly [string, string]>,
	): HTMLSelectElement {
		const sel = el.createEl("select", { cls: "dropdown", attr: { "data-key": key } });
		for (const [v, label] of options) sel.createEl("option", { text: label, attr: { value: v } });
		sel.value = String(this.getControlValue(key));
		sel.addEventListener("change", () => this.setControlValue(key, sel.value));
		return sel;
	}

	private button(el: HTMLElement, text: string, run: () => void, cls = ""): HTMLButtonElement {
		const b = el.createEl("button", { text, cls });
		b.addEventListener("click", run);
		return b;
	}

	private lab(a: KeyAction): string {
		return comboLabel(keyMap(this.owner.data.settings.keys)[a]);
	}

	// ── Open & keys ───────────────────────────────────────────────────

	private openPage(body: HTMLElement): void {
		const s = this.owner.data.settings;
		const open = this.card(body, {
			icon: "search",
			name: "Open Jet",
			desc: "Give Jet Search: Search notes any hotkey in Obsidian's Hotkeys: that is the usual way. A double tap of a modifier is extra, for those who like it.",
			bold: "Jet Search: Search notes",
			aliases: "hotkey shortcut Shift-Shift double shift tap",
		});
		this.button(open.row, "Set a hotkey ↗", () => openHotkeys(this.app, "Jet Search"));
		const o = open.opts();
		settingRow(o, "Hotkey", "From Obsidian's Hotkeys.").createSpan({
			cls: "jet-set-kbd",
			text: hotkeyLabel(this.app, `${this.owner.manifest.id}:open`) ?? "not set",
		});
		// Jade may already open Jet with a double tap of its own (you accepted its offer): say so, it wins.
		// A key another plugin taps for something else: Jet's own double tap stands down, so say that too.
		const name = (k: string): string => tapKeyNames().find(([x]) => x === k)?.[1] ?? k;
		const jade = this.owner.jade?.jadeTap() ?? null;
		const jadeName = jade ? name(jade) : null;
		const taken =
			s.tapKey !== "off" &&
			s.tapKey !== jade &&
			(this.owner.jade?.ownsTap(s.tapKey) ?? tapOwnedElsewhere(this.app, s.tapKey));
		this.dropdown(
			settingRow(
				o,
				"Double tap",
				"Two quick taps of one key, alone, open Jet. Off when another plugin already handles that key." +
					(taken ? ` Another plugin already uses a double tap of ${name(s.tapKey)}: pick another key.` : "") +
					(jadeName
						? ` Jade opens Jet with a double tap of ${jadeName} too; change that in Jade's settings.`
						: ""),
			),
			"tapKey",
			tapKeyNames(),
		);
		if (s.tapKey !== "off")
			this.dropdown(
				settingRow(o, "Double tap window", "The two taps must come within this time."),
				"shiftInterval",
				[
					["250", "250 ms"],
					["350", "350 ms"],
					["500", "500 ms"],
				],
			);
		this.toggle(
			settingRow(
				o,
				"Open in a new tab",
				`${this.lab("open")} opens results in a new tab, and ${this.lab("openOther")} in the same tab.`,
			),
			"newTab",
		);
		this.keysCard(body);
	}

	private keysCard(body: HTMLElement): void {
		const s = this.owner.data.settings;
		const map = keyMap(s.keys);
		const c = this.card(body, {
			icon: "keyboard",
			name: "Keys in Jet",
			desc: "The keys inside the search window. Click a key to change it; ↺ puts its default back. A key another action already uses is refused, with which one. The hints in the window follow.",
			aliases: "shortcut hotkey keyboard",
		});
		this.button(c.row, "Reset all", () => {
			s.keys = {};
			this.keyMsg = "";
			this.owner.save();
			this.redraw();
		});
		const o = c.opts();
		const table = o.createEl("table", { cls: "jet-set-keys" });
		for (const a of KEY_ACTIONS) {
			const tr = table.createEl("tr", { attr: { "data-action": a.id } });
			tr.createEl("td", { text: a.what });
			const td = tr.createEl("td");
			if (this.recording === a.id) {
				td.createSpan({ cls: "jet-set-rec", text: "Press a key… (Esc to cancel)" });
				continue;
			}
			// Changed from its default (a saved key that is now the default is not marked).
			const changed = !sameCombo(map[a.id], a.key);
			const k = td.createSpan({
				cls: `jet-set-kbd is-key${changed ? " is-changed" : ""}`,
				text: comboLabel(map[a.id]),
				attr: { role: "button", tabindex: "0", "aria-label": `Change the key for: ${a.what}` },
			});
			k.addEventListener("click", () => this.record(a.id));
			if (changed) {
				const r = td.createSpan({
					cls: "jet-set-reset",
					text: `↺ ${comboLabel(a.key)}`,
					attr: { role: "button", "aria-label": "Put the default back" },
				});
				r.addEventListener("click", () => this.setControlValue(`${KEY}${a.id}`, null));
			}
		}
		const tr = table.createEl("tr");
		tr.createEl("td", { text: "Search everywhere, and back" });
		tr.createEl("td").createSpan({
			cls: "jet-set-kbd is-fixed",
			text: tapLabel(s.tapKey) ?? "Off",
			attr: { title: "Your double tap, above" },
		});
		if (this.keyMsg) o.createDiv({ cls: "jet-set-keymsg", text: this.keyMsg });
		// Two actions on one key (a key you saved before it became another action's default): one never runs.
		const what = (id: KeyAction): string => KEY_ACTIONS.find((x) => x.id === id)?.what ?? id;
		for (const [x, y] of clashes(map))
			o.createDiv({
				cls: "jet-set-keymsg",
				text: `${comboLabel(map[x])} is on two actions: ${what(x)}, and ${what(y)}. Change one of them.`,
			});
	}

	/** Wait for the next key press for `a` (Esc cancels); the window's own keys are not run meanwhile. */
	private record(a: KeyAction): void {
		this.stopRecording?.();
		this.recording = a;
		this.keyMsg = "";
		const win = (this.containerEl as HTMLElement & { win?: Window }).win ?? window;
		const stop = (): void => {
			win.removeEventListener("keydown", onKey, true);
			this.recording = null;
			this.stopRecording = null;
		};
		const onKey = (e: KeyboardEvent): void => {
			e.preventDefault();
			e.stopImmediatePropagation();
			if (e.key === "Escape") {
				stop();
				this.redraw();
				return;
			}
			const c = comboOf(e);
			if (!c) return;
			stop();
			this.setControlValue(`${KEY}${a}`, c);
		};
		win.addEventListener("keydown", onKey, true);
		this.stopRecording = stop;
		this.redraw();
	}

	// ── Results ────────────────────────────────────────────────────────────────

	private resultsPage(body: HTMLElement): void {
		const ex = this.card(body, {
			icon: "text",
			name: "Excerpts",
			desc: "A line around the best hit under each result found in the text.",
			aliases: "snippet",
		});
		this.toggle(ex.row, "excerpts");
		const pv = this.card(body, {
			icon: "eye",
			name: "Preview",
			desc: `The selected note, shown next to the results (${this.lab("preview")} toggles it).`,
		});
		this.toggle(pv.row, "preview");
		const keep = this.card(body, {
			icon: "pin",
			name: "Keep the last scope and filters",
			desc: "Search reopens with your last scope and filters; kept chips show a pin dot.",
			aliases: "persist remember pin chips",
		});
		this.toggle(keep.row, "persistFilters");
		const f = this.card(body, {
			icon: "filter",
			name: "Filters",
			desc: `Typed (status:draft, #tag, edited:7d) or from the bar (${this.lab("filters")}), with autocomplete for keys and values.`,
		});
		this.toggle(
			settingRow(f.opts(), "Fix a misspelt key", `“stauts:draft” offers status: with ${this.lab("accept")}.`),
			"fixKeys",
		);
	}

	// ── Scopes ──────────────────────────────────────────────────────

	private scopesPage(body: HTMLElement): void {
		const h = this.scopesHost();
		const all = this.owner.data.scopes;
		const generatedBefore = all.some((s) => s.source === "generated");
		const fresh = h.newCount();
		const c = this.card(body, {
			icon: "layers",
			name: "Scopes",
			desc: `Type a scope's name, then ${this.lab("accept")}, or @name, to search only its notes. A note is in a scope when any of its rules matches.`,
			aliases: "generate find",
		});
		this.button(
			c.row,
			fresh ? `Review ${fresh} new…` : generatedBefore ? "Find new scopes" : "Generate…",
			() => h.generate(),
			"mod-cta",
		);
		const o = c.opts();
		this.dropdown(
			settingRow(
				o,
				"When typed, for every scope",
				`Suggest: ${this.lab("accept")} accepts. Auto: as soon as the name and a space are typed. in: only: only after in: or @. A scope can choose its own.`,
			),
			"scopeMode",
			[
				["suggest", "Suggest"],
				["auto", "Auto"],
				["in-only", "in: only"],
			],
		);
		this.dropdown(
			settingRow(
				o,
				"Another scope while one is on",
				"Add it: the search covers both (results from either). Switch to it: the new one replaces the first.",
			),
			"scopeAnother",
			[
				["add", "Add it"],
				["switch", "Switch to it"],
			],
		);
		this.dropdown(
			settingRow(
				o,
				"When new ones appear",
				"Jet checks after changes in your vault (a new folder that fits a pattern).",
			),
			"scopesWhenNew",
			[
				["tell", "Tell me"],
				["add", "Add them"],
				["nothing", "Do nothing"],
			],
		);
		// The list: each scope with its kind, notes and mode, and Edit (a page on 1.13+, a dialog before).
		const list = body.createDiv({
			cls: "jet-set-card jet-set-list",
			attr: { "data-search": "scopes list" },
		});
		const head = list.createDiv({ cls: "jet-set-listhead" });
		head.createSpan({
			cls: "jet-set-count",
			text: all.length ? `${all.length} scope${all.length === 1 ? "" : "s"}` : "No scopes yet",
		});
		if (fresh) head.createSpan({ cls: "jet-set-new", text: ` · ${fresh} new` });
		const editor = this.scopesHost(() => true);
		this.button(head, "Add scope", () => openScopeEditor(editor, addScope(editor)));
		if (!all.length) list.createDiv({ cls: "jet-set-empty", text: "Generate them, or add one by hand." });
		const every = this.owner.data.settings.scopeMode;
		for (const s of all) {
			const row = list.createDiv({ cls: "jet-set-scope", attr: { "data-id": s.id } });
			row.createEl("b", { text: s.name });
			row.createSpan({ cls: "jet-set-k", text: s.kind });
			const n = h.count(s.id);
			row.createSpan({
				cls: "jet-set-n",
				text: n === null ? "" : `${n.toLocaleString()} note${n === 1 ? "" : "s"}`,
			});
			row.createSpan({
				cls: "jet-set-m",
				text: s.mode === "default" ? `${MODE_LABEL[modeOf(s, every)]} · every scope` : MODE_LABEL[s.mode],
			});
			this.button(row, "Edit", () => openScopeEditor(editor, s));
		}
	}

	/**
	 * What the scope editor and Generate need. Counts are worked out only while the tab is on screen
	 * (Jet does nothing at start).
	 */
	/**
	 * `onScreen`: whether counts may be worked out now; the tab while it is shown, the scope editor
	 * always (it is on screen while it asks, and on 1.13+ the tab under it is not).
	 */
	private scopesHost(onScreen: () => boolean = () => this.containerEl.isConnected): ScopesHost {
		const keeper = this.owner.scopes;
		const shown = onScreen;
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
			mentions: (id) => {
				const m = this.owner.mentionsOf(id);
				if (!m && shown()) void this.owner.measure(id);
				return m;
			},
			changed: () => {
				keeper.reset();
				this.redraw();
			},
			generate: () => openGenerate(this.generateHost()),
			canOpenPages: () => !!(this.app as unknown as { setting?: { openPage?: unknown } }).setting?.openPage,
			newCount: () => this.owner.watcher.fresh,
			everyMode: () => this.owner.data.settings.scopeMode,
		};
	}

	private generateHost(): GenerateHost {
		return {
			app: this.app,
			scopes: () => this.owner.data.scopes,
			setScopes: (scopes) => {
				this.owner.data.scopes = scopes;
			},
			save: () => this.owner.save(),
			changed: () => {
				this.owner.scopes.reset();
				this.owner.watcher.fresh = 0;
				this.redraw();
			},
			snapshot: () => obsidianSnapshot(this.app, this.owner.data.settings.exclude),
		};
	}

	// ── Search by meaning ──────────────────────────────────────────────────────

	private meaningPage(body: HTMLElement): void {
		const m = this.owner.meaning;
		const on = m.available();
		const c = this.card(body, {
			icon: "brain",
			name: "Search by meaning",
			desc: MEANING_WHAT,
			aliases: "semantic embedding model question",
			off: !on,
		});
		this.toggle(c.row, "meaning");
		if (!on) return;
		const o = c.opts();
		this.dropdown(settingRow(o, "A question shows", questionsText(this.lab("meaning"))), "questionShows", [
			["both", "Both"],
			["meaning", "By meaning"],
			["words", "By words"],
		]);
		// How both are shown: a setting with three layouts.
		this.dropdown(
			settingRow(
				o,
				"Both, shown as",
				"Two groups: by words, then what only meaning found. Found both ways first: those, then words, then meaning. One list: ranked together, a badge on each row.",
			),
			"bothLayout",
			[
				["groups", "Two groups"],
				["first", "Found both ways first"],
				["ranked", "One list"],
			],
		);
		this.toggle(settingRow(o, "Long searches go by meaning too", MEANING_LONG), "meaningLong");
		// Answers (experiment).
		this.toggle(
			settingRow(
				o,
				"Find answers (experiment)",
				"A question lists its notes by the line that answers it, shows that line under each, and outlines it in the preview.",
			),
			"answers",
		);
		const p = this.owner.feeder.meaningProgress;
		const notes = this.app.vault.getMarkdownFiles().length;
		const rb = this.button(
			settingRow(
				o,
				"Notes",
				p
					? `Giving notes their meaning: ${p.done.toLocaleString()} of ${p.total.toLocaleString()}…`
					: `${notes.toLocaleString()} notes · each gets one vector, in the background, newest first; it follows your edits.`,
			),
			"Rebuild",
			() => {
				rb.disabled = true;
				rb.setText("Rebuilding…");
				void m.rebuild().then(
					() => this.redraw(),
					(e: unknown) => {
						fail("meaning.vectors", "Jet Search: making the vectors failed", e);
						new Notice("Search by meaning: the notes could not be given their meaning (see the console).");
						this.redraw();
					},
				);
			},
		);
		this.button(
			settingRow(
				o,
				"Model",
				`${MODEL.id} · static (one vector per note) · ${(m.installedBytes() / 1e6).toFixed(1)} MB in Jet's folder`,
			),
			"Remove the model",
			() => void m.remove().then(() => this.redraw()),
			"mod-warning",
		);
	}

	// ── Index ──────────────────────────────────────────────────────────────────

	private indexPage(body: HTMLElement): void {
		// Drawn at once, never changed later: a late change of the text made Obsidian 1.14 redraw the tab forever.
		const x = statusNow(this.owner);
		const c = this.card(body, {
			icon: "database",
			name: "Index",
			desc: x.state,
			aliases: "rebuild status size clear",
		});
		const rb = this.button(c.row, "Rebuild", () => {
			rb.disabled = true;
			rb.setText("Rebuilding…");
			void rebuild(this.owner).then(
				() => this.redraw(),
				(e: unknown) => {
					fail("index.rebuild", "Jet Search: rebuild failed", e);
					new Notice("The search index could not be rebuilt (see the console).");
					rb.disabled = false;
					rb.setText("Rebuild");
				},
			);
		});
		const o = c.opts();
		settingRow(o, "Notes", x.notes);
		this.button(
			settingRow(
				o,
				"On this device",
				`${x.size === "—" ? "Not measured yet" : x.size}, outside the vault; one per vault.`,
			),
			"Clear",
			() => void clearIndex(this.owner).then(() => this.redraw()),
			"mod-warning",
		);
		settingRow(o, "Updated", x.updated);
	}

	// ── Advanced ───────────────────────────────────────────────────────────────

	private advancedPage(body: HTMLElement): void {
		const s = this.owner.data.settings;
		const wf = this.card(body, {
			icon: "languages",
			name: "Word forms",
			desc: "Running finds run; meetings finds meeting. One or more languages.",
			aliases: "stemming language plural",
		});
		const names = s.stemming.map((l) => LANGUAGE_NAMES[l] ?? l);
		const change = this.button(settingRow(wf.opts(), "Languages", names.join(", ") || "None"), "Change…", () => {
			const menu = new Menu();
			for (const lang of STEM_LANGUAGES)
				menu.addItem((i) =>
					i
						.setTitle(LANGUAGE_NAMES[lang] ?? lang)
						.setChecked(s.stemming.includes(lang))
						.onClick(() => {
							this.setControlValue(`${STEM}${lang}`, !s.stemming.includes(lang));
							this.redraw();
						}),
				);
			const r = change.getBoundingClientRect();
			menu.showAtPosition({ x: r.left, y: r.bottom });
		});
		const ex = this.card(body, {
			icon: "folder-x",
			name: "Folders to leave out",
			desc: "Never searched. Obsidian's excluded files are left out too. Rebuild the index after changing.",
			aliases: "exclude ignore",
		});
		this.button(ex.row, "Add folder", () =>
			pickFolder(this.app, (r) => {
				if (r?.kind !== "folder" || s.exclude.includes(r.path)) return;
				this.setControlValue("exclude", [...s.exclude, r.path].join("\n"));
				this.redraw();
			}),
		);
		const o = ex.opts();
		if (!s.exclude.length) settingRow(o, "No folders left out.");
		for (const path of s.exclude) {
			const x = settingRow(o, path).createEl("button", {
				cls: "clickable-icon",
				attr: { "aria-label": `Search ${path} again` },
			});
			setIcon(x, "x");
			x.addEventListener("click", () => {
				this.setControlValue("exclude", s.exclude.filter((p) => p !== path).join("\n"));
				this.redraw();
			});
		}
		const support = this.card(body, {
			icon: "life-buoy",
			name: "Support",
			desc: "Make a report to copy or send with a bug report.",
			aliases: "support info bug report debug diagnostics help problem",
		});
		this.button(support.row, "Report issue", () => this.owner.supportInfo(), "mod-cta");
		const rec = trace.state();
		const tr = this.card(body, {
			icon: "activity",
			name: "Trace",
			desc: rec.recording
				? `Recording until ${new Date(rec.endsAt ?? Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
				: "Record what Jet does for a few minutes. Never your searches or note names.",
			aliases: "trace record log timeline events slow performance startup debug",
		});
		if (rec.recording) this.button(tr.row, "Stop recording", () => trace.stop("user"));
		else {
			this.dropdown(
				tr.row,
				"traceMinutes",
				TRACE_MINUTES.map((m) => [String(m), `${m} minutes`] as const),
			);
			this.button(tr.row, "Record", () => trace.start(this.owner.data.settings.traceMinutes), "mod-cta");
		}
		this.toggle(
			settingRow(tr.opts(), "Also record the next start", "For a problem at startup. Records once."),
			"traceNextStart",
		);
		const why = this.card(body, {
			icon: "circle-help",
			name: "Why is a note not found?",
			desc: "See why your last search found what it did.",
			aliases: "explain why not found missing note results ranking debug",
		});
		this.button(why.row, "Explain a search", () => this.owner.explainSearch());
		this.card(body, {
			icon: "info",
			name: "Version",
			desc: `${this.owner.manifest.version} (build ${BUILD_ID})`,
		});
	}
}
