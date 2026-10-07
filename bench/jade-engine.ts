import { SearchIndex } from "../src/engine/search-index";
import { noteFields, parseQuery } from "../src/engine/text";
import type { BenchEngine, BenchNote } from "./engine";

/** Jade's engine as ported: the baseline every later engine is measured against. */
export const jadeEngine = (): BenchEngine => {
	let index = new SearchIndex();
	const now = Date.now();
	return {
		name: "jade (ported)",
		build(notes: BenchNote[]) {
			index = new SearchIndex();
			for (const n of notes) index.upsert(n.path, n.mtime, noteFields(n.path, n.text));
			index.freeze();
		},
		save: () => new Uint8Array(index.serialize()),
		load(buf: Uint8Array) {
			// The file's own buffer when the bytes span it (a fresh read does): no second copy in memory.
			const whole = buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength;
			const ab = (
				whole ? buf.buffer : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
			) as ArrayBuffer;
			const loaded = SearchIndex.deserialize(ab);
			if (!loaded) throw new Error("index did not load");
			index = loaded;
		},
		query: (q: string) => index.search(parseQuery(q), { now }).map((h) => h.path),
		update(n: BenchNote) {
			index.upsert(n.path, n.mtime, noteFields(n.path, n.text));
		},
	};
};
