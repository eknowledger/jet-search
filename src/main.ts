import { Notice, Plugin } from "obsidian";
import { BUILD_ID } from "./build-id";
import { JetSettingTab } from "./settings-tab";

/**
 * Jet Search: the plugin entry point. Obsidian start pays only for what onload registers:
 * one command and the settings tab. No file reads, no worker, no listeners.
 */
export default class JetSearchPlugin extends Plugin {
	readonly buildId = BUILD_ID;

	async onload(): Promise<void> {
		this.addCommand({
			id: "open",
			name: "Search notes",
			callback: () => {
				new Notice("Search is not built yet.");
			},
		});
		this.addSettingTab(new JetSettingTab(this.app, this));
	}
}
