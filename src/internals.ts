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

export const pluginOn = (app: App, id: string): boolean => !!internals(app).plugins?.enabledPlugins?.has(id);

export const plugin = (app: App, id: string): unknown => internals(app).plugins?.plugins?.[id];

/** This vault's id (one index database per vault); falls back to its name. */
export const vaultId = (app: App): string => internals(app).appId ?? app.vault.getName();

/**
 * Whether another plugin already turns double Shift into a command (then Jet's own
 * detector stays off and that plugin's binding opens Jet through the stand-in command ids).
 */
export const shiftOwnedElsewhere = (app: App): boolean => {
	if (pluginOn(app, "obsidian-doubleshift")) return true;
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
	return !!r.settingsOf?.("commands")?.taps?.some((t) => t.code === "ShiftLeft" || t.code === "ShiftRight");
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
