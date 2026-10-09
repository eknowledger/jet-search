/**
 * Generating again: the generator's proposals compared with
 * the scopes you have, by where they were found. New: ticked as proposed. Changed: a generated scope
 * gains a rule it did not have when generated (ticked); a rule you removed is never put back. Gone:
 * its source no longer exists (unticked: removing is your call). Covered: a scope of yours already has
 * the name. Unchanged: only counted. Your edits (name, aliases, mode, rules) are kept.
 */
import type { Proposal } from "./generate";
import { type Rule, type Scope, scopeId } from "./model";
import { fold } from "./names";

export type ReviewItem = {
	state: "new" | "changed" | "gone" | "unchanged" | "covered";
	proposal?: Proposal;
	scope?: Scope;
	/** Changed: the rules to add. */
	addRules?: Rule[];
	ticked: boolean;
};

const same = (a: Rule, b: Rule): boolean => JSON.stringify(a) === JSON.stringify(b);
const originKey = (o: { signal: string; at: string; key: string }): string => `${o.signal}|${o.at}|${o.key}`;

export const review = (proposals: readonly Proposal[], scopes: readonly Scope[]): ReviewItem[] => {
	const byOrigin = new Map<string, Scope>();
	for (const s of scopes) for (const o of s.origins ?? []) byOrigin.set(originKey(o), s);
	const names = new Map<string, Scope>();
	for (const s of scopes) for (const n of [s.name, ...s.aliases]) names.set(fold(n), s);
	const items: ReviewItem[] = [];
	const seen = new Set<Scope>();
	for (const p of proposals) {
		const s = p.origins.map((o) => byOrigin.get(originKey(o))).find((x) => x !== undefined);
		if (s && !seen.has(s)) {
			seen.add(s);
			const had = [...s.rules, ...(s.generated ?? [])];
			const addRules = p.rules.map((r) => r.rule).filter((r) => !had.some((x) => same(x, r)));
			items.push(
				addRules.length
					? { state: "changed", proposal: p, scope: s, addRules, ticked: true }
					: { state: "unchanged", proposal: p, scope: s, ticked: false },
			);
			continue;
		}
		if (s) continue;
		const covered = names.get(fold(p.name));
		if (covered) {
			items.push({ state: "covered", proposal: p, scope: covered, ticked: false });
			continue;
		}
		items.push({ state: "new", proposal: p, ticked: p.ticked });
	}
	for (const s of scopes)
		if (s.source === "generated" && s.origins?.length && !seen.has(s))
			items.push({ state: "gone", scope: s, ticked: false });
	return items;
};

/** The scopes after a review: ticked new ones added, ticked changes applied, ticked gone ones removed. */
export const applyReview = (items: readonly ReviewItem[], scopes: readonly Scope[]): Scope[] => {
	const out = scopes.map((s) => ({ ...s, rules: [...s.rules] }));
	const find = (s: Scope | undefined): Scope | undefined => (s ? out.find((x) => x.id === s.id) : undefined);
	const ids = new Set(out.map((s) => s.id));
	for (const i of items) {
		if (!i.ticked) continue;
		if (i.state === "changed" && i.proposal) {
			const s = find(i.scope);
			if (!s) continue;
			s.rules.push(...(i.addRules ?? []));
			s.generated = i.proposal.rules.map((r) => r.rule);
			s.origins = i.proposal.origins;
		} else if (i.state === "gone") {
			const s = find(i.scope);
			if (s) out.splice(out.indexOf(s), 1);
		} else if (i.state === "new" && i.proposal) {
			const p = i.proposal;
			const rules = p.rules.map((r) => r.rule);
			let id = p.id || scopeId(p.name, rules);
			for (let n = 2; ids.has(id); n++) id = `${p.id}-${n}`;
			ids.add(id);
			out.push({
				id,
				name: p.name,
				aliases: [...p.aliases],
				kind: p.kind,
				rules,
				combine: "any",
				mode: "default",
				source: "generated",
				origins: p.origins,
				generated: rules,
			});
		}
	}
	return out;
};
