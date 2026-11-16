import type { AnswerCandidate, AnswerResult } from "../answers/answers";
import type { RawNote } from "../engine/fields";
import type { Hit } from "../engine/jet-engine";

/**
 * Messages between the main thread and the search worker. Every request carries
 * an id; queries also carry a `seq`, and only the latest query's answer matters.
 */
export type Request =
	/** Open the vault's saved index, if any. */
	| { op: "open"; vaultId: string; stemming: string[] }
	/** Settings changed: the stemming languages. */
	| { op: "configure"; stemming: string[] }
	/** A first build's batch (newest notes first); `last` closes the build: merge and save. */
	| { op: "batch"; notes: RawNote[]; last: boolean }
	| { op: "upsert"; notes: RawNote[] }
	| { op: "delete"; paths: string[] }
	| { op: "rename"; from: string; to: string }
	/** `scope`: only that scope's notes (its set, below), or any of several scopes'; `allow`: only these paths. */
	| {
			op: "query";
			seq: number;
			text: string;
			limit: number;
			now: number;
			allow?: string[];
			scope?: string | string[];
	  }
	| { op: "mtimes" }
	/** No results: the closest spelling the vault uses, and how many notes it finds. */
	| { op: "suggest"; text: string }
	| { op: "save" }
	| { op: "stats" }
	/** A scope's notes, as paths; kept through renames and deletes. Not saved. */
	| { op: "scope:set"; id: string; paths: string[] }
	| { op: "scope:delta"; id: string; add: string[]; remove: string[] }
	/** Drop these scopes' sets (all of them without `ids`). */
	| { op: "scope:clear"; ids?: string[] }
	/** How many notes mention a name (its words exactly), and how many of them are in a scope. */
	| { op: "mentions"; text: string; scope?: string }
	/** Forget this vault's index (settings: Clear index). */
	/** The vault's id: a worker that was never opened (asleep) still clears what is saved. */
	| { op: "clear"; vaultId?: string }
	/**
	 * Search by meaning: the packed model (Jet's file); from then on every note sent gets a
	 * vector, and the saved vectors of this model are loaded. Answers how many notes still lack one.
	 */
	| { op: "meaning:load"; buf: ArrayBuffer; model: string }
	/** Off: the model and vectors leave memory; `forget` also deletes the saved vectors. */
	| { op: "meaning:off"; forget?: boolean }
	/** Vectors for notes the index already has (turned on later, or a vector is stale). */
	| { op: "meaning:embed"; notes: RawNote[] }
	/** The notes whose vector is missing or older than the note. */
	| { op: "meaning:missing" }
	/** The notes nearest to a question, best first (`scope` / `allow` as for a query). */
	| { op: "nearest"; seq: number; text: string; k: number; allow?: string[]; scope?: string | string[] }
	/**
	 * Answers (experiment): where a question's answer is looked for: the first `k` notes by its content
	 * words (notes with some of them too) and the first `k` by meaning (none while meaning is off).
	 */
	| { op: "answers:pool"; text: string; k: number; allow?: string[]; scope?: string | string[] }
	/** Answers (experiment): the notes sent, re-ranked by the line that best answers the question. */
	| { op: "answers:rank"; seq: number; text: string; notes: AnswerCandidate[]; meaning: string[] };

export type Stats = { notes: number; segments: number; pending: number; savedAt: number | null; bytes: number };

export type QueryReply = {
	seq: number;
	hits: Hit[];
	terms: string[];
	/** Every word of the query is rare in the vault: the notes that hold it exactly come first. */
	rare?: boolean;
	ms: number;
	stale?: boolean;
	/** The index could not be read: it was dropped, and the plugin builds it again. */
	broken?: boolean;
};
export type NearReply = { seq: number; near: Array<{ path: string; score: number }>; ms: number; stale?: boolean };
export type AnswerPoolReply = { words: string[]; meaning: string[] };
/** The notes with their lines, best first, and the order to show them in. */
export type AnswersReply = { seq: number; ranked: AnswerResult[]; order: string[]; ms: number; stale?: boolean };

/** What each request answers. */
export type Reply<R extends Request> = R extends { op: "open" }
	? { loaded: boolean; notes: number }
	: R extends { op: "query" }
		? QueryReply
		: R extends { op: "nearest" }
			? NearReply
			: R extends { op: "answers:pool" }
				? AnswerPoolReply
				: R extends { op: "answers:rank" }
					? AnswersReply
					: R extends { op: "meaning:missing" }
						? string[]
						: R extends { op: "meaning:load" }
							? { notes: number; missing: number; vectors: number }
							: R extends { op: "mtimes" }
								? Array<[string, number]>
								: R extends { op: "suggest" }
									? { text: string | null; notes: number }
									: R extends { op: "stats" }
										? Stats
										: R extends { op: "mentions" }
											? { notes: number; inside: number }
											: { notes: number };

export type Envelope = { id: number; req: Request };
export type Answer = { id: number; result?: unknown; error?: string };
