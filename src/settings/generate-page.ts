/**
 * The Generate page: what Jet found in the vault,
 * grouped by where it was found, each proposal with its rules and counts and a toggle; "Add N scopes"
 * saves the ticked ones. Generating again shows only what is new, changed or gone. Nothing is saved
 * before the button.
 */
import * as obsidian from "obsidian";
import { type App, Notice, Setting, type SettingPage } from "obsidian";
import { generate, type Generated, type Proposal } from "../scopes/generate";
import type { Scope } from "../scopes/model";
import { applyReview, type ReviewItem, review } from "../scopes/review";
import type { Snapshot } from "../scopes/snapshot";
import { closeSettingPage } from "../internals";
import { ruleText } from "./scopes-page";

export type GenerateHost = {
	app: App;
	scopes(): Scope[];
	setScopes(scopes: Scope[]): void;
	save(): void;
	/** The scopes changed: members again, the settings drawn again. */
	changed(): void;
	snapshot(): Promise<Snapshot>;
};

/** Proposals shown per group before "Show more". */
const PER_GROUP = 50;

const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** What a settings page is to Jet; Obsidian's `SettingPage` (1.13+) provides it. */
type PageBase = { containerEl: HTMLElement; title: string; display(): void; hide(): void };

/**
 * The Generate page, or null before Obsidian 1.13 (no settings pages). The class is made when asked:
 * extending `SettingPage` at load would break Jet on older versions, where it does not exist.
 */
export const createGeneratePage = (h: GenerateHost): SettingPage | null => {
	const Base = (obsidian as unknown as { SettingPage?: new () => PageBase }).SettingPage;
	if (!Base) return null;
	const Page = generatePageClass(Base);
	return new Page(h) as unknown as SettingPage;
};

