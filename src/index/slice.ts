/**
 * Main-thread work in slices: the first build gathers each note from the metadata
 * cache on the main thread, and a phone is several times slower than a desktop. A batch is worked
 * through in slices of at most `budget` ms, yielding to the app between them, so typing and scrolling
 * stay smooth while the index builds.
 */

/** Let the app run (input, paint) and come back as a task of its own, queued behind what is already waiting (a worker's reply, say). Not a timer, which a hidden window slows to a second. */
export const yieldTask = (): Promise<void> =>
	new Promise((resolve) => {
		const ch = new MessageChannel();
		ch.port1.onmessage = () => {
			ch.port1.close();
			resolve();
		};
		ch.port2.postMessage(0);
	});

/** Let the app run and come back: scheduler.yield where there is one (it resumes ahead of other waiting tasks), else `yieldTask`. */
export const yieldNow = (): Promise<void> => {
	const s = (window as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
	if (typeof s?.yield === "function") return s.yield();
	return yieldTask();
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
