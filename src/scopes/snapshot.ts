/**
 * What the scope generator reads about a vault: every file's path, each
 * note's facts, and the vault's own settings that describe it. Built from Obsidian (`snapshot-obsidian.ts`)
 * or from files on disk (bench and tests), so the generator runs the same everywhere.
 */
import type { NoteFacts } from "./members";

export type VaultConfig = {
	/** Path prefixes never searched: Obsidian's Excluded files and Jet's folders to leave out. */
	excluded: string[];
	/** The templates folder (core Templates or Templater), if set. */
	templates: string | null;
	/** The attachments folder, if set to a folder. */
	attachments: string | null;
	/** Where new notes land, if set to a folder (the inbox). */
	inbox: string | null;
	/** The daily notes folder, if set. */
	daily: string | null;
	/** Property types from `types.json` (key → "number", "date", "datetime", "checkbox", "multitext"…). */
	types: Record<string, string>;
	/** Locales for month names ("en", the app's language). */
	locales: string[];
};

export type Snapshot = {
	notes: NoteFacts[];
	/** Every file in the vault, notes included (attachments tell attachment folders apart). */
	files: string[];
	config: VaultConfig;
};

export const emptyConfig = (): VaultConfig => ({
	excluded: [],
	templates: null,
	attachments: null,
	inbox: null,
	daily: null,
	types: {},
	locales: ["en"],
});
