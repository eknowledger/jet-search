/**
 * Search by meaning, for the plugin: on and off, installing and removing the model, and making
 * the vectors again. The worker holds the model and vectors; this keeps the setting, the installed
 * model's record and the worker in step.
 */
import { type App, normalizePath, Notice } from "obsidian";
import type { JetData } from "../data";
import type { Feeder } from "../index/feeder";
import { download, install, readModel, removeModel } from "./install";
import { MODEL } from "./model";

export class Meaning {
	/** What is being done now, in words (settings show it), or null. */
	busy: string | null = null;
	onChange: (() => void) | null = null;

	constructor(
		private readonly app: App,
		private readonly dir: string,
		private readonly data: () => JetData,
		/** Saves at once: installing and removing must not be lost if Obsidian closes right after. */
		private readonly save: () => Promise<void>,
		private readonly feeder: Feeder,
	) {
		feeder.meaningModel = async () => {
			if (!this.available()) return null;
			const buf = await readModel(this.app, this.dir);
			// The file went (deleted by hand, a sync): not installed any more; the settings say so.
			if (!buf) {
				this.data().meaningModel = null;
				await this.save();
				this.onChange?.();
			}
			return buf;
		};
		feeder.onMeaningBroken = () => {
			void (async () => {
				await removeModel(this.app, this.dir).catch(() => {});
				const d = this.data();
				d.meaningModel = null;
				d.settings.meaning = false;
				await this.save();
				this.onChange?.();
				new Notice(
					"The search-by-meaning model could not be read, so it is off. Turn it on in settings to get it again.",
				);
			})();
		};
	}

	/** On, with its model installed. */
	available(): boolean {
		const d = this.data();
		return d.settings.meaning && !!d.meaningModel;
	}

	installed(): boolean {
		return !!this.data().meaningModel;
	}

	installedBytes(): number {
		return this.data().meaningModel?.bytes ?? 0;
	}

	/** Turn it on or off (on needs the model: the settings ask first). */
	async set(on: boolean): Promise<void> {
		this.data().settings.meaning = on;
		await this.save();
		await this.feeder.meaningChanged(on && this.installed());
		this.onChange?.();
	}

	/** Download the model (or take the two files you have), then turn it on. */
	async install(files?: { "model.safetensors": ArrayBuffer; "tokenizer.json": ArrayBuffer }): Promise<void> {
		this.busy = files ? "Checking and packing the model…" : "Downloading the model…";
		this.onChange?.();
		try {
			const bytes = files
				? await install(this.app, this.dir, files)
				: await download(this.app, this.dir, (step) => {
						this.busy = step;
						this.onChange?.();
					});
			this.data().meaningModel = { id: MODEL.id, bytes };
			this.busy = null;
			await this.set(true);
		} finally {
			this.busy = null;
			this.onChange?.();
		}
	}

	/** Off, the model deleted from Jet's folder, the vectors forgotten. */
	async remove(): Promise<void> {
		await this.feeder.meaningChanged(false, true);
		await removeModel(this.app, this.dir);
		const d = this.data();
		d.meaningModel = null;
		d.settings.meaning = false;
		await this.save();
		this.onChange?.();
	}

	/** Every note's vector made again. */
	async rebuild(): Promise<void> {
		await this.feeder.meaningChanged(false, true);
		await this.feeder.meaningChanged(true);
		this.onChange?.();
	}

	/** Where the model is kept (settings say it). */
	get file(): string {
		return normalizePath(`${this.dir}/meaning-${MODEL.id}.bin`);
	}
}
