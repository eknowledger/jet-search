/**
 * What Jet needs from the engine it runs in, which phones update less often than computers: regex
 * lookbehind (iOS 16.4, Chrome 62), `Array.prototype.at` and `structuredClone` (iOS 15.4, Chrome 98).
 * Older ones would fail in the middle of a search, so Jet says so at start and stays off.
 */
export const MINIMUM = "iOS 16.4 or Android WebView 98";

/** The first thing Jet needs and this engine lacks, or null when it has them all. */
export const missingFeature = (): string | null => {
	try {
		new RegExp("(?<=a)b", "u");
	} catch {
		return "regular expression lookbehind";
	}
	if (typeof Array.prototype.at !== "function") return "Array.prototype.at";
	if (typeof structuredClone !== "function") return "structuredClone";
	return null;
};
