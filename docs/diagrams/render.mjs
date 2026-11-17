// Renders every diagram in diagrams.mjs to the assets folder as arch-<name>-{dark,light}.png.
// Usage: node docs/diagrams/render.mjs [name ...]
// Needs Google Chrome. Set CHROME to use another binary.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { diagrams } from "./diagrams.mjs";
import { FONT, themes } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outDir = join(root, "docs", "assets");
const chrome = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

if (!existsSync(chrome)) {
	console.error(`Google Chrome not found at ${chrome}. Set CHROME to the browser binary.`);
	process.exit(1);
}

const roughSource = readFileSync(join(root, "node_modules", "roughjs", "bundled", "rough.js"), "utf8");
const libSource = readFileSync(join(here, "lib.mjs"), "utf8");
const fontFaces = [
	["Excalifont-Latin.woff2", "U+0000-00FF,U+0131,U+0152-0153,U+02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2212"],
	["Excalifont-LatinExt.woff2", "U+0100-0130,U+0132-0137,U+0139-0149,U+014C-0151,U+0154-017E,U+0192,U+2113"],
]
	.map(
		([file, range]) =>
			`@font-face { font-family: "${FONT}"; src: url("${pathToFileURL(join(here, "fonts", file)).href}") format("woff2"); unicode-range: ${range}; }`,
	)
	.join("\n");

const safeScript = (s) => s.replaceAll("</script", "<\\/script");

function page(dia, themeName) {
	return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
${fontFaces}
html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
svg { display: block; }
</style>
<script>${safeScript(roughSource)}</script>
</head><body><svg id="d"></svg>
<script type="module">
${safeScript(libSource)}
const dia = ${safeScript(JSON.stringify(dia))};
await document.fonts.load('22px "${FONT}"');
await document.fonts.ready;
const warnings = renderDiagram(globalThis.rough, document.getElementById("d"), dia, ${JSON.stringify(themeName)});
document.body.dataset.warnings = JSON.stringify(warnings);
</script></body></html>
`;
}

const common = [
	"--headless=new",
	"--disable-gpu",
	"--no-first-run",
	"--no-default-browser-check",
	"--allow-file-access-from-files",
	"--hide-scrollbars",
	"--virtual-time-budget=5000",
];

const wanted = process.argv.slice(2);
const todo = wanted.length ? diagrams.filter((d) => wanted.includes(d.name)) : diagrams;
if (wanted.length && todo.length !== wanted.length) {
	const known = diagrams.map((d) => d.name).join(", ");
	console.error(`Unknown diagram in: ${wanted.join(", ")}. Known: ${known}`);
	process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "jet-diagrams-"));
let failed = false;
try {
	for (const dia of todo) {
		for (const themeName of Object.keys(themes)) {
			const html = join(work, `${dia.name}-${themeName}.html`);
			const out = join(outDir, `arch-${dia.name}-${themeName}.png`);
			writeFileSync(html, page(dia, themeName));
			const profile = mkdtempSync(join(work, "profile-"));
			const base = [...common, `--user-data-dir=${profile}`];
			const url = pathToFileURL(html).href;

			if (themeName === "dark") {
				const dom = execFileSync(chrome, [...base, "--dump-dom", url], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
				const m = /data-warnings="([^"]*)"/.exec(dom);
				if (!m) {
					console.error(`${dia.name}: the page did not finish drawing`);
					failed = true;
					continue;
				}
				const warnings = JSON.parse(m[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
				for (const w of warnings) {
					console.warn(`${dia.name}: ${w}`);
					failed = true;
				}
			}

			execFileSync(
				chrome,
				[
					...base,
					"--default-background-color=00000000",
					"--force-device-scale-factor=2",
					`--window-size=${dia.width},${dia.height}`,
					`--screenshot=${out}`,
					url,
				],
				{ stdio: "ignore" },
			);
			console.log(`wrote arch-${dia.name}-${themeName}.png`);
		}
	}
} finally {
	rmSync(work, { recursive: true, force: true });
}
if (failed) process.exitCode = 1;
