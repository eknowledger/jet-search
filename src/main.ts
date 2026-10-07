import { Plugin } from "obsidian";
import { BUILD_ID } from "./build-id";

/** Jet Search: the plugin entry point. Obsidian start pays only for what onload registers. */
export default class JetSearchPlugin extends Plugin {
	readonly buildId = BUILD_ID;

	async onload(): Promise<void> {}
}
