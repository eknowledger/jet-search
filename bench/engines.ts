import type { BenchEngine } from "./engine";
import { fts5Engine, initFts5 } from "./fts5-engine";
import { jadeEngine } from "./jade-engine";
import { ALL_LANGUAGES, jetEngine } from "./jet-engine";

/** Every engine the bench can run, by name. */
export const ENGINES: Record<string, () => BenchEngine> = {
	jade: jadeEngine,
	jet: jetEngine,
	"jet-edits": () => jetEngine(true),
	"jet-seq": () => jetEngine(false, true),
	"jet-nostem": () => jetEngine(false, false, []),
	"jet-all": () => jetEngine(false, false, ALL_LANGUAGES),
	fts5: () => fts5Engine({ detail: "column" }),
	"fts5-none": () => fts5Engine({ detail: "none" }),
};

/** Engines that need set-up before use (SQLite's WASM module), once per process. */
export const prepare = async (name: string): Promise<void> => {
	if (name.startsWith("fts5")) await initFts5();
};
