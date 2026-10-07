import type { BenchEngine } from "./engine";
import { jadeEngine } from "./jade-engine";
import { jetEngine } from "./jet-engine";

/** Every engine the bench can run, by name. */
export const ENGINES: Record<string, () => BenchEngine> = {
	jade: jadeEngine,
	jet: jetEngine,
	"jet-score": () => jetEngine(false),
};
