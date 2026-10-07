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

export const indexStatus = async (plugin: JetSearchPlugin): Promise<IndexStatus> => {
	const p = plugin.feeder.progress;
	const total = plugin.app.vault.getMarkdownFiles().length;
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
	await plugin.client.call({ op: "clear" });
	plugin.feeder.reset();
	plugin.data.indexedAt = null;
	plugin.save();
	await plugin.feeder.ensure();
};

/** Forget the index on this device (Clear index); it is built again on the next search. */
export const clearIndex = async (plugin: JetSearchPlugin): Promise<void> => {
	await plugin.client.call({ op: "clear" });
	plugin.client.stop();
	plugin.feeder.reset();
	plugin.data.indexedAt = null;
	plugin.save();
};
