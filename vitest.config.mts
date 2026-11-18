import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: [
			{ find: "obsidian", replacement: fileURLToPath(new URL("./test/obsidian-mock.ts", import.meta.url)) },
			{ find: /^worker:.*$/, replacement: fileURLToPath(new URL("./test/worker-stub.ts", import.meta.url)) },
		],
	},
	test: { environment: "happy-dom", setupFiles: ["./test/setup-globals.ts"] },
});
