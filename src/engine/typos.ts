/**
 * Typo search over a sorted word list: a bounded Damerau (optimal string
 * alignment) edit distance walked over the sorted terms. Neighbouring terms share their DP rows for
 * a common prefix; a row whose minimum is over budget skips every term with that prefix; the first
 * letter must match. Also finds fuzzy prefixes: terms whose beginning is within the budget of the
 * typed word (for the word being typed).
 */

export type TypoMatch = { index: number; edits: number; prefix: boolean };

/** Edits allowed for a typed word: none under 4 letters, 1 for 4–8, 2 for 9 or more. */
export const typoBudget = (word: string): number => {
	const n = [...word].length;
	return n < 4 ? 0 : n <= 8 ? 1 : 2;
};

/** The first index in `terms` (sorted) whose term is ≥ `key`. */
export const lowerBound = (terms: readonly string[], key: string, lo = 0, hi = terms.length): number => {
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if ((terms[mid] as string) < key) lo = mid + 1;
		else hi = mid;
	}
	return lo;
};

/** The range [from, to) of sorted `terms` that start with `prefix`. */
export const prefixRange = (terms: readonly string[], prefix: string): [number, number] => {
	const from = lowerBound(terms, prefix);
	return [from, lowerBound(terms, `${prefix}\uffff`, from)];
};

/**
 * Terms within `budget` edits of `word` (excluding the word itself), and, when `fuzzyPrefix`, terms
 * that start with something within `prefixBudget` edits of `word`. Same first letter required.
 * Strings are compared by UTF-16 code unit, as the sorted order is.
 */
export const typoMatches = (
	terms: readonly string[],
	word: string,
	budget: number,
	opts: { fuzzyPrefix?: boolean; prefixBudget?: number; limit?: number } = {},
): TypoMatch[] => {
	const out: TypoMatch[] = [];
	const m = word.length;
	if (!m) return out;
	const pBudget = opts.fuzzyPrefix ? Math.min(opts.prefixBudget ?? 1, budget || 1) : -1;
	const maxBudget = Math.max(budget, pBudget);
	if (maxBudget <= 0) return out;
	const limit = opts.limit ?? 500;
	const [from, to] = prefixRange(terms, word[0] as string);
	// rows[r] = distance between the term's first r letters and each prefix of the word.
	const rows: Int32Array[] = [Int32Array.from({ length: m + 1 }, (_, j) => j)];
	let prev = "";
	for (let i = from; i < to && out.length < limit; i++) {
		const term = terms[i] as string;
		// Rows already computed for the common prefix with the previous term are reused.
		let c = 0;
		const lim = Math.min(prev.length, term.length);
		while (c < lim && prev.charCodeAt(c) === term.charCodeAt(c)) c++;
		let r = Math.min(c, rows.length - 1);
		let pruned = false;
		let prefixHit = -1;
		// A fuzzy prefix found at a depth the previous term shares still holds for this one.
		for (let k = 1; k <= r && pBudget >= 0; k++)
			if (((rows[k] as Int32Array)[m] as number) <= pBudget) {
				prefixHit = (rows[k] as Int32Array)[m] as number;
				break;
			}
		for (; r < term.length; r++) {
			const up = rows[r] as Int32Array;
			const up2 = r > 0 ? (rows[r - 1] as Int32Array) : null;
			const row = rows[r + 1] ?? (rows[r + 1] = new Int32Array(m + 1));
			const tc = term.charCodeAt(r);
			row[0] = r + 1;
			let min = row[0];
			for (let j = 1; j <= m; j++) {
				const wc = word.charCodeAt(j - 1);
				let v = Math.min(
					(up[j] as number) + 1,
					(row[j - 1] as number) + 1,
					(up[j - 1] as number) + (tc === wc ? 0 : 1),
				);
				if (up2 && j > 1 && tc === word.charCodeAt(j - 2) && term.charCodeAt(r - 1) === wc)
					v = Math.min(v, (up2[j - 2] as number) + 1);
				row[j] = v;
				if (v < min) min = v;
			}
			if (prefixHit < 0 && pBudget >= 0 && (row[m] as number) <= pBudget) prefixHit = row[m] as number;
			if (min > maxBudget) {
				pruned = true;
				r++;
				break;
			}
		}
		prev = term.slice(0, r);
		if (pruned) {
			// No term with this prefix can match: jump past all of them (keeping fuzzy-prefix hits found above).
			if (prefixHit >= 0 && term !== word) out.push({ index: i, edits: prefixHit, prefix: true });
			const skipTo = lowerBound(terms, `${term.slice(0, r)}\uffff`, i + 1, to);
			if (prefixHit >= 0)
				for (let k = i + 1; k < skipTo && out.length < limit; k++)
					out.push({ index: k, edits: prefixHit, prefix: true });
			i = skipTo - 1;
			prev = term.slice(0, r);
			continue;
		}
		if (term === word) continue;
		const d = (rows[term.length] as Int32Array)[m] as number;
		if (d <= budget) out.push({ index: i, edits: d, prefix: false });
		else if (prefixHit >= 0) out.push({ index: i, edits: prefixHit, prefix: true });
		prev = term;
	}
	return out;
};

/** Optimal string alignment distance, plainly (for tests). */
export const osaDistance = (a: string, b: string): number => {
	const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
		Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
	);
	for (let i = 1; i <= a.length; i++)
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			let v = Math.min(
				(d[i - 1] as number[])[j]! + 1,
				(d[i] as number[])[j - 1]! + 1,
				(d[i - 1] as number[])[j - 1]! + cost,
			);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
				v = Math.min(v, (d[i - 2] as number[])[j - 2]! + 1);
			(d[i] as number[])[j] = v;
		}
	return (d[a.length] as number[])[b.length] as number;
};
