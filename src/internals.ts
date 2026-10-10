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
	setting?: {
		openPage?: (page: SettingPage) => void;
		closePage?: () => void;
		open?: () => void;
		openTabById?: (id: string) => void;
		modalEl?: HTMLElement;
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

export const plugin = (app: App, id: string): unknown => internals(app).plugins?.plugins?.[id];

/** This vault's id (one index database per vault); falls back to its name. */
export const vaultId = (app: App): string => internals(app).appId ?? app.vault.getName();

/**
 * Whether another plugin already turns double Shift into a command (then Jet's own
 * detector stays off and that plugin's binding opens Jet through the stand-in command ids).
 */
export const tapOwnedElsewhere = (app: App, key: string): boolean => {
	if (key === "Shift" && pluginOn(app, "obsidian-doubleshift")) return true;
	const jade = plugin(app, "jade") as
		| {
				registry?: {
					isRunning?: (id: string) => boolean;
					settingsOf?: (id: string) => { taps?: Array<{ code?: string }> };
				};
		  }
		| undefined;
	const r = jade?.registry;
	if (!r?.isRunning?.("commands")) return false;
	return !!r.settingsOf?.("commands")?.taps?.some((t) => t.code === `${key}Left` || t.code === `${key}Right`);
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
