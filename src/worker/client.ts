import code from "worker:./worker";
import type { Request } from "./worker";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/**
 * The main thread's end of the search worker. The worker starts on the first
 * call (never at Obsidian's start) and stops with the plugin.
 */
export class SearchClient {
	private worker: Worker | null = null;
	private url: string | null = null;
	private seq = 0;
	private readonly pending = new Map<number, Pending>();

	call<T>(req: Request, transfer: Transferable[] = []): Promise<T> {
		const worker = this.start();
		const id = ++this.seq;
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
			worker.postMessage({ id, req }, transfer);
		});
	}

	get running(): boolean {
		return !!this.worker;
	}

	stop(): void {
		this.worker?.terminate();
		this.worker = null;
		if (this.url) URL.revokeObjectURL(this.url);
		this.url = null;
		for (const p of this.pending.values()) p.reject(new Error("Search stopped"));
		this.pending.clear();
	}

	private start(): Worker {
		if (this.worker) return this.worker;
		this.url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
		const worker = new Worker(this.url, { name: "jet-search" });
		worker.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
			const p = this.pending.get(e.data.id);
			if (!p) return;
			this.pending.delete(e.data.id);
			if (e.data.error !== undefined) p.reject(new Error(e.data.error));
			else p.resolve(e.data.result);
		};
		worker.onerror = (e) => {
			console.error("Jet Search: worker error", e.message);
			for (const p of this.pending.values()) p.reject(new Error(e.message));
			this.pending.clear();
		};
		this.worker = worker;
		return worker;
	}
}
