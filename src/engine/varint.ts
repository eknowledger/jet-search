/**
 * Variable-length integers: 7 bits per byte, the high bit says another byte
 * follows. Small numbers (doc-id gaps, counts) take one byte.
 */

/** A growable byte buffer for writing varints. */
export class ByteWriter {
	private buf = new Uint8Array(1024);
	length = 0;

	/** Append one non-negative integer below 2^32. */
	varint(n: number): void {
		if (this.length + 5 > this.buf.length) this.grow(this.length + 5);
		let v = n >>> 0;
		while (v >= 0x80) {
			this.buf[this.length++] = (v & 0x7f) | 0x80;
			v >>>= 7;
		}
		this.buf[this.length++] = v;
	}

	/** The bytes written so far (a copy, exactly sized). */
	bytes(): Uint8Array {
		return this.buf.slice(0, this.length);
	}

	private grow(min: number): void {
		const next = new Uint8Array(Math.max(min, this.buf.length * 2));
		next.set(this.buf.subarray(0, this.length));
		this.buf = next;
	}
}

/** Read one varint at `pos`; returns the value and leaves the next position in `at.pos`. */
export const readVarint = (bytes: Uint8Array, at: { pos: number }): number => {
	let pos = at.pos;
	let b = bytes[pos++] as number;
	let v = b & 0x7f;
	let shift = 7;
	while (b & 0x80) {
		b = bytes[pos++] as number;
		v |= (b & 0x7f) << shift;
		shift += 7;
	}
	at.pos = pos;
	return v >>> 0;
};
