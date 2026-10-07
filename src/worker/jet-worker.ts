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
		if (req.op === "query" && queue.some((x) => x.req.op === "query")) {
			scope.postMessage({ id, result: { seq: req.seq, hits: [], terms: [], ms: 0, stale: true } });
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
