import { type App, Notice, PluginSettingTab, Setting } from "obsidian";
import { BUILD_ID } from "./build-id";
import { STEM_LANGUAGES } from "./engine/stem";
import { clearIndex, rebuild, statusNow } from "./index-status";
import type JetSearchPlugin from "./main";

const LANGUAGE_NAMES: Record<string, string> = {
	en: "English",
	fr: "French",
	de: "German (and its compound words)",
	es: "Spanish",
	it: "Italian",
	pt: "Portuguese",
	nl: "Dutch (and compounds)",
	sv: "Swedish (and compounds)",
	ar: "Arabic",
};

/** Jet's settings tab: how Jet opens, what it shows, what it indexes, and the index. */
export class JetSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly owner: JetSearchPlugin,
	) {
		super(app, owner);
	}

	display(): void {
		const el = this.containerEl;
		el.replaceChildren();
		const s = this.owner.data.settings;
		const save = (): void => {
			this.owner.save();
		};

		new Setting(el).setName("Open").setHeading();
		new Setting(el)
			.setName("Open with a double tap of ⇧")
			.setDesc("Two quick taps of ⇧. Off when another plugin already handles a double tap of ⇧.")
			.addToggle((t) => t.setValue(s.doubleShift).onChange((v) => ((s.doubleShift = v), save())));
		new Setting(el)
			.setName("Double tap window")
			.setDesc("The two taps must come within this time.")
			.addDropdown((d) =>
				d
					.addOptions({ "250": "250 ms", "350": "350 ms", "500": "500 ms" })
					.setValue(String(s.shiftInterval))
					.onChange((v) => ((s.shiftInterval = Number(v)), save())),
			);
		new Setting(el)
			.setName("Open in a new tab")
			.setDesc("↵ opens results in a new tab, and ⌘↵ in the same tab.")
			.addToggle((t) => t.setValue(s.newTab).onChange((v) => ((s.newTab = v), save())));

		new Setting(el).setName("Results").setHeading();
		new Setting(el)
			.setName("Show excerpts")
			.setDesc("A line around the best hit under each result found in the text.")
			.addToggle((t) => t.setValue(s.excerpts).onChange((v) => ((s.excerpts = v), save())));
		new Setting(el)
			.setName("Show the preview")
			.setDesc("The selected note, shown next to the results.")
			.addToggle((t) => t.setValue(s.preview).onChange((v) => ((s.preview = v), save())));

		new Setting(el).setName("Word forms").setHeading();
		for (const lang of STEM_LANGUAGES) {
			new Setting(el)
				.setName(LANGUAGE_NAMES[lang] ?? lang)
				.setDesc(lang === "en" ? "Running finds run; meetings finds meeting." : "")
				.addToggle((t) =>
					t.setValue(s.stemming.includes(lang)).onChange((v) => {
						s.stemming = v ? [...new Set([...s.stemming, lang])] : s.stemming.filter((x) => x !== lang);
						save();
						if (this.owner.client.running)
							void this.owner.client.call({ op: "configure", stemming: s.stemming });
					}),
				);
		}

		new Setting(el).setName("Index").setHeading();
		new Setting(el)
			.setName("Folders to leave out")
			.setDesc("One folder per line. Obsidian's excluded files are left out too. Rebuild after changing.")
			.addTextArea((t) =>
				t.setValue(s.exclude.join("\n")).onChange((v) => {
					s.exclude = v
						.split("\n")
						.map((x) => x.trim().replace(/\/$/, ""))
						.filter(Boolean);
					save();
				}),
			);
		// Drawn once, at once: a later change of the text would make Obsidian redraw this tab, forever.
		const x = statusNow(this.owner);
		const status = new Setting(el)
			.setName("Index")
			.setDesc(`${x.state} · ${x.notes} · ${x.size} · updated ${x.updated}`);
		status.addButton((b) =>
			b.setButtonText("Rebuild").onClick(() => {
				b.setDisabled(true).setButtonText("Rebuilding…");
				void rebuild(this.owner).then(
					() => this.display(),
					(e: unknown) => {
						console.error("Jet Search: rebuild failed", e);
						new Notice("The search index could not be rebuilt (see the console).");
					},
				);
			}),
		);
		new Setting(el)
			.setName("Clear the index on this device")
			.setDesc("It is kept outside the vault, one per vault; the next search builds it again.")
			.addButton((b) => {
				b.setButtonText("Clear").onClick(() => void clearIndex(this.owner).then(() => this.display()));
				b.buttonEl.addClass("mod-warning");
			});

		new Setting(el).setName("Version").setDesc(`${this.owner.manifest.version} (build ${BUILD_ID})`);
	}
}
