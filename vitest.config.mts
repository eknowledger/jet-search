import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: [
			{ find: "obsidian", replacement: fileURLToPath(new URL("./test/obsidian-mock.ts", import.meta.url)) },
			{ find: /^worker:.*$/, replacement: fileURLToPath(new URL("./test/worker-stub.ts", import.meta.url)) },
		],
	},
	test: {
		// Only test/. The benchmark scripts in bench/ are named *.spec.ts so Obsidian's directory scan, which
		// would hold them to the rules for plugin code, leaves them out; they must not be run as tests.
		include: ["test/**/*.test.ts"],
		environment: "happy-dom",
		setupFiles: ["./test/setup-globals.ts"],
	},
});
