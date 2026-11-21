import { Platform, apiVersion } from "obsidian";
import type JetSearchPlugin from "../main";
import { BUILD_ID } from "../build-id";
import { knownStats } from "../index-status";
import { appearanceFacts, enabledPluginIds, hotkeyLabel, internalsFound, tapOwnerElsewhere } from "../internals";
import { diag } from "./diag";
import { NO_OPTIONS, type Phase, type ReportOptions, type Snapshot } from "./report";

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

/** "Electron 39, Chrome 142", where the app can say it (desktop; a phone has no `process`). */
const shellName = (): string | null => {
	const v = (window as unknown as { process?: { versions?: Record<string, string | undefined> } }).process?.versions;
	const major = (x: string | undefined): string | undefined => x?.split(".")[0];
	const parts = [
		major(v?.electron) && `Electron ${major(v?.electron)}`,
		major(v?.chrome) && `Chrome ${major(v?.chrome)}`,
	];
	const named = parts.filter(Boolean);
	return named.length ? named.join(", ") : null;
};

type Heap = { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } };

const phaseOf = (plugin: JetSearchPlugin): Phase => {
	if (plugin.feeder.progress) return "building";
	if (!plugin.client.running) return plugin.data.indexedAt === null ? "never-built" : "asleep";
	return "live";
};

/**
 * Everything the report says, read at this moment. It never wakes the worker, reads no note and sends
 * nothing: it looks at state Jet already holds. Names of notes and folders are not read at all; scope and
 * plugin names are read only when the user ticked them.
 */
export const collect = (plugin: JetSearchPlugin, now = Date.now(), opts: ReportOptions = NO_OPTIONS): Snapshot => {
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
	const look = appearanceFacts(plugin.app);
	const plugins = enabledPluginIds(plugin.app);
	const heap = (performance as unknown as Heap).memory;
	const nav = navigator as Navigator & { deviceMemory?: number };
	const win = activeDocument.defaultView ?? window;
	return {
		now,
		jet: { version: plugin.manifest.version, build: BUILD_ID },
		obsidian: { version: apiVersion, platform: platformName(), shell: shellName() },
		device: {
			cores: nav.hardwareConcurrency || null,
			memoryGb: nav.deviceMemory ?? null,
			language: nav.language || "unknown",
			window: { width: win.innerWidth, height: win.innerHeight, scale: win.devicePixelRatio || 1 },
			heap: heap ? { used: heap.usedJSHeapSize, limit: heap.jsHeapSizeLimit } : null,
		},
		vault: {
			notes: plugin.app.vault.getMarkdownFiles().length,
			files: plugin.app.vault.getFiles().length,
			plugins: plugins.length,
			pluginNames: opts.pluginNames ? plugins : null,
		},
		appearance: {
			theme: activeDocument.body.classList.contains("theme-light") ? "light" : "dark",
			name: look.theme,
			snippets: look.snippets,
			missingVars,
		},
		index: {
			phase: phaseOf(plugin),
			progress: plugin.feeder.progress,
			eligible: plugin.feeder.indexable(),
			indexed: stats?.notes ?? null,
			bytes: stats?.bytes ?? null,
			segments: stats?.segments ?? null,
			pending: stats?.pending ?? null,
			savedAt: stats?.savedAt ?? null,
			opened: diag.opened,
		},
		worker: {
			running: plugin.client.running,
			since: diag.workerSince,
			starts: diag.workerStarts,
			crashes: diag.workerCrashes,
			sleeps: diag.sleeps,
		},
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
			names: opts.scopeNames ? plugin.data.scopes.map((x) => x.name) : null,
		},
		settings: {
			newTab: s.newTab,
			preview: s.preview,
			excerpts: s.excerpts,
			fixKeys: s.fixKeys,
			stemming: [...s.stemming],
			excludeRules: s.exclude.length,
			questionShows: s.questionShows,
			bothLayout: s.bothLayout,
			meaningLong: s.meaningLong,
			answers: s.answers,
			scopesWhenNew: s.scopesWhenNew,
			scopeMode: s.scopeMode,
			scopeAnother: s.scopeAnother,
			persistFilters: s.persistFilters,
			keysChanged: Object.keys(s.keys).length,
			recentSearches: plugin.data.searches.length,
			openedNotes: Object.keys(plugin.data.opened).length,
		},
		internals,
		problems: diag.problems.map((p) => ({ ...p })),
	};
};
