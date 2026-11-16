// A minimal Chrome DevTools Protocol client. It connects to the debugging port of the Obsidian that launch.mjs started
// (CMP_PORT, default 9346) and to nothing else. Set client.onEvent to receive protocol events.
const PORT = Number(process.env.CMP_PORT ?? 9346);

export const connect = async () => {
	const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
	const page = targets.find((t) => t.type === "page" && t.url.startsWith("app://obsidian.md"));
	if (!page) throw new Error(`no Obsidian window on port ${PORT}`);
	const ws = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.onopen = resolve;
		ws.onerror = reject;
	});
	let id = 0;
	const pending = new Map();
	const client = {};
	ws.onmessage = (event) => {
		const msg = JSON.parse(event.data);
		if (msg.method) return client.onEvent?.(msg);
		const waiter = pending.get(msg.id);
		if (!waiter) return;
		pending.delete(msg.id);
		if (msg.error) waiter.reject(new Error(msg.error.message));
		else waiter.resolve(msg.result);
	};
	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const mid = ++id;
			pending.set(mid, { resolve, reject });
			ws.send(JSON.stringify({ id: mid, method, params }));
		});
	// Emulate focus so typing lands even when the window is not in front.
	await send("Emulation.setFocusEmulationEnabled", { enabled: true });
	const evaluate = async (expression) => {
		const r = await send("Runtime.evaluate", {
			userGesture: true,
			expression: `(async () => { ${expression} })()`,
			awaitPromise: true,
			returnByValue: true,
		});
		if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
		return r.result.value;
	};
	return Object.assign(client, {
		send,
		evaluate,
		sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
		close: () => ws.close(),
	});
};
