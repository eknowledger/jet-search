/**
 * The double-tap detector: two clean taps of one key (Shift by default; a setting lets
 * you choose Control, Option or Command) within the interval open Jet. A tap is that key down then up
 * with no other key in between; key repeat and the key held with a letter never count. Pure: the plugin
 * feeds it key events and decides what to run.
 */
export class DoubleTap {
	private downAt = -1;
	private lastTapAt = -Infinity;
	private dirty = false;

	constructor(
		private readonly interval: () => number,
		/** The key tapped (`KeyboardEvent.key`: Shift, Control, Alt, Meta). */
		private readonly tapped: () => string = () => "Shift",
	) {}

	/** A key went down. Returns nothing: only key-ups complete a tap. */
	keydown(key: string, repeat: boolean, now: number): void {
		if (key === this.tapped()) {
			if (repeat) {
				this.dirty = true;
				return;
			}
			this.downAt = now;
			this.dirty = false;
			return;
		}
		// Any other key, alone or with Shift, cancels a pending pair.
		this.dirty = true;
		this.downAt = -1;
		this.lastTapAt = -Infinity;
	}

	/** A key went up at `now`: true when this completes a double tap. */
	keyup(key: string, now: number): boolean {
		if (key !== this.tapped()) return false;
		const clean = this.downAt >= 0 && !this.dirty && now - this.downAt < this.interval();
		this.downAt = -1;
		if (!clean) {
			this.lastTapAt = -Infinity;
			return false;
		}
		if (now - this.lastTapAt <= this.interval()) {
			this.lastTapAt = -Infinity;
			return true;
		}
		this.lastTapAt = now;
		return false;
	}

	/** A mouse press between taps (Shift-click to select a range): no pair. */
	cancel(): void {
		this.dirty = true;
		this.lastTapAt = -Infinity;
	}

	/** Forget any half tap (the window lost focus). */
	reset(): void {
		this.downAt = -1;
		this.lastTapAt = -Infinity;
		this.dirty = false;
	}
}
