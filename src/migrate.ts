/**
 * Settings imported from Jade's search module, once, when Jet first runs: its
 * "open in a new tab", and its kept last query as the first recent search (Jet has no "keep the last
 * query"; its recents do that job). Once Jet has built an index, its own choices win and nothing is
 * imported. Pure: the caller reads Jade's data.json.
 */
import { type JetData, MAX_SEARCHES } from "./data";

const MARK = "jade-search";

/** Jade's saved data (any shape) → Jet's data, once. True when `data` changed (save it). */
export const importJadeSearch = (data: JetData, jade: unknown): boolean => {
	if (data.imported.includes(MARK) || data.indexedAt !== null) return false;
	data.imported.push(MARK);
	const s = (jade as { modules?: { search?: { settings?: unknown } } } | null)?.modules?.search?.settings;
	if (!s || typeof s !== "object") return true;
	const { newTab, keepQuery, lastQuery } = s as { newTab?: unknown; keepQuery?: unknown; lastQuery?: unknown };
	if (typeof newTab === "boolean") data.settings.newTab = newTab;
	if (
		keepQuery === true &&
		typeof lastQuery === "string" &&
		lastQuery.trim() &&
		!data.searches.includes(lastQuery.trim())
	)
		data.searches = [lastQuery.trim(), ...data.searches].slice(0, MAX_SEARCHES);
	return true;
};
