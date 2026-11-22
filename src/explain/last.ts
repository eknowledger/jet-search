import type { Explained } from "./explainer";

/**
 * The explanation the user chose to add to the support info, kept in memory until Jet unloads. Nothing runs
 * here: it is set when the button is pressed and read when a report is built.
 */
let kept: Explained | null = null;

export const keepExplained = (e: Explained | null): void => {
	kept = e;
};

export const keptExplained = (): Explained | null => kept;
