/**
 * Auto: a scope you set to Auto applies
 * as soon as its name or one of its aliases is typed and followed by a space, in any casing. Whether
 * that is wise depends on how often the name is written outside the scope: ambiguity = notes mentioning
 * the name outside the scope ÷ notes in it. Its settings page warns when that is over 1 (the name is an
 * everyday word there), but the choice is yours. Pure.
 */

/** How many notes mention the name, and how many of those are in the scope (the worker's `mentions`). */
export type Mentions = { notes: number; inside: number };

export const ambiguity = (m: Mentions, members: number): number => (m.notes - m.inside) / Math.max(1, members);

/** Over this, Auto would scope ordinary searches that use the word: the settings page warns. */
export const RISKY = 1;

/** What the settings page says about Auto for a name: rare, common (a warning), or not measured yet. */
export const autoRisk = (amb: number | null): "rare" | "common" | null =>
	amb === null ? null : amb > RISKY ? "common" : "rare";
