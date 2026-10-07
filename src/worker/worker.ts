/**
 * The search worker: holds the index off the main thread. The main thread
 * sends notes' text and queries; nothing here touches the vault or the DOM.
 */
import { SearchIndex } from "../engine/search-index";
import { noteFields, parseQuery } from "../engine/text";

export type Request =
	| { op: "load"; buf: ArrayBuffer | null }
	| { op: "upsert"; notes: Array<{ path: string; mtime: number; text: string }> }
	| { op: "remove"; paths: string[] }
	| { op: "rename"; from: string; to: string }
	| { op: "search"; q: string; limit: number; now: number }
	| { op: "mtimes" }
	| { op: "save" }
	| { op: "freeze" }
	| { op: "stats" };

type Scope = {
	onmessage: ((e: MessageEvent<{ id: number; req: Request }>) => void) | null;
	postMessage(msg: unknown, transfer?: Transferable[]): void;
};
const scope = self as unknown as Scope;

let index = new SearchIndex();

const handle = (req: Request): { result: unknown; transfer?: Transferable[] } => {
	switch (req.op) {
		case "load": {
			const loaded = req.buf ? SearchIndex.deserialize(req.buf) : null;
			index = loaded ?? new SearchIndex();
			return { result: !!loaded };
		}
		case "upsert":
			for (const n of req.notes) index.upsert(n.path, n.mtime, noteFields(n.path, n.text));
			return { result: index.size };
		case "remove":
			for (const p of req.paths) index.remove(p);
			return { result: index.size };
		case "rename":
			index.rename(req.from, req.to);
			return { result: true };
		case "search":
			return { result: index.search(parseQuery(req.q), { limit: req.limit, now: req.now }) };
		case "mtimes":
			return { result: index.paths().map((p) => [p, index.mtimeOf(p) ?? 0]) };
		case "save": {
			const buf = index.serialize();
			return { result: buf, transfer: [buf] };
		}
		case "freeze":
			index.freeze();
			return { result: true };
		case "stats":
			return { result: { notes: index.size, terms: index.termCount } };
	}
};

scope.onmessage = (e) => {
	const { id, req } = e.data;
	try {
		const { result, transfer } = handle(req);
		scope.postMessage({ id, result }, transfer ?? []);
	} catch (err) {
		scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
	}
};
