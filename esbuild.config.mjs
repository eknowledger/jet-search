import esbuild from "esbuild";
import process from "process";
import { builtinModules as builtins } from "node:module";
import path from "node:path";

const prod = process.argv[2] === "production";
// For the CPU profiler: built like production but not minified, so profiles name functions.
const profile = process.argv[2] === "profile";
// A unique id per build (src/build-id.ts), so a running build can be told from an older one.
// "jetbuild-" rather than "jet-": the bundle also contains the plugin id "jet-search".
const buildId = `jetbuild-${Date.now().toString(36)}`;

// `import code from "worker:./x"`: x bundled on its own (no externals: a worker has no
// Obsidian) and inlined as text, so the plugin stays one main.js.
const inlineWorker = {
	name: "inline-worker",
	setup(build) {
		build.onResolve({ filter: /^worker:/ }, (args) => ({
			path: path.resolve(args.resolveDir, `${args.path.slice("worker:".length)}.ts`),
			namespace: "inline-worker",
		}));
		build.onLoad({ filter: /.*/, namespace: "inline-worker" }, async (args) => {
			const out = await esbuild.build({
				entryPoints: [args.path],
				bundle: true,
				write: false,
				metafile: true,
				format: "iife",
				target: "es2020",
				minify: prod,
				logLevel: "silent",
			});
			return {
				contents: `export default ${JSON.stringify(out.outputFiles[0].text)};`,
				loader: "js",
				watchFiles: Object.keys(out.metafile.inputs).map((f) => path.resolve(f)),
			};
		});
	},
};

const context = await esbuild.context({
	plugins: [inlineWorker],
	banner: { js: "/* Jet Search: a bundled file. Source: src/ */" },
	define: { __JET_BUILD_ID__: JSON.stringify(buildId) },
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: ["obsidian", "electron", "@codemirror/state", "@codemirror/view", ...builtins],
	format: "cjs",
	target: "es2020",
	logLevel: "info",
	sourcemap: prod || profile ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	minify: prod,
});

if (prod || profile) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
