/**
 * The keys inside Jet's window, yours to change. Each action has a
 * default; you keep only the ones you changed. Every hint in the window reads its key from here, so the
 * hints follow. Moving the list, Esc, ⌫ and the arrows stay as they are: they are not in the map. Pure.
 */
import type { Modifier } from "obsidian";

export type KeyAction =
	| "open"
	| "openOther"
	| "split"
	| "create"
	| "insertLink"
	| "copyLink"
	| "copyUrl"
	| "preview"
	| "actions"
	| "meaning"
	| "filters"
	| "sort"
	| "nextHit"
	| "prevHit"
	| "accept"
	| "back";

/** A key with its modifiers, as Obsidian's Scope takes it (`Mod` is ⌘ on macOS, Ctrl elsewhere). */
export type Combo = { mods: Modifier[]; key: string };

/** The actions in the order the settings list them, what each does, and its default. */
export const KEY_ACTIONS: ReadonlyArray<{ id: KeyAction; what: string; key: Combo }> = [
	{ id: "open", what: "Open the selected note", key: { mods: [], key: "Enter" } },
	{ id: "openOther", what: "Open in a new tab (or the same, by your setting)", key: { mods: ["Mod"], key: "Enter" } },
	{ id: "split", what: "Open to the right", key: { mods: ["Mod", "Alt"], key: "Enter" } },
	{ id: "create", what: "Create a note named after the text", key: { mods: ["Shift"], key: "Enter" } },
	{ id: "insertLink", what: "Insert a link to the note", key: { mods: ["Alt"], key: "Enter" } },
	{ id: "copyLink", what: "Copy a link to the note", key: { mods: ["Mod"], key: "l" } },
	{ id: "copyUrl", what: "Copy the note's obsidian:// URL", key: { mods: ["Mod", "Shift"], key: "l" } },
	{ id: "preview", what: "Show or hide the preview", key: { mods: ["Mod"], key: "." } },
	{ id: "actions", what: "The note's actions", key: { mods: ["Mod"], key: "k" } },
	{ id: "meaning", what: "Words or meaning", key: { mods: ["Mod"], key: "j" } },
	{ id: "filters", what: "The filters bar", key: { mods: ["Mod"], key: "f" } },
	{ id: "sort", what: "Next sort order", key: { mods: ["Mod", "Shift"], key: "s" } },
	{ id: "nextHit", what: "Next hit in the preview", key: { mods: ["Mod"], key: "g" } },
	{ id: "prevHit", what: "Previous hit in the preview", key: { mods: ["Mod", "Shift"], key: "g" } },
	{
		id: "accept",
		what: "Take the suggestion (a scope, a value, a fix), or the next scope",
		key: { mods: [], key: "Tab" },
	},
	{
		id: "back",
		what: "The other choice for a suggested scope, or the previous scope",
		key: { mods: ["Shift"], key: "Tab" },
	},
];

export type KeyMap = Record<KeyAction, Combo>;

const ORDER: readonly Modifier[] = ["Mod", "Ctrl", "Meta", "Alt", "Shift"];
const norm = (c: Combo): Combo => ({
	mods: ORDER.filter((m) => c.mods.includes(m)),
	key: c.key.length === 1 ? c.key.toLowerCase() : c.key,
});

/** Your keys over the defaults. */
export const keyMap = (custom: Partial<Record<string, Combo>> = {}): KeyMap => {
	const out = {} as KeyMap;
	for (const a of KEY_ACTIONS) {
		const c = custom[a.id];
		out[a.id] = c ? norm(c) : a.key;
	}
	return out;
};

export const sameCombo = (a: Combo, b: Combo): boolean => {
	const x = norm(a);
	const y = norm(b);
	return x.key === y.key && x.mods.join() === y.mods.join();
};

/** The keys Jet keeps for itself in the window (not in the map): no action may take them. */
const FIXED: ReadonlyArray<[Combo, string]> = [
	[{ mods: [], key: "Escape" }, "Esc (clear, then close)"],
	[{ mods: [], key: "ArrowUp" }, "↑ (move up)"],
	[{ mods: [], key: "ArrowDown" }, "↓ (move down)"],
	[{ mods: [], key: "ArrowLeft" }, "← (the chip's card)"],
	[{ mods: [], key: "Backspace" }, "⌫ (remove a chip)"],
	[{ mods: [], key: "PageUp" }, "Page Up"],
	[{ mods: [], key: "PageDown" }, "Page Down"],
	[{ mods: ["Ctrl"], key: "n" }, "Ctrl N (move down)"],
	[{ mods: ["Ctrl"], key: "p" }, "Ctrl P (move up)"],
	[{ mods: ["Alt"], key: "ArrowUp" }, "⌥↑ (scroll the preview)"],
	[{ mods: ["Alt"], key: "ArrowDown" }, "⌥↓ (scroll the preview)"],
];

