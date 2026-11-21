import { Platform, apiVersion } from "obsidian";
import type JetSearchPlugin from "../main";
import { BUILD_ID } from "../build-id";
import { knownStats } from "../index-status";
import { hotkeyLabel, internalsFound, tapOwnerElsewhere } from "../internals";
import { diag } from "./diag";
import type { Phase, Snapshot } from "./report";

/** The theme variables Jet's own styles lean on. A missing one means a theme or Obsidian version Jet draws badly in. */
const THEME_VARS = [
	"--text-normal",
	"--text-muted",
	"--background-secondary",
	"--background-modifier-border",
	"--background-modifier-hover",
	"--interactive-accent-hsl",
] as const;

const platformName = (): string => {
	const os = Platform.isMacOS
		? "macOS"
		: Platform.isWin
			? "Windows"
			: Platform.isLinux
				? "Linux"
				: Platform.isIosApp
					? "iOS"
					: Platform.isAndroidApp
						? "Android"
						: "unknown OS";
	const kind = Platform.isPhone ? "phone" : Platform.isTablet ? "tablet" : Platform.isMobile ? "mobile" : "desktop";
	return `${os} ${kind}`;
};

const phaseOf = (plugin: JetSearchPlugin): Phase => {
	if (plugin.feeder.progress) return "building";
	if (!plugin.client.running) return plugin.data.indexedAt === null ? "never-built" : "asleep";
	return "live";
};

/**
 * Everything the report says, read at this moment. It never wakes the worker, reads no note and sends
 * nothing: it looks at state Jet already holds. Names of notes, folders and scopes are not read at all.
 */
export const collect = (plugin: JetSearchPlugin, now = Date.now()): Snapshot => {
	const s = plugin.data.settings;
	const stats = knownStats();
	const jetId = plugin.manifest.id;
	// Who handles the double tap: Jade says when it knows; otherwise the settings of other plugins are read.
	const mine = plugin.jade?.ownsTap(s.tapKey);
	const owner =
		s.tapKey === "off" || mine === false ? null : mine === true ? "jade" : tapOwnerElsewhere(plugin.app, s.tapKey);
	const style = getComputedStyle(activeDocument.body);
	const missingVars = THEME_VARS.filter((v) => style.getPropertyValue(v).trim() === "");
	const keys = plugin.keyFacts();
	const internals = internalsFound(plugin.app);
	return {
		now,
		jet: { version: plugin.manifest.version, build: BUILD_ID },
		obsidian: { version: apiVersion, platform: platformName() },
		index: {
			phase: phaseOf(plugin),
			progress: plugin.feeder.progress,
			eligible: plugin.feeder.indexable(),
			indexed: stats?.notes ?? null,
			bytes: stats?.bytes ?? null,
			segments: stats?.segments ?? null,
			pending: stats?.pending ?? null,
			savedAt: stats?.savedAt ?? null,
		},
		worker: { starts: diag.workerStarts, crashes: diag.workerCrashes, sleeps: diag.sleeps },
		open: {
			hotkeys: {
				search: hotkeyLabel(plugin.app, `${jetId}:open`),
				inNote: hotkeyLabel(plugin.app, `${jetId}:open-in-note`),
			},
			tapKey: s.tapKey,
			tapMs: s.shiftInterval,
			tapOwner: owner,
			standIns: keys.standIns,
			windowsWatched: keys.windowsWatched,
			windowsOpen: keys.windowsOpen,
		},
		meaning: { on: s.meaning, model: plugin.data.meaningModel },
		scopes: {
			count: plugin.data.scopes.length,
			sizes: plugin.scopes.ready ? plugin.data.scopes.map((x) => plugin.scopes.count(x.id)) : null,
		},
		settings: {
			stemming: [...s.stemming],
			excerpts: s.excerpts,
			excludeRules: s.exclude.length,
			newTab: s.newTab,
			preview: s.preview,
		},
		screen: {
			theme: activeDocument.body.classList.contains("theme-light") ? "light" : "dark",
			vars: { set: THEME_VARS.length - missingVars.length, of: THEME_VARS.length, missing: missingVars },
		},
		internals,
		problems: diag.problems.map((p) => ({ ...p })),
	};
};
