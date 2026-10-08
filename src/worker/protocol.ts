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
	/** `scope`: only that scope's notes (its set, below); `allow`: only these paths. */
	| { op: "query"; seq: number; text: string; limit: number; now: number; allow?: string[]; scope?: string }
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
	/** Forget this vault's index (settings: Clear index). */
	| { op: "clear" };

export type Stats = { notes: number; segments: number; pending: number; savedAt: number | null; bytes: number };

export type QueryReply = { seq: number; hits: Hit[]; terms: string[]; ms: number; stale?: boolean };

/** What each request answers. */
export type Reply<R extends Request> = R extends { op: "open" }
	? { loaded: boolean; notes: number }
	: R extends { op: "query" }
		? QueryReply
		: R extends { op: "mtimes" }
			? Array<[string, number]>
			: R extends { op: "suggest" }
				? { text: string | null; notes: number }
				: R extends { op: "stats" }
					? Stats
					: { notes: number };

export type Envelope = { id: number; req: Request };
export type Answer = { id: number; result?: unknown; error?: string };
