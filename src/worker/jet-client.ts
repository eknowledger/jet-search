import code from "worker:./jet-worker";
import { diag } from "../diag/diag";
import type { AnswerCandidate } from "../answers/answers";
import type { Answer, AnswerPoolReply, AnswersReply, NearReply, QueryReply, Reply, Request } from "./protocol";

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
	/**
	 * Questions count apart from queries: both are asked for one search when words and meaning show at
	 * once, and a shared count made the question cancel the words.
	 */
	private nearSeq = 0;
	/** Answers (experiment) count apart too: a re-rank cancels only an older re-rank. */
	private answerSeq = 0;
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
		opts: { limit?: number; allow?: string[]; scope?: string | string[] } = {},
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

	/**
	 * The notes nearest a question; null if a newer question was asked meanwhile. A newer query does
	 * not cancel it (the caller drops answers for a text no longer in the box).
	 */
	async nearest(
		text: string,
		opts: { k?: number; allow?: string[]; scope?: string | string[] } = {},
	): Promise<NearReply | null> {
		const seq = ++this.nearSeq;
		const r = await this.call({ op: "nearest", seq, text, k: opts.k ?? 50, allow: opts.allow, scope: opts.scope });
		return r.stale || r.seq !== this.nearSeq ? null : r;
	}

	/** Answers (experiment): where the question's answer is looked for, by its words and by meaning. */
	answerPool(
		text: string,
		opts: { k?: number; allow?: string[]; scope?: string | string[] } = {},
	): Promise<AnswerPoolReply> {
		return this.call({ op: "answers:pool", text, k: opts.k ?? 50, allow: opts.allow, scope: opts.scope });
	}

	/** Answers (experiment): the notes re-ranked by their best line; null if a newer re-rank was asked. */
	async answers(text: string, notes: AnswerCandidate[], meaning: string[]): Promise<AnswersReply | null> {
		const seq = ++this.answerSeq;
		const r = await this.call({ op: "answers:rank", seq, text, notes, meaning });
		return r.stale || r.seq !== this.answerSeq ? null : r;
	}

	stop(): void {
		this.worker?.terminate();
		this.worker = null;
		diag.workerStopped();
		if (this.url) URL.revokeObjectURL(this.url);
		this.url = null;
		for (const p of this.pending.values()) p.reject(new Error("Jet Search: the worker stopped"));
		this.pending.clear();
	}

	private start(): Worker {
		if (this.worker) return this.worker;
		this.url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
		const worker = new Worker(this.url, { name: "jet-search" });
		diag.workerStarted();
		worker.onmessage = (e: MessageEvent<Answer>) => {
			const m = e.data;
			if (m.event) {
				diag.workerEvent(m.event);
				return;
			}
			const p = this.pending.get(m.id);
			if (!p) return;
			this.pending.delete(m.id);
			if (m.error !== undefined) {
				// The error keeps its class and the place it was thrown in the worker, for the support info.
				const err = new Error(m.error) as Error & { where?: string | null };
				err.name = m.name ?? "Error";
				err.where = m.where ?? null;
				p.reject(err);
			} else p.resolve(m.result);
		};
		worker.onerror = (e) => {
			const message = e.message || "worker error";
			console.error("Jet Search: worker error", message);
			diag.workerCrashed();
			// The message can carry text from a note, so only its class (`TypeError: ...`) and the place in the worker are kept.
			const name = /^(?:Uncaught )?([A-Za-z]*Error)\b/.exec(message)?.[1] ?? "Error";
			const where = e.lineno ? `worker:${e.lineno}:${e.colno}` : null;
			const kind = new Error();
			kind.name = name;
			diag.problem("worker.error", kind, "error", where);
			this.stop();
			this.onCrash?.(message);
		};
		this.worker = worker;
		return worker;
	}
}
