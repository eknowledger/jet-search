/** How far one frame of hovering an edge slides the hints, in pixels. */
const STEP = 5;
/** How far a click on an edge jumps. */
const JUMP = 180;

/**
 * The window's key hints on one line that slides sideways when they do not all fit: pointing at an edge
 * slides them, a click on it jumps, a wheel or a swipe moves them. A fade and an arrow at an edge say there
 * is more that way. It is built once; changing the hints only replaces the hints. Whether there is more is
 * measured in the next frame, never in the keystroke that changed them, and nothing runs unless the pointer
 * is on an edge.
 */
export class HintBar {
	readonly el: HTMLElement;
	private readonly track: HTMLElement;
	private frame = 0;

	constructor(parent: HTMLElement) {
		this.el = parent.createDiv({ cls: "jet-fstrip" });
		const left = this.el.createDiv({
			cls: "jet-fedge is-left",
			attr: { role: "button", "aria-label": "Earlier shortcuts" },
		});
		this.track = this.el.createDiv({ cls: "jet-ftrack" });
		const right = this.el.createDiv({
			cls: "jet-fedge is-right",
			attr: { role: "button", "aria-label": "More shortcuts" },
		});
		// Plain characters: nothing to parse.
		left.createSpan({ cls: "jet-fchev", text: "‹" });
		right.createSpan({ cls: "jet-fchev", text: "›" });

		this.track.addEventListener("scroll", () => this.update(), { passive: true });
		// A wheel turned over the bar moves it sideways (a trackpad's own sideways swipe already does).
		this.track.addEventListener(
			"wheel",
			(e) => {
				if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || this.track.scrollWidth <= this.track.clientWidth)
					return;
				this.track.scrollLeft += e.deltaY;
				e.preventDefault();
			},
			{ passive: false },
		);
		for (const [edge, dir] of [
			[left, -1],
			[right, 1],
		] as const) {
			let frame = 0;
			const win = edge.win;
			const slide = (): void => {
				if (!this.track.isConnected) return;
				this.track.scrollLeft += dir * STEP;
				frame = win.requestAnimationFrame(slide);
			};
			// The pointer stays in the input: the edge never takes focus.
			edge.addEventListener("mousedown", (e) => e.preventDefault());
			edge.addEventListener("mouseenter", () => {
				win.cancelAnimationFrame(frame);
				frame = win.requestAnimationFrame(slide);
			});
			edge.addEventListener("mouseleave", () => win.cancelAnimationFrame(frame));
			edge.addEventListener("click", () => this.track.scrollBy({ left: dir * JUMP, behavior: "smooth" }));
		}
	}

	/** Show these hints. */
	set(keys: ReadonlyArray<readonly [string, string]>): void {
		const spans = keys.map(([key, label]) => {
			const h = createSpan({ cls: "jet-ht" });
			h.createEl("kbd", { text: key });
			h.appendText(label);
			return h;
		});
		this.track.replaceChildren(...spans);
		this.later();
	}

	/** Measure in the next frame (the width, and the room the settings button leaves, are known by then). */
	later(): void {
		if (this.frame || !this.el.isConnected) return;
		this.frame = this.el.win.requestAnimationFrame(() => {
			this.frame = 0;
			this.update();
		});
	}

	/** Mark the edges that have more hidden behind them. */
	update(): void {
		const t = this.track;
		this.el.toggleClass("more-left", t.scrollLeft > 2);
		this.el.toggleClass("more-right", t.scrollLeft + t.clientWidth < t.scrollWidth - 2);
	}
}
