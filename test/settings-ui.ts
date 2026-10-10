/**
 * Driving Jet's settings tab as you would: its tabs, cards and rows, the Edit dialog of
 * a scope (Obsidian before 1.13, and the test app: no settings pages), and the keys table.
 */
import type { SettingsPage } from "../src/settings-tab";
import type { JetSettingTab } from "../src/settings-tab";

export const tabOf = (plugin: unknown): JetSettingTab =>
	(plugin as { settingTabs: JetSettingTab[] }).settingTabs[0] as JetSettingTab;

/** Draw the tab at a page; returns its element. */
export const goTo = (tab: JetSettingTab, page: SettingsPage): HTMLElement => {
	tab.display();
	tab.containerEl.querySelector<HTMLElement>(`.jet-set-tab[data-page="${page}"]`)?.click();
	return tab.containerEl;
};

export const textsOf = (el: ParentNode, sel: string): string[] =>
	[...el.querySelectorAll(sel)].map((e) => e.textContent?.trim() ?? "");

/** The setting row named `name` (in a card or a dialog). */
export const rowNamed = (el: ParentNode, name: string): HTMLElement | null =>
	[...el.querySelectorAll<HTMLElement>(".setting-item")].find(
		(r) => r.querySelector(".setting-item-name")?.textContent?.trim() === name,
	) ?? null;

export const buttonNamed = (el: ParentNode, text: string | RegExp): HTMLButtonElement | null =>
	[...el.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
		typeof text === "string" ? b.textContent?.trim() === text : text.test(b.textContent ?? ""),
	) ?? null;

/** The scope's row in the Scopes tab, and its Edit dialog once clicked. */
export const editScope = (tab: JetSettingTab, name: string): HTMLElement | null => {
	const el = goTo(tab, "scopes");
	const row = [...el.querySelectorAll<HTMLElement>(".jet-set-scope")].find(
		(r) => r.querySelector("b")?.textContent === name,
	);
	row?.querySelector("button")?.click();
	return document.querySelector<HTMLElement>(".jet-sed-modal");
};

/** "Add scope": the new scope's Edit dialog. */
export const addScopeDialog = (tab: JetSettingTab): HTMLElement | null => {
	const el = goTo(tab, "scopes");
	buttonNamed(el, "Add scope")?.click();
	return document.querySelector<HTMLElement>(".jet-sed-modal");
};

/** Type into a dialog's text field and leave it (the field keeps what you typed on blur). */
export const typeInto = (dialog: HTMLElement, name: string, value: string): void => {
	const input = rowNamed(dialog, name)?.querySelector("input");
	if (!input) throw new Error(`no field ${name}`);
	input.value = value;
	input.dispatchEvent(new Event("blur"));
};

export const saveDialog = (dialog: HTMLElement): void => buttonNamed(dialog, "Save")?.click();
