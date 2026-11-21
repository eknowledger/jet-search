// Bundles one of the engine benchmarks (bench/run.spec.ts, bench/mem.spec.ts, bench/order.spec.ts or bench/diag.spec.ts) and runs it with the arguments that follow.
//   node scripts/bench.mjs run|mem|order|diag [arguments]
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [which, ...args] = process.argv.slice(2);
if (which !== "run" && which !== "mem" && which !== "order" && which !== "diag") {
	console.error("usage: node scripts/bench.mjs run|mem|order|diag [arguments]");
	process.exit(2);
}
const outfile = join(root, "bench/.out", `${which}.mjs`);
mkdirSync(dirname(outfile), { recursive: true });
await build({ entryPoints: [join(root, "bench", `${which}.spec.ts`)], bundle: true, platform: "node", format: "esm", packages: "external", outfile, logLevel: "warning" });
process.exit(spawnSync(process.execPath, ["--expose-gc", outfile, ...args], { stdio: "inherit" }).status ?? 1);