const generatePageClass = (Base: new () => PageBase) =>
	class GeneratePage extends Base {
		private items: ReviewItem[] = [];
		private actionEl: Setting | null = null;
		private readonly later: boolean;

		constructor(private readonly h: GenerateHost) {
			super();
			this.later = h.scopes().some((s) => s.source === "generated");
			this.title = this.later ? "Find new scopes" : "Generate scopes";
		}

		display(): void {
			this.containerEl.empty();
			this.containerEl.createDiv({
				cls: "setting-page-desc",
				text: "Looking at your folders, properties and tags…",
			});
			void this.h
				.snapshot()
				.then((snap) => this.draw(generate(snap)))
				.catch((e: unknown) => {
					console.error("Jet Search: generating scopes failed", e);
					this.containerEl.empty();
					this.containerEl.createDiv({
						cls: "setting-page-desc",
						text: "Jet could not look at the vault (see the console).",
					});
				});
		}

		private draw(g: Generated): void {
			const el = this.containerEl;
			el.empty();
			this.items = review(g.proposals, this.h.scopes());
			const by = (state: ReviewItem["state"]): ReviewItem[] => this.items.filter((i) => i.state === state);
			el.createDiv({ cls: "setting-page-desc", text: this.summary(g, by) });
			const actions = el.createDiv({ cls: "setting-group" }).createDiv({ cls: "setting-items" });
			this.actionEl = new Setting(actions);
			this.actionEl
				.addButton((b) => b.setButtonText("Cancel").onClick(() => closeSettingPage(this.h.app)))
				.addButton((b) => b.setCta().onClick(() => this.apply()));
			this.updateAction();

			// New proposals, grouped by where they were found.
			const groups = new Map<string, ReviewItem[]>();
			for (const i of by("new"))
				groups.set(i.proposal?.group ?? "", [...(groups.get(i.proposal?.group ?? "") ?? []), i]);
			for (const [label, items] of groups)
				this.section(`${this.later ? "New · " : ""}${label} · ${items.length}`, items);
			if (by("changed").length) this.section(`Changed · ${by("changed").length}`, by("changed"));
			if (by("gone").length) this.section(`Gone · ${by("gone").length}`, by("gone"));
			const quiet = [...by("unchanged"), ...by("covered")];
			if (quiet.length) {
				const s = new Setting(this.groupEl());
				s.setName(`Unchanged · ${quiet.length}`).setDesc(
					quiet
						.slice(0, 12)
						.map((i) => i.scope?.name ?? i.proposal?.name ?? "")
						.join(", ") + (quiet.length > 12 ? ` and ${quiet.length - 12} more.` : "."),
				);
			}
			if (g.notProposed.length) {
				const box = this.groupEl("Not proposed");
				for (const x of g.notProposed.slice(0, 30)) new Setting(box).setName(x.what).setDesc(x.why);
			}
			if (!this.items.length && !g.notProposed.length)
				new Setting(this.groupEl())
					.setName("No scopes found")
					.setDesc(
						"A scope needs a group of notes: a folder of them, a property value or a nested tag they share. You can still add one by hand.",
					);
		}

		private summary(g: Generated, by: (s: ReviewItem["state"]) => ReviewItem[]): string {
			if (this.later)
				return `Since you last generated: ${plural(by("new").length, "new scope")}, ${by("changed").length} changed, ${by("gone").length} gone; ${by("unchanged").length + by("covered").length} unchanged. Your edits to any scope are kept.`;
			const found = [...new Set(g.proposals.map((p) => p.group))].slice(0, 4).join("; ");
			return g.proposals.length
				? `What Jet found in ${plural(g.notes, "note")}: ${found}. Groups of the same name from different places become one scope. Nothing is saved until you add them.`
				: `Jet looked at ${plural(g.notes, "note")} and found nothing that groups notes the way a scope needs.`;
		}

		private groupEl(heading?: string): HTMLElement {
			const g = this.containerEl.createDiv({ cls: "setting-group" });
			if (heading) new Setting(g).setName(heading).setHeading();
			return g.createDiv({ cls: "setting-items" });
		}

		private section(heading: string, items: ReviewItem[]): void {
			const box = this.groupEl(heading);
			const draw = (from: number, to: number): void => {
				for (const i of items.slice(from, to)) this.row(box, i);
			};
			draw(0, PER_GROUP);
			if (items.length > PER_GROUP) {
				const more = new Setting(box).setName(`${items.length - PER_GROUP} more`);
				more.addButton((b) =>
					b.setButtonText("Show all").onClick(() => {
						more.settingEl.remove();
						draw(PER_GROUP, items.length);
					}),
				);
			}
		}

		private row(box: HTMLElement, i: ReviewItem): void {
			const p: Proposal | undefined = i.proposal;
			const s = new Setting(box);
			if (i.state === "gone") {
				s.setName(`${i.scope?.name ?? ""} · remove the scope`).setDesc("Where it was found no longer exists.");
			} else if (i.state === "changed") {
				s.setName(`${i.scope?.name ?? ""} · add ${plural(i.addRules?.length ?? 0, "rule")}`).setDesc(
					(i.addRules ?? []).map(ruleText).join(" · "),
				);
			} else if (p) {
				// Number-only aliases (a folder's "2.") are kept but not worth showing.
				const extra = [p.kind, ...p.aliases.filter((a) => !/^[\d.\-–]+$/.test(a))].filter(Boolean).join(" · ");
				s.setName(extra ? `${p.name}  ·  ${extra}` : p.name);
				const rules = p.rules.map((r) => `${ruleText(r.rule)} ${r.count}`).join(" · ");
				s.setDesc(
					`${rules} · ${plural(p.members, "note")}${p.untick.length ? ` · ${p.untick.join("; ")}` : ""}`,
				);
			}
			s.addToggle((t) =>
				t.setValue(i.ticked).onChange((v) => {
					i.ticked = v;
					this.updateAction();
				}),
			);
		}

		private selected(): number {
			return this.items.filter((i) => i.ticked && i.state !== "unchanged" && i.state !== "covered").length;
		}

		private updateAction(): void {
			const a = this.actionEl;
			if (!a) return;
			const n = this.selected();
			const total = this.items.filter((i) => i.state !== "unchanged" && i.state !== "covered").length;
			a.setName(`${n} of ${total} selected`).setDesc(
				"Untick what you do not want; you can edit each scope afterwards.",
			);
			const cta = a.controlEl.querySelector("button.mod-cta");
			if (cta) {
				cta.textContent = this.later ? `Apply ${plural(n, "change")}` : `Add ${plural(n, "scope")}`;
				cta.toggleAttribute("disabled", n === 0);
			}
		}

		private apply(): void {
			const before = this.h.scopes().length;
			const next = applyReview(this.items, this.h.scopes());
			this.h.setScopes(next);
			this.h.save();
			const added = next.length - before;
			new Notice(
				this.later
					? `Scopes updated (${plural(this.selected(), "change")}).`
					: `${plural(added, "scope")} added.`,
			);
			closeSettingPage(this.h.app);
			this.h.changed();
		}
	};
