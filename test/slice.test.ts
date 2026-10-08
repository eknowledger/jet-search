import { describe, expect, it } from "vitest";
import { sliced, yieldNow } from "../src/index/slice";

describe("main-thread work in slices", () => {
	it("yields once a slice has run its budget, keeps order, never yields after the last item", async () => {
		let t = 0;
		const pauses: number[] = [];
		const out = await sliced(
			[1, 2, 3, 4, 5],
			(x, i) => {
				t += 3; // each item costs 3 ms
				return x * 10 + i;
			},
			8,
			() => t,
			async () => void pauses.push(t),
		);
		expect(out).toEqual([10, 21, 32, 43, 54]);
		// 3, 6, 9 → pause (9 ≥ 8); 12, 15 → 6 since the pause, the end.
		expect(pauses).toEqual([9]);
	});

	it("nothing to do: no pause", async () => {
		let pauses = 0;
		expect(
			await sliced(
				[],
				(x) => x,
				8,
				() => 0,
				async () => void pauses++,
			),
		).toEqual([]);
		expect(pauses).toBe(0);
	});

	it("yields to the event loop for real", async () => {
		let ran = false;
		setTimeout(() => (ran = true), 0);
		for (let i = 0; i < 50 && !ran; i++) await yieldNow();
		await new Promise((r) => setTimeout(r, 5));
		expect(ran).toBe(true);
	});
});
