/**
 * The generator's snapshot from Obsidian: every file, each note's facts from the metadata cache, and
 * the vault's own settings read from its config folder (excluded files, attachments, new-note folder,
 * templates, daily notes, property types). No note is read.
 */
import { type App, moment } from "obsidian";
import { noteFacts } from "./facts";
import { emptyConfig, type Snapshot } from "./snapshot";

const readJson = async (app: App, name: string): Promise<Record<string, unknown>> => {
	try {
		return JSON.parse(await app.vault.adapter.read(`${app.vault.configDir}/${name}`)) as Record<string, unknown>;
	} catch {
		return {};
	}
};

export const obsidianSnapshot = async (app: App, leftOut: readonly string[]): Promise<Snapshot> => {
	const config = emptyConfig();
	const [appJson, templates, templater, daily, types] = await Promise.all([
		readJson(app, "app.json"),
		readJson(app, "templates.json"),
		readJson(app, "plugins/templater-obsidian/data.json"),
		readJson(app, "daily-notes.json"),
		readJson(app, "types.json"),
	]);
	const ignore = Array.isArray(appJson.userIgnoreFilters) ? appJson.userIgnoreFilters : [];
	config.excluded = [...ignore.filter((x): x is string => typeof x === "string"), ...leftOut];
	if (typeof appJson.attachmentFolderPath === "string") config.attachments = appJson.attachmentFolderPath;
	if (appJson.newFileLocation === "folder" && typeof appJson.newFileFolderPath === "string")
		config.inbox = appJson.newFileFolderPath;
	const tpl =
		typeof templates.folder === "string" && templates.folder
			? templates.folder
			: typeof templater.templates_folder === "string" && templater.templates_folder
				? templater.templates_folder
				: null;
	config.templates = tpl;
	if (typeof daily.folder === "string" && daily.folder) config.daily = daily.folder;
	if (types.types && typeof types.types === "object") config.types = types.types as Record<string, string>;
	config.locales = [...new Set(["en", moment.locale()])];
	return {
		notes: app.vault.getMarkdownFiles().map((f) => noteFacts(app, f)),
		files: app.vault.getFiles().map((f) => f.path),
		config,
	};
};
