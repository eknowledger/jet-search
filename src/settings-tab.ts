import { type App, type Plugin, PluginSettingTab, Setting } from "obsidian";
import { BUILD_ID } from "./build-id";

/** Jet's settings tab. Settings arrive with the slices that need them; for now it names the build. */
export class JetSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly owner: Plugin,
	) {
		super(app, owner);
	}

	display(): void {
		this.containerEl.replaceChildren();
		new Setting(this.containerEl).setName("Version").setDesc(`${this.owner.manifest.version} (build ${BUILD_ID})`);
	}
}
