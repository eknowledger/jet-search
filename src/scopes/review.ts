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
	// Offered before beside a scope you added, and no scope now: you said no (unticked, or deleted it).
	const declined = new Set(scopes.flatMap((s) => s.offered ?? []));
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
		const turnedDown = p.origins.length > 0 && p.origins.every((o) => declined.has(originKey(o)));
		items.push({ state: "new", proposal: p, ticked: p.ticked && !turnedDown });
	}
	for (const s of scopes)
		if (s.source === "generated" && s.origins?.length && !seen.has(s))
			items.push({ state: "gone", scope: s, ticked: false });
	return items;
};

/** The scopes after a review: ticked new ones added, ticked changes applied, ticked gone ones removed. */
export const applyReview = (items: readonly ReviewItem[], scopes: readonly Scope[]): Scope[] => {
	const out = scopes.map((s) => ({ ...s, rules: [...s.rules] }));
	// Every proposal of this review, by its patterns: a scope added remembers its siblings.
	const byPattern = new Map<string, Set<string>>();
	for (const i of items)
		for (const o of i.proposal?.origins ?? []) {
			const k = `${o.signal}|${o.at}`;
			const set = byPattern.get(k) ?? new Set<string>();
			set.add(originKey(o));
			byPattern.set(k, set);
		}
	const offeredBeside = (p: Proposal, had: readonly string[] = []): string[] => {
		const keys = new Set(had);
		for (const o of p.origins) for (const k of byPattern.get(`${o.signal}|${o.at}`) ?? []) keys.add(k);
		return [...keys];
	};
	const find = (s: Scope | undefined): Scope | undefined => (s ? out.find((x) => x.id === s.id) : undefined);
	const ids = new Set(out.map((s) => s.id));
	for (const i of items) {
		if (!i.ticked) continue;
		if (i.state === "changed" && i.proposal) {
			const s = find(i.scope);
			if (!s) continue;
			s.rules.push(...(i.addRules ?? []));
			// What generation gave it before stays known, so a rule you removed is not put back.
			const gen = [...(s.generated ?? [])];
			for (const r of i.proposal.rules.map((x) => x.rule)) if (!gen.some((g) => same(g, r))) gen.push(r);
			s.generated = gen;
			s.origins = i.proposal.origins;
			s.offered = offeredBeside(i.proposal, s.offered);
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
				offered: offeredBeside(p),
			});
		}
	}
	return out;
};
