/**
 * The search worker: holds the index off the main thread. Requests are handled
 * one at a time; a query that a newer query has already replaced is answered as stale without being
 * run (latest wins). Nothing here touches the vault or the DOM.
 */
import type { Answer, Envelope } from "./protocol";
import { Router } from "./router";
import { idbStore, memoryStore } from "./store";

type Scope = { onmessage: ((e: MessageEvent<Envelope>) => void) | null; postMessage(msg: Answer): void };
const scope = self as unknown as Scope;

const worker = self as unknown as { setTimeout(fn: () => void, ms: number): number; clearTimeout(h: number): void };
const router = new Router((vaultId) => (typeof indexedDB === "undefined" ? memoryStore() : idbStore(vaultId)), {
	set: (fn, ms) => worker.setTimeout(fn, ms),
	clear: (h) => worker.clearTimeout(h as number),
});
const queue: Envelope[] = [];
let busy = false;

const pump = async (): Promise<void> => {
	if (busy) return;
	busy = true;
	while (queue.length) {
		const { id, req } = queue.shift() as Envelope;
		// seq 0 is a side count (never stale, never makes another stale).
		if (req.op === "query" && req.seq !== 0 && queue.some((x) => x.req.op === "query" && x.req.seq !== 0)) {
			scope.postMessage({ id, result: { seq: req.seq, hits: [], terms: [], ms: 0, stale: true } });
			continue;
		}
		if (req.op === "nearest" && queue.some((x) => x.req.op === "nearest")) {
			scope.postMessage({ id, result: { seq: req.seq, near: [], ms: 0, stale: true } });
			continue;
		}
		try {
			scope.postMessage({ id, result: await router.handle(req) });
		} catch (err) {
			scope.postMessage({ id, error: err instanceof Error ? (err.stack ?? err.message) : String(err) });
		}
	}
	busy = false;
};

scope.onmessage = (e) => {
	queue.push(e.data);
	void pump();
};
