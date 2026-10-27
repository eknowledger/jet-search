/**
 * The theme's own highlight, as a note shows a `==mark==`, for Jet's marks. Themes style a mark inside
 * rendered notes only, and some pair an opaque highlight with dark text (Catppuccin): Jet's marks in
 * `--text-normal` on it could not be read. Measured once per theme (`forgetThemeMark` on css-change).
 */
let known: Record<string, string> | null = null;

/** The theme changed: measure again at the next open. */
export const forgetThemeMark = (): void => {
	known = null;
};

/** The highlight's background and text colour, as the CSS properties Jet's marks read. */
export const themeMark = (doc: Document): Record<string, string> => {
	if (known) return known;
	const host = doc.body.createDiv({ cls: "markdown-rendered" });
	host.setCssStyles({ position: "absolute", visibility: "hidden", pointerEvents: "none" });
	const style = (doc.defaultView ?? window).getComputedStyle(host.createEl("mark", { text: "x" }));
	const bg = style.backgroundColor;
	const fg = style.color;
	host.remove();
	// Nothing measured (no styles yet): the CSS fallbacks apply.
	known = bg && fg ? { "--jet-mark-bg": bg, "--jet-mark-fg": fg } : {};
	return known;
};
