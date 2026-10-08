/**
 * When Auto may apply a scope without Tab: its name must not hijack an everyday
 * word. ambiguity = notes mentioning the name outside the scope ÷ notes in the scope. Rare names
 * (≤ 1) apply in any casing; a name you write with capitals inside it (OKR, Moonbridge, Amber Studio)
 * applies only as written; any other name stays Suggest. Pure.
 */

/** How many notes mention the name, and how many of those are in the scope (the worker's `mentions`). */
export type Mentions = { notes: number; inside: number };

export const ambiguity = (m: Mentions, members: number): number => (m.notes - m.inside) / Math.max(1, members);

/** A capital after the first letter: an acronym or a camel-cased name, rarely written that way by chance. */
const distinctCasing = (name: string): boolean => /\p{Lu}/u.test([...name].slice(1).join(""));

/** Whether Auto is offered for a name: in any casing, only as written, or not at all (null: not measured yet). */
export const autoOffer = (name: string, amb: number | null): "any" | "case" | "no" => {
	if (amb !== null && amb <= 1) return "any";
	if (amb === null || distinctCasing(name)) return "case";
	return "no";
};

/** Whether typing `typed` (the name as written in the box) applies an Auto scope named `name` at once. */
export const autoApplies = (name: string, typed: string, amb: number | null): boolean => {
	const offer = autoOffer(name, amb);
	if (offer === "any") return true;
	if (offer === "case") return typed.normalize("NFC") === name.normalize("NFC");
	return false;
};
