/**
 * Main-thread work in slices: the first build gathers each note from the metadata
 * cache on the main thread, and a phone is several times slower than a desktop. A batch is worked
 * through in slices of at most `budget` ms, yielding to the app between them, so typing and scrolling
 * stay smooth while the index builds.
 */

/** Let the app run (input, paint) and come back: scheduler.yield where there is one, else a posted task (never a timer, which a hidden window slows to a second). */
export const yieldNow = (): Promise<void> => {
	const s = (window as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
	if (typeof s?.yield === "function") return s.yield();
	return new Promise((resolve) => {
		const ch = new MessageChannel();
		ch.port1.onmessage = () => {
			ch.port1.close();
			resolve();
		};
		ch.port2.postMessage(0);
	});
};

/** `fn` over `items` in order, yielding whenever a slice has run `budget` ms. */
export const sliced = async <T, R>(
	items: readonly T[],
	fn: (item: T, i: number) => R,
	budget = 8,
	now: () => number = () => performance.now(),
	pause: () => Promise<void> = yieldNow,
): Promise<R[]> => {
	const out: R[] = [];
	let t0 = now();
	for (let i = 0; i < items.length; i++) {
		out.push(fn(items[i] as T, i));
		if (i < items.length - 1 && now() - t0 >= budget) {
			await pause();
			t0 = now();
		}
	}
	return out;
};
