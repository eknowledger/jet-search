import type { App, Command, SettingPage } from "obsidian";

/** The few undocumented Obsidian internals Jet touches, typed loosely and always optional. */
type Internals = {
	commands?: {
		commands?: Record<string, unknown>;
		addCommand?: (command: Command) => void;
		removeCommand?: (id: string) => void;
	};
	plugins?: {
		plugins?: Record<string, unknown>;
		enabledPlugins?: Set<string>;
	};
	appId?: string;
	customCss?: { theme?: string; enabledSnippets?: Set<string> };
	setting?: {
		openPage?: (page: SettingPage) => void;
		closePage?: () => void;
		open?: () => void;
		openTabById?: (
			id: string,
		) => { searchComponent?: { setValue(v: string): void; inputEl?: HTMLInputElement } } | void;
		modalEl?: HTMLElement;
		activeTab?: unknown;
	};
	hotkeyManager?: {
		printHotkeyForCommand?: (id: string) => string;
	};
};

const internals = (app: App): Internals => app as unknown as Internals;

export const hasCommand = (app: App, id: string): boolean => !!internals(app).commands?.commands?.[id];

/** Register a command under a full id of our choosing: another plugin's, while it is off. */
export const addCommandAs = (app: App, command: Command): boolean => {
	const c = internals(app).commands;
	if (!c?.addCommand) return false;
	c.addCommand(command);
	return true;
};

export const removeCommand = (app: App, id: string): void => internals(app).commands?.removeCommand?.(id);

/** The command registered under an id now (another plugin may have put its own there since). */
export const commandAt = (app: App, id: string): unknown => internals(app).commands?.commands?.[id];

export const pluginOn = (app: App, id: string): boolean => !!internals(app).plugins?.enabledPlugins?.has(id);

/** The ids of the community plugins that are on. */
export const enabledPluginIds = (app: App): string[] => [...(internals(app).plugins?.enabledPlugins ?? [])].sort();

/** The community theme in use (null: the default) and how many CSS snippets are on. Names of themes are public. */
export const appearanceFacts = (app: App): { theme: string | null; snippets: number } => {
	const css = internals(app).customCss;
	return { theme: css?.theme || null, snippets: css?.enabledSnippets?.size ?? 0 };
};

export const plugin = (app: App, id: string): unknown => internals(app).plugins?.plugins?.[id];

/** This vault's id (one index database per vault); falls back to its name. */
export const vaultId = (app: App): string => internals(app).appId ?? app.vault.getName();

/**
 * The plugin that already turns a double tap of this key into a command, or null (then Jet's own
 * detector stays off and that plugin's binding opens Jet through the stand-in command ids).
 */
export const tapOwnerElsewhere = (app: App, key: string): string | null => {
	if (key === "Shift" && pluginOn(app, "obsidian-doubleshift")) return "obsidian-doubleshift";
	const jade = plugin(app, "jade") as
		| {
				registry?: {
					isRunning?: (id: string) => boolean;
					settingsOf?: (id: string) => { taps?: Array<{ code?: string }> };
				};
		  }
		| undefined;
	const r = jade?.registry;
	if (!r?.isRunning?.("commands")) return null;
	return r.settingsOf?.("commands")?.taps?.some((t) => t.code === `${key}Left` || t.code === `${key}Right`)
		? "jade"
		: null;
};

export const tapOwnedElsewhere = (app: App, key: string): boolean => tapOwnerElsewhere(app, key) !== null;

/** The internals Jet relies on, each with how to tell it is there. The support info lists which are missing. */
const PROBES: ReadonlyArray<readonly [string, (i: Internals) => boolean]> = [
	["commands.commands", (i) => typeof i.commands?.commands === "object" && i.commands.commands !== null],
	["commands.addCommand", (i) => typeof i.commands?.addCommand === "function"],
	["commands.removeCommand", (i) => typeof i.commands?.removeCommand === "function"],
	["plugins.plugins", (i) => typeof i.plugins?.plugins === "object" && i.plugins.plugins !== null],
	["plugins.enabledPlugins", (i) => i.plugins?.enabledPlugins instanceof Set],
	["appId", (i) => typeof i.appId === "string" && i.appId !== ""],
	["setting.open", (i) => typeof i.setting?.open === "function"],
	["setting.openTabById", (i) => typeof i.setting?.openTabById === "function"],
	["setting.openPage", (i) => typeof i.setting?.openPage === "function"],
	["setting.closePage", (i) => typeof i.setting?.closePage === "function"],
	["hotkeyManager.printHotkeyForCommand", (i) => typeof i.hotkeyManager?.printHotkeyForCommand === "function"],
];

/** Which of the internals are there on this Obsidian (a missing one is a likely cause of "does nothing"). */
export const internalsFound = (app: App): { found: number; of: number; missing: string[] } => {
	const i = internals(app);
	const missing = PROBES.filter(([, ok]) => !ok(i)).map(([name]) => name);
	return { found: PROBES.length - missing.length, of: PROBES.length, missing };
};

/**
 * Open a settings sub-page from code (a button), as Obsidian's own navigable rows do. Internal API
 * (Obsidian 1.13+); false when missing, and the caller falls back to a navigable row.
 */
export const openSettingPage = (app: App, page: SettingPage): boolean => {
	const s = internals(app).setting;
	if (!s?.openPage) return false;
	s.openPage(page);
	return true;
};

/** Go back one settings sub-page (after deleting the scope the page showed). */
export const closeSettingPage = (app: App): void => internals(app).setting?.closePage?.();

/**
 * Open Jet's settings at a sub-page chain (["Scopes", "Cobalt"]) by choosing each navigable row, as
 * you would. Stops at the first row it cannot find (settings stay open where they are).
 */
export const openSettingsAt = (app: App, tab: string, rows: readonly string[]): void => {
	const s = internals(app).setting;
	if (!s?.open || !s.openTabById) return;
	s.open();
	s.openTabById(tab);
	const step = (i: number): void => {
		const name = rows[i];
		if (name === undefined) return;
		window.setTimeout(() => {
			const row = [...(s.modalEl?.querySelectorAll<HTMLElement>(".setting-item.mod-navigable") ?? [])].find(
				(r) => r.querySelector(".setting-item-name")?.textContent?.trim() === name,
			);
			if (!row) return;
			row.click();
			step(i + 1);
		}, 120);
	};
	step(0);
};

/** The hotkey Obsidian's Hotkeys give a command, as it prints it (""/null: none). Internal API. */
export const hotkeyLabel = (app: App, id: string): string | null => {
	try {
		return internals(app).hotkeyManager?.printHotkeyForCommand?.(id) || null;
	} catch {
		return null;
	}
};

/** Open Obsidian's Hotkeys, showing only the commands matching `filter` (Jet's). Internal API. */
export const openHotkeys = (app: App, filter: string): void => {
	const s = internals(app).setting;
	const tab = s?.openTabById?.("hotkeys");
	if (!tab) return;
	// The Hotkeys tab filters on its search box's input event (checked on Obsidian 1.14).
	tab.searchComponent?.setValue(filter);
	tab.searchComponent?.inputEl?.dispatchEvent(new Event("input"));
};

/** Open the settings at Jet's tab; returns the tab Obsidian shows. Internal API. */
export const openJetSettings = (app: App, id: string): unknown => {
	const s = internals(app).setting;
	if (!s?.open || !s.openTabById) return null;
	s.open();
	s.openTabById(id);
	return s.activeTab ?? null;
};
