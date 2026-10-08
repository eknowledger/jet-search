// Jade's partner API, version 0: copied from Jade (src/api/types.ts, types only), as Jade asks partners to.
// No runtime import of Jade: Jet finds the API at run time and keeps its own UI when Jade is not there.
/**
 * Jade's partner API, version 0: the contract between Jade and a plugin that
 * joins its primitives when both are installed.
 *
 * This file is self-contained on purpose: a partner copies it into its own
 * source (types only, no runtime import of Jade) and finds the API at run time:
 *
 *     const api = (app.plugins.getPlugin("jade") as { api?: JadeApi } | null)?.api;
 *     if (api?.version === 0) partner = api.join(this);
 *
 * and listens for the workspace events `jade:ready` (Jade loaded after it, or
 * was turned back on) and `jade:unload` (Jade is going away). A partner keeps
 * its own UI as the fallback: everything here is optional to it.
 *
 * Version rules: additions keep `version` and appear in `features`; anything
 * that would break a partner bumps `version`, and a partner that does not know
 * the new version stays on its own UI.
 */
import type { EditorView } from "@codemirror/view";
import type { Editor, MarkdownView, Plugin } from "obsidian";

export const JADE_API_VERSION = 0;

/** What this Jade offers; a partner checks before it relies on one. */
export type JadeFeature =
	| "surface"
	| "surface.when"
	| "layout.band"
	| "layout.compact"
	| "layout.corner"
	| "layout.covers"
	| "hub";

/** The areas a partner's controls can sit under in the J panel. */
export type JadeArea = "write" | "find" | "organize" | "plan" | "review" | "workspace";

/** The selection an action runs on: in a table cell, the cell's own editor. */
export type JadeSelection = {
	view: MarkdownView;
	editor: Editor;
	/** The CodeMirror view holding the selection (a table cell's, inside a table). */
	cm: EditorView;
	from: number;
	to: number;
};

/** An action on Jade's editing surface (the floating bar over a selection, the pinned bar). */
export type JadeAction = {
	/** Unique within the partner; Jade stores the user's placement under `<partner id>:<id>`. */
	id: string;
	label: string;
	/** A Lucide icon name. */
	icon: string;
	/** Where it shows by default; the user can move it. Default: "floating". */
	place?: "floating" | "pinned" | "both";
	/** The area it is listed under in the placement editor. Default: "write". */
	area?: JadeArea;
	/** Whether it applies to this selection; asked each time the floating bar shows. */
	when?: (s: JadeSelection) => boolean;
	run: (s: JadeSelection) => void;
};

/** A rectangle in window coordinates (CSS pixels). */
export type JadeRect = { left: number; top: number; right: number; bottom: number };

/**
 * A strip of a note's pane (a comments margin) that Jade measures in its layout
 * pass: its left and right edges, across the pane's height. The text is never
 * covered or moved for it. A pane's cards go right of the strip when there is
 * room there; otherwise they go over the strip (never over the text). The
 * floating bar steps aside from it.
 */
export type JadeBandSpec = {
	el: HTMLElement;
	/** Whether the strip is in use now (nothing in it: no room kept). Default: always. */
	active?: () => boolean;
	/**
	 * The strip can show a narrow form (markers) in its first `width` px. When a
	 * card in the pane needs the room beside it, Jade calls `onCompact(true)` and
	 * puts the card right of the narrow form; `onCompact(false)` once the card is
	 * gone or the room is back. Never in the middle of a resize: Jade waits until
	 * it settles. The partner changes only what the strip shows: the element keeps
	 * its size and place, and the text does not move.
	 */
	compact?: { width: number; onCompact(on: boolean): void };
};

export type JadeBand = {
	/** Something the element's size does not show changed (it filled, emptied, moved). */
	changed(): void;
	remove(): void;
};

type ControlBase = {
	id: string;
	label: string;
	/** A line under the label; a function is asked each time the panel draws. */
	desc?: string | (() => string);
};

/** A quick control in the J panel, under the partner's name. */
export type JadeControl =
	| (ControlBase & { type: "toggle"; get(): boolean; set(v: boolean): void })
	| (ControlBase & {
			type: "slider";
			min: number;
			max: number;
			step?: number;
			get(): number;
			set(v: number): void;
			format?(v: number): string;
	  })
	| (ControlBase & {
			type: "select";
			options: ReadonlyArray<readonly [string, string]>;
			get(): string;
			set(v: string): void;
	  })
	| (ControlBase & { type: "action"; button: string; run(): void });

/** A joined partner: everything it adds goes when it leaves (or its plugin unloads, or Jade does). */
export type JadePartner = {
	/** False once it has left, or Jade unloaded: every call is then a no-op. */
	readonly active: boolean;
	readonly surface: {
		/** Add an action; returns the function that removes it. */
		add(action: JadeAction): () => void;
		/** Whether the action shows on the floating bar now (the mode and the user's placement allow it). */
		floats(id: string): boolean;
	};
	readonly layout: {
		reserve(band: JadeBandSpec): JadeBand;
		/**
		 * The J's corner: the J, its quick row at full width (open or not) and a
		 * small gap, in window coordinates. A partner keeps its own controls out of
		 * it. null when there is none (no J over the notes). Partners hear of a move
		 * through onChange, once a resize settles.
		 */
		corner(): JadeRect | null;
		/**
		 * Whether one of Jade's cards, or the J's corner, is over this rectangle
		 * now (window coordinates). For a partner control drawn above Jade's layer
		 * (a hover button): it should not show there.
		 */
		covers(rect: JadeRect): boolean;
	};
	readonly hub: {
		/** Add a control under an area of the J panel; returns the function that removes it. */
		add(area: JadeArea, control: JadeControl): () => void;
	};
	/**
	 * Called when anything a partner may react to changes: the surface's mode or
	 * placements, a module turned on or off, the J's corner (after a resize
	 * settles), and Jade going away (then `active` is false). Returns the function
	 * that stops it.
	 */
	onChange(fn: () => void): () => void;
	leave(): void;
};

export type JadeApi = {
	readonly version: typeof JADE_API_VERSION;
	readonly features: readonly JadeFeature[];
	/**
	 * Join with the partner's plugin: Jade ties the partnership to the plugin's
	 * lifecycle (it leaves when the plugin unloads). Joining again returns the
	 * same partner.
	 */
	join(plugin: Plugin): JadePartner;
};
