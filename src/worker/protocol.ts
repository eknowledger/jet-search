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
	| { op: "query"; seq: number; text: string; limit: number; now: number; allow?: string[] }
	| { op: "mtimes" }
	| { op: "save" }
	| { op: "stats" }
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
			: R extends { op: "stats" }
				? Stats
				: { notes: number };

export type Envelope = { id: number; req: Request };
export type Answer = { id: number; result?: unknown; error?: string };
