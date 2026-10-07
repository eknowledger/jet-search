import { fieldsFromMarkdown, type NoteInput } from "../src/engine/fields";
import { JetEngine } from "../src/engine/jet-engine";
import { parseQuery } from "../src/engine/query";
import type { BenchEngine, BenchNote } from "./engine";

const input = (n: BenchNote): NoteInput => ({ path: n.path, mtime: n.mtime, ...fieldsFromMarkdown(n.path, n.text) });

/** Jet's engine (index v4, typo walk, ranking key), with fields read from the raw Markdown. */
export const jetEngine = (editsFirst = false): BenchEngine => {
	let engine = new JetEngine();
	let sidecar: Uint8Array | null = null;
	const now = Date.now();
	return {
		name: editsFirst ? "jet (edits first)" : "jet",
		build(notes: BenchNote[]) {
			engine = new JetEngine();
			engine.build(notes.map(input));
		},
		save() {
			const s = engine.save();
			sidecar = s.sidecar;
			return new Uint8Array(s.base);
		},
		/** The sidecar holds changes since the base; the benchmark's re-save is this. */
		saveChanges: () => engine.save().sidecar,
		load(buf: Uint8Array) {
			const whole = buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength;
			const ab = (
				whole ? buf.buffer : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
			) as ArrayBuffer;
			engine = new JetEngine();
			engine.load(ab, sidecar ?? undefined);
		},
		query: (q: string, keep?: (path: string) => boolean) =>
			engine.query(parseQuery(q), { now, allow: keep, editsFirst }).hits.map((h) => h.path),
		update(n: BenchNote) {
			engine.upsert(input(n));
		},
	};
};
