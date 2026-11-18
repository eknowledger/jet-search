import obsidianmd from "eslint-plugin-obsidianmd";

// The obsidianmd rules require TS type info, and its recommended config enables them
// globally (not just on *.ts). Turn them off for package.json so the recommended
// config's dependency / JSON checks (eslint-plugin-depend, @eslint/json) can lint it
// without the type-checked obsidianmd rules erroring on a non-TS file.
const obsidianRulesOff = Object.fromEntries(
	Object.keys(obsidianmd.rules ?? {}).map((name) => [`obsidianmd/${name}`, "off"]),
);

export default [
	{
		ignores: ["main.js", "node_modules/", "esbuild.config.mjs", "test/**"],
	},
	...obsidianmd.configs.recommended,
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		// Jet draws its own settings page (tabs, per-page layout) rather than the declarative list, which
		// fixes the look of every row. The cost is that the settings are not found by Obsidian's settings search.
		files: ["src/settings-tab.ts"],
		rules: { "obsidianmd/settings-tab/prefer-setting-definitions": "off" },
	},
	{
		files: ["package.json"],
		rules: obsidianRulesOff,
	},
];
