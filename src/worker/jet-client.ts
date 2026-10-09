import code from "worker:./jet-worker";
import type { Answer, NearReply, QueryReply, Reply, Request } from "./protocol";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/**
 * The main thread's end of the search worker. The worker starts on the first call (never at
 * Obsidian's start), and stops with the plugin or when asked (asleep after idle).
 * Queries carry a sequence number; an answer for an older query than the latest is dropped.
 */
export class JetClient {
	private worker: Worker | null = null;
	private url: string | null = null;
	private id = 0;
	private seq = 0;
	private readonly pending = new Map<number, Pending>();
	/** Called when the worker fails; the caller restarts it. */
	onCrash: ((message: string) => void) | null = null;

	get running(): boolean {
		return !!this.worker;
	}

	call<R extends Request>(req: R, transfer: Transferable[] = []): Promise<Reply<R>> {
		const worker = this.start();
		const id = ++this.id;
		return new Promise<Reply<R>>((resolve, reject) => {
			this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
			worker.postMessage({ id, req }, transfer);
		});
	}

	/** Ask a query; resolves with its answer, or null if a newer query was asked meanwhile. */
	async query(
		text: string,
		opts: { limit?: number; allow?: string[]; scope?: string } = {},
	): Promise<QueryReply | null> {
		const seq = ++this.seq;
		const r = await this.call({
			op: "query",
			seq,
			text,
			limit: opts.limit ?? 50,
			now: Date.now(),
			allow: opts.allow,
			scope: opts.scope,
		});
		return r.stale || r.seq !== this.seq ? null : r;
	}

	/**
	 * A side count (how many notes outside a scope): answered in turn, outside latest-wins, so it never
	 * cancels the query you typed after it.
	 */
	async count(text: string, opts: { limit?: number } = {}): Promise<QueryReply> {
		return this.call({ op: "query", seq: 0, text, limit: opts.limit ?? 50, now: Date.now() });
	}

	/** The notes nearest a question; null if a newer query or question was asked meanwhile. */
	async nearest(
		text: string,
		opts: { k?: number; allow?: string[]; scope?: string } = {},
	): Promise<NearReply | null> {
		const seq = ++this.seq;
		const r = await this.call({ op: "nearest", seq, text, k: opts.k ?? 50, allow: opts.allow, scope: opts.scope });
		return r.stale || r.seq !== this.seq ? null : r;
	}

	stop(): void {
		this.worker?.terminate();
		this.worker = null;
		if (this.url) URL.revokeObjectURL(this.url);
		this.url = null;
		for (const p of this.pending.values()) p.reject(new Error("Jet Search: the worker stopped"));
		this.pending.clear();
	}

	private start(): Worker {
		if (this.worker) return this.worker;
		this.url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
		const worker = new Worker(this.url, { name: "jet-search" });
		worker.onmessage = (e: MessageEvent<Answer>) => {
			const p = this.pending.get(e.data.id);
			if (!p) return;
			this.pending.delete(e.data.id);
			if (e.data.error !== undefined) p.reject(new Error(e.data.error));
			else p.resolve(e.data.result);
		};
		worker.onerror = (e) => {
			const message = e.message || "worker error";
			console.error("Jet Search: worker error", message);
			this.stop();
			this.onCrash?.(message);
		};
		this.worker = worker;
		return worker;
	}
}
