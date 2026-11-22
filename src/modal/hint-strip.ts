/** How far one frame of hovering an edge slides the hints, in pixels. */
const STEP = 5;
/** How far a click on an edge jumps. */
const JUMP = 180;

/**
 * The window's key hints on one line that slides sideways when they do not all fit: pointing at an edge
 * slides them, a click on it jumps, a wheel or a swipe moves them. A fade and an arrow at an edge say there
 * is more that way. Nothing runs unless the pointer is on an edge. Returns what to call when the width changed.
 */
export const hintStrip = (parent: HTMLElement, keys: ReadonlyArray<readonly [string, string]>): (() => void) => {
	const strip = parent.createDiv({ cls: "jet-fstrip" });
	const left = strip.createDiv({
		cls: "jet-fedge is-left",
		attr: { role: "button", "aria-label": "Earlier shortcuts" },
	});
	const track = strip.createDiv({ cls: "jet-ftrack" });
	const right = strip.createDiv({
		cls: "jet-fedge is-right",
		attr: { role: "button", "aria-label": "More shortcuts" },
	});
	for (const [key, label] of keys) {
		const h = track.createSpan({ cls: "jet-ht" });
		h.createEl("kbd", { text: key });
		h.appendText(label);
	}
	// Plain characters: nothing to parse on each keystroke.
	left.createSpan({ cls: "jet-fchev", text: "‹" });
	right.createSpan({ cls: "jet-fchev", text: "›" });

	const update = (): void => {
		strip.toggleClass("more-left", track.scrollLeft > 2);
		strip.toggleClass("more-right", track.scrollLeft + track.clientWidth < track.scrollWidth - 2);
	};
	track.addEventListener("scroll", update, { passive: true });
	// A wheel turned over the bar moves it sideways (a trackpad's own sideways swipe already does).
	track.addEventListener(
		"wheel",
		(e) => {
			if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || track.scrollWidth <= track.clientWidth) return;
			track.scrollLeft += e.deltaY;
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
			if (!track.isConnected) return;
			track.scrollLeft += dir * STEP;
			frame = win.requestAnimationFrame(slide);
		};
		// The pointer stays in the input: the edge never takes focus.
		edge.addEventListener("mousedown", (e) => e.preventDefault());
		edge.addEventListener("mouseenter", () => {
			win.cancelAnimationFrame(frame);
			frame = win.requestAnimationFrame(slide);
		});
		edge.addEventListener("mouseleave", () => win.cancelAnimationFrame(frame));
		edge.addEventListener("click", () => track.scrollBy({ left: dir * JUMP, behavior: "smooth" }));
	}
	update();
	return update;
};
