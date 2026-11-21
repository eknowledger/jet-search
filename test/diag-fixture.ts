import type { Snapshot } from "../src/diag/report";

export const NOW = new Date(2026, 10, 21, 18, 30).getTime();

export const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
	now: NOW,
	jet: { version: "0.7.1", build: "jetbuild-release" },
	obsidian: { version: "1.15.1", platform: "macOS desktop" },
	index: {
		phase: "live",
		progress: null,
		eligible: 15_000,
		indexed: 14_982,
		bytes: 31_400_000,
		segments: 1,
		pending: 0,
		savedAt: NOW - 4 * 60_000,
	},
	worker: { starts: 2, crashes: 0, sleeps: 1 },
	open: {
		hotkeys: { search: null, inNote: null },
		tapKey: "Shift",
		tapMs: 350,
		tapOwner: "obsidian-doubleshift",
		standIns: 2,
		windowsWatched: 1,
		windowsOpen: 1,
	},
	meaning: { on: true, model: { id: "minilm", bytes: 31_000_000 } },
	scopes: { count: 4, sizes: [120, 2300, 48, 410] },
	settings: { stemming: ["en", "ar"], excerpts: true, excludeRules: 2, newTab: false, preview: true },
	screen: { theme: "dark", vars: { set: 6, of: 6, missing: [] } },
	internals: { found: 12, of: 12, missing: [] },
	problems: [
		{ code: "save.failed", error: "QuotaExceededError", at: new Date(2026, 10, 21, 18, 2).getTime(), count: 1 },
	],
	...over,
});
