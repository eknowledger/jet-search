import { noted } from "./diag/diag";
import type JetSearchPlugin from "./main";

/** The index's health in words: what is indexed, how big, how fresh. */
export type IndexStatus = { state: string; ok: boolean; notes: string; size: string; updated: string };

const ago = (t: number): string => {
	const s = Math.round((Date.now() - t) / 1000);
	if (s < 60) return `${s} s ago`;
	if (s < 3600) return `${Math.round(s / 60)} min ago`;
	if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
	return new Date(t).toLocaleDateString();
};

/** The last stats the worker gave, kept so the settings can show them without waiting (see `statusNow`). */
let lastStats: { notes: number; segments: number; bytes: number; savedAt: number | null; pending: number } | null =
	null;

/** The worker's last stats, if it ever gave any this session (the support info reads them without waking it). */
export const knownStats = (): typeof lastStats => lastStats;

/**
 * The index's status, at once, for the settings tab. It must not change the page after it is drawn:
 * Obsidian 1.13+ re-renders a settings tab when its text changes, and an update that arrives a moment
 * later starts that again, forever. So it shows what is known now, and refreshes the stats in the
 * background for the next time.
 */
export const statusNow = (plugin: JetSearchPlugin): IndexStatus => {
	const p = plugin.feeder.progress;
	// The notes Jet indexes: excluded folders left out.
	const total = plugin.feeder.indexable();
	if (p)
		return {
			state: `Building: ${p.done} of ${p.total} notes`,
			ok: false,
			notes: `${total} notes`,
			size: "—",
			updated: "now",
		};
	if (!plugin.client.running || !lastStats) {
		if (plugin.client.running) void refreshStats(plugin);
		return plugin.data.indexedAt === null
			? { state: "Not built yet", ok: false, notes: `${total} notes`, size: "—", updated: "never" }
			: {
					state: "Saved; loads on the first search",
					ok: true,
					notes: `${total} notes`,
					size: "—",
					updated: ago(plugin.data.indexedAt),
				};
	}
	void refreshStats(plugin);
	const s = lastStats;
	return {
		state: s.pending ? "Up to date (changes saved apart)" : "Index up to date",
		ok: true,
		notes: `${s.notes} of ${total} notes`,
		size: `${(s.bytes / 1e6).toFixed(1)} MB on this device`,
		updated: s.savedAt ? ago(s.savedAt) : "not saved yet",
	};
};

/** Ask a running worker for its numbers (it is not woken: a sleeping one has none to give). */
export const refreshStats = async (plugin: JetSearchPlugin): Promise<void> => {
	try {
		lastStats = await plugin.client.call({ op: "stats" });
	} catch (e) {
		// The worker stopped meanwhile: the next status says so.
		noted("index.stats", e);
	}
};

export const indexStatus = async (plugin: JetSearchPlugin): Promise<IndexStatus> => {
	const p = plugin.feeder.progress;
	// The notes Jet indexes: excluded folders left out.
	const total = plugin.feeder.indexable();
	if (p)
		return {
			state: `Building: ${p.done} of ${p.total} notes`,
			ok: false,
			notes: `${total} notes`,
			size: "—",
			updated: "now",
		};
	if (!plugin.client.running) {
		return plugin.data.indexedAt === null
			? { state: "Not built yet", ok: false, notes: `${total} notes`, size: "—", updated: "never" }
			: {
					state: "Saved; loads on the first search",
					ok: true,
					notes: `${total} notes`,
					size: "—",
					updated: ago(plugin.data.indexedAt),
				};
	}
	const s = await plugin.client.call({ op: "stats" });
	return {
		state: s.pending ? "Up to date (changes saved apart)" : "Index up to date",
		ok: true,
		notes: `${s.notes} of ${total} notes`,
		size: `${(s.bytes / 1e6).toFixed(1)} MB on this device`,
		updated: s.savedAt ? ago(s.savedAt) : "not saved yet",
	};
};

/** Throw the index away and build it again (Rebuild). */
export const rebuild = async (plugin: JetSearchPlugin): Promise<void> => {
	plugin.wake();
	await plugin.client.call({ op: "clear", vaultId: plugin.feeder.vault });
	plugin.feeder.reset();
	plugin.data.indexedAt = null;
	plugin.save();
	await plugin.feeder.ensure();
};

/** Forget the index on this device (Clear index); it is built again on the next search. */
export const clearIndex = async (plugin: JetSearchPlugin): Promise<void> => {
	await plugin.client.call({ op: "clear", vaultId: plugin.feeder.vault });
	plugin.client.stop();
	plugin.feeder.reset();
	plugin.data.indexedAt = null;
	plugin.save();
};
