import { fieldsFromMarkdown, type NoteInput } from "../src/engine/fields";
import { JetEngine } from "../src/engine/jet-engine";
import { parseQuery } from "../src/engine/query";
import { applySequenceBoost } from "../src/rank";
import { STEM_LANGUAGES, type StemLanguage } from "../src/engine/stem";

export const ALL_LANGUAGES = [...STEM_LANGUAGES];
import type { BenchEngine, BenchNote } from "./engine";

const input = (n: BenchNote): NoteInput => ({ path: n.path, mtime: n.mtime, ...fieldsFromMarkdown(n.path, n.text) });

/** Jet's engine (index v4, typo walk, ranking key), with fields read from the raw Markdown. */
export const jetEngine = (editsFirst = false, sequences = false, stemming: StemLanguage[] = ["en"]): BenchEngine => {
	let texts = new Map<string, string>();
	let engine = new JetEngine();
	let sidecar: Uint8Array | null = null;
	const now = Date.now();
	return {
		name: sequences
			? "jet + sequence boost"
			: editsFirst
				? "jet (edits first)"
				: `jet (${stemming.join(",") || "no stemming"})`,
		build(notes: BenchNote[]) {
			engine = new JetEngine();
			engine.configure({ stemming });
			engine.build(notes.map(input));
			if (sequences) texts = new Map(notes.map((n) => [n.path, n.text]));
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
			engine.configure({ stemming });
			engine.load(ab, sidecar ?? undefined);
		},
		query: (q: string, keep?: (path: string) => boolean) => {
			const hits = engine.query(parseQuery(q), { now, allow: keep, editsFirst }).hits;
			return (sequences ? applySequenceBoost(hits, q, (p) => texts.get(p) ?? null) : hits).map((h) => h.path);
		},
		update(n: BenchNote) {
			engine.upsert(input(n));
		},
	};
};
