import type { Vectors } from "./vectors";

/**
 * Why a search by meaning lists what it does, and where one note stands in it: facts only, computed when
 * asked. It reads the vectors the search reads; nothing in the search calls it.
 */
export type MeaningExplanation = {
	kind: "meaning";
	/** The model is loaded in the worker (meaning is on and ready). */
	on: boolean;
	model: string | null;
	/** Notes with a vector, of the notes the index holds. */
	vectors: { have: number; indexed: number };
	/** The question has words the model knows. */
	understood: boolean;
	list: {
		/** Notes scored (inside the allowed set). */
		scored: number;
		/** What the window lists. */
		k: number;
		best: number | null;
		/** The score of the last note listed. */
		cut: number | null;
	};
	note: {
		indexed: boolean;
		allowed: boolean;
		/** A vector (yes), no word the model knows (none), or not made yet or older than the note (waiting). */
		vector: "yes" | "none" | "waiting";
		rank: number | null;
		score: number | null;
	} | null;
};

export type MeaningFacts = {
	vectors: Vectors;
	model: string;
	/** The question as a unit vector, null when no word of it is known. */
	query: Float32Array | null;
	path: string | null;
	k: number;
	indexed: number;
	/** The index's modified time for the note, undefined when it does not hold it. */
	indexedMtime: number | undefined;
	allow?: (path: string) => boolean;
};

export const explainMeaning = (f: MeaningFacts): MeaningExplanation => {
	const { vectors } = f;
	const all = f.query ? vectors.nearest(f.query, vectors.size, f.allow) : [];
	const kth = all[Math.min(f.k, all.length) - 1];
	const base = {
		kind: "meaning" as const,
		on: true,
		model: f.model,
		vectors: { have: vectors.size, indexed: f.indexed },
		understood: f.query !== null,
		list: { scored: all.length, k: f.k, best: all[0]?.score ?? null, cut: kth?.score ?? null },
	};
	if (f.path === null) return { ...base, note: null };
	const state = vectors.state(f.path);
	const mtime = vectors.mtimeOf(f.path);
	const place = all.findIndex((n) => n.path === f.path);
	return {
		...base,
		note: {
			indexed: f.indexedMtime !== undefined,
			allowed: f.allow ? f.allow(f.path) : true,
			vector:
				state === "missing" || (f.indexedMtime !== undefined && mtime !== f.indexedMtime) ? "waiting" : state,
			rank: place >= 0 ? place + 1 : null,
			score: place >= 0 ? (all[place]?.score ?? null) : null,
		},
	};
};
