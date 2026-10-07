import { describe, expect, it } from "vitest";
import { App } from "obsidian";
import JetSearchPlugin from "../src/main";

const manifest = { id: "jet-search", name: "Jet Search", version: "0.0.1" };

describe("plugin", () => {
	it("loads", async () => {
		const plugin = new JetSearchPlugin(new App() as never, manifest as never);
		await expect(plugin.onload()).resolves.toBeUndefined();
	});
});