/** Keys that alone (or with ⇧ only) type text: refused, or the box could not be typed in. */
const typesText = (c: Combo): boolean =>
	!c.mods.some((m) => m === "Mod" || m === "Ctrl" || m === "Meta" || m === "Alt") &&
	!["Enter", "Tab"].includes(c.key) &&
	!/^F\d{1,2}$/.test(c.key);

/**
 * Why `combo` cannot be given to `action`, or null when it can: another action has it (named), Jet keeps
 * it, or it would type text.
 */
export const refusal = (map: KeyMap, action: KeyAction, combo: Combo): string | null => {
	for (const [c, what] of FIXED) if (sameCombo(c, combo)) return `${comboLabel(combo)} is kept for ${what}.`;
	if (typesText(combo)) return "That key is for typing in the search box. Use it with ⌘, Ctrl or ⌥.";
	for (const a of KEY_ACTIONS)
		if (a.id !== action && sameCombo(map[a.id], combo)) return `${comboLabel(combo)} already does: ${a.what}.`;
	return null;
};

/** macOS shows ⌘ ⌥ ⌃ ⇧; elsewhere Ctrl+Alt+Shift+. Set once by the plugin from Obsidian's Platform. */
let mac = true;
export const setMac = (on: boolean): void => {
	mac = on;
};

const KEY_NAMES: Record<string, string> = {
	Enter: "↵",
	Tab: "⇥",
	Escape: "Esc",
	Backspace: "⌫",
	ArrowUp: "↑",
	ArrowDown: "↓",
	ArrowLeft: "←",
	ArrowRight: "→",
	" ": "Space",
};

/** As the hints write it: ⌘L, ⇧↵, ⌘⇧S (macOS); Ctrl+L, Shift+↵ elsewhere. */
export const comboLabel = (c: Combo): string => {
	const key = KEY_NAMES[c.key] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key);
	const n = norm(c);
	if (mac) {
		const sym: Record<Modifier, string> = { Mod: "⌘", Meta: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" };
		return `${n.mods.map((m) => sym[m]).join("")}${key}`;
	}
	const word: Record<Modifier, string> = { Mod: "Ctrl", Ctrl: "Ctrl", Meta: "Win", Alt: "Alt", Shift: "Shift" };
	return [...new Set(n.mods.map((m) => word[m])), key].join("+");
};

/** The key a keyboard event names, as a combo (null for a modifier alone). Letters and digits by their place, so ⌥L is L. */
export const comboOf = (e: {
	key: string;
	code?: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
}): Combo | null => {
	if (["Shift", "Control", "Alt", "Meta", "OS", "CapsLock", "Fn"].includes(e.key)) return null;
	const mods: Modifier[] = [];
	if (mac ? e.metaKey : e.ctrlKey) mods.push("Mod");
	if (mac && e.ctrlKey) mods.push("Ctrl");
	if (!mac && e.metaKey) mods.push("Meta");
	if (e.altKey) mods.push("Alt");
	if (e.shiftKey) mods.push("Shift");
	const code = e.code ?? "";
	const key = /^Key[A-Z]$/.test(code)
		? code.slice(3).toLowerCase()
		: /^Digit\d$/.test(code)
			? code.slice(5)
			: code === "Period"
				? "."
				: code === "Comma"
					? ","
					: code === "Slash"
						? "/"
						: e.key;
	return norm({ mods, key });
};

/** The double tap that opens Jet: a modifier tapped twice alone, or none. */
export type TapKey = "Shift" | "Control" | "Alt" | "Meta" | "off";

export const TAP_KEYS: ReadonlyArray<[TapKey, string]> = [
	["Shift", "⇧ Shift"],
	["Control", "⌃ Control"],
	["Alt", "⌥ Option"],
	["Meta", "⌘ Command"],
	["off", "Off"],
];

/** The double tap as the hints write it (⇧⇧), or null when it is off. */
export const tapLabel = (k: TapKey): string | null => {
	if (k === "off") return null;
	if (mac) return { Shift: "⇧⇧", Control: "⌃⌃", Alt: "⌥⌥", Meta: "⌘⌘" }[k];
	return { Shift: "Shift Shift", Control: "Ctrl Ctrl", Alt: "Alt Alt", Meta: "Win Win" }[k];
};
