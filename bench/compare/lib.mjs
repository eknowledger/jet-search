import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
// Everything the harness creates (vaults, downloaded plugins, the Obsidian profile, results) lives here. Git ignores it.
export const WORK = process.env.CMP_WORK ?? join(HERE, ".work");
export const REPO = join(HERE, "../..");
// Shared helpers: real key events through CDP, as a person types.
export const typeChar = async (cdp, ch) => {
	await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch });
	await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
};
const CODES = { Escape: 27, Enter: 13, Backspace: 8, ArrowDown: 40, ArrowUp: 38, Tab: 9 };
export const press = async (cdp, name, modifiers = 0) => {
	const vk = CODES[name] ?? 0;
	await cdp.send("Input.dispatchKeyEvent", {
		type: "rawKeyDown",
		key: name,
		code: name,
		windowsVirtualKeyCode: vk,
		modifiers,
	});
	await cdp.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: name,
		code: name,
		windowsVirtualKeyCode: vk,
		modifiers,
	});
};
export const clearInput = async (cdp) => {
	await cdp.send("Input.dispatchKeyEvent", {
		type: "rawKeyDown",
		key: "a",
		code: "KeyA",
		windowsVirtualKeyCode: 65,
		modifiers: 4,
	});
	await cdp.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "a",
		code: "KeyA",
		windowsVirtualKeyCode: 65,
		modifiers: 4,
	});
	await press(cdp, "Backspace");
};
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
