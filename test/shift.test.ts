import { describe, expect, it } from "vitest";
import { DoubleTap } from "../src/shift";

const tap = (d: DoubleTap, at: number, hold = 40): boolean => {
	d.keydown("Shift", false, at);
	return d.keyup("Shift", at + hold);
};

describe("Shift-Shift detector", () => {
	it("fires on two clean taps within the interval", () => {
		const d = new DoubleTap(() => 350);
		expect(tap(d, 0)).toBe(false);
		expect(tap(d, 200)).toBe(true);
	});

	it("does not fire when the taps are too far apart", () => {
		const d = new DoubleTap(() => 350);
		tap(d, 0);
		expect(tap(d, 500)).toBe(false);
		expect(tap(d, 700)).toBe(true);
	});

	it("ignores Shift held with a letter (typing a capital)", () => {
		const d = new DoubleTap(() => 350);
		tap(d, 0);
		d.keydown("Shift", false, 100);
		d.keydown("A", false, 120);
		expect(d.keyup("Shift", 160)).toBe(false);
		expect(tap(d, 250)).toBe(false);
	});

	it("ignores key repeat and a long hold", () => {
		const d = new DoubleTap(() => 350);
		tap(d, 0);
		d.keydown("Shift", false, 100);
		d.keydown("Shift", true, 400);
		expect(d.keyup("Shift", 450)).toBe(false);
		expect(tap(d, 1000, 500)).toBe(false);
	});

	it("cancels a pair when another key comes between the taps", () => {
		const d = new DoubleTap(() => 350);
		tap(d, 0);
		d.keydown("x", false, 80);
		expect(tap(d, 120)).toBe(false);
	});

	it("follows a changed interval and forgets on reset", () => {
		let ms = 200;
		const d = new DoubleTap(() => ms);
		tap(d, 0);
		expect(tap(d, 300)).toBe(false);
		ms = 500;
		expect(tap(d, 600)).toBe(true);
		tap(d, 1000);
		d.reset();
		expect(tap(d, 1100)).toBe(false);
	});
});
