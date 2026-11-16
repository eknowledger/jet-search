// Starts and stops the Obsidian that the comparison drives, on a profile of its own and a debugging port.
//   node launch.mjs start <vault> [vaultId]    vault = a folder name under .work/vaults
//   node launch.mjs stop | status
// Environment: OBSIDIAN_BIN (the Obsidian executable), CMP_PORT (default 9346), CMP_PROFILE (default .work/profile).
// Your own Obsidian is never touched: this one has its own user-data folder, so it is a separate instance.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORK, sleep } from "./lib.mjs";

export const PORT = Number(process.env.CMP_PORT ?? 9346);
export const PROFILE = process.env.CMP_PROFILE ?? join(WORK, "profile");

const defaultBin = () => {
	if (process.platform === "darwin") return "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
	if (process.platform === "win32") return join(process.env.LOCALAPPDATA ?? "", "Programs/Obsidian/Obsidian.exe");
	return "obsidian";
};

/** Process ids of this profile's Obsidian (main, renderers, helpers). Not available on Windows. */
export const pids = () => {
	try {
		return execFileSync("pgrep", ["-f", `user-data-dir=${PROFILE}`], { encoding: "utf8" })
			.trim()
			.split("\n")
			.filter(Boolean);
	} catch {
		return [];
	}
};

const listening = async () => {
	try {
		return (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok;
	} catch {
		return false;
	}
};

export const start = async (vault, vaultId = `cmp0${vault}`) => {
	if (pids().length || (await listening()))
		throw new Error(`something already uses profile ${PROFILE} or port ${PORT}: run "node launch.mjs stop"`);
	const bin = process.env.OBSIDIAN_BIN ?? defaultBin();
	if (bin.includes("/") && !existsSync(bin)) throw new Error(`Obsidian not found at ${bin}: set OBSIDIAN_BIN`);
	mkdirSync(PROFILE, { recursive: true });
	const path = join(WORK, "vaults", vault);
	writeFileSync(
		join(PROFILE, "obsidian.json"),
		JSON.stringify({ vaults: { [vaultId]: { path, ts: Date.now(), open: true } } }),
	);
	spawn(
		bin,
		[
			`--user-data-dir=${PROFILE}`,
			`--remote-debugging-port=${PORT}`,
			// Timers and painting must not slow down when the window is behind another one.
			"--disable-backgrounding-occluded-windows",
			"--disable-renderer-backgrounding",
			"--disable-background-timer-throttling",
		],
		{ detached: true, stdio: "ignore" },
	).unref();
	for (let i = 0; i < 80; i++) {
		if (await listening()) return;
		await sleep(500);
	}
	throw new Error("Obsidian did not start");
};

export const stop = async () => {
	const ps = pids();
	if (!ps.length) return;
	// The first pid is the main process; closing it ends the rest.
	try {
		process.kill(Number(ps[0]));
	} catch {}
	for (let i = 0; i < 40; i++) {
		if (!pids().length) return;
		await sleep(500);
	}
	for (const p of pids()) {
		try {
			process.kill(Number(p), "SIGKILL");
		} catch {}
	}
};

if (process.argv[1] === new URL(import.meta.url).pathname) {
	const [cmd, vault, id] = process.argv.slice(2);
	if (cmd === "start" && vault) {
		await start(vault, id);
		console.log(`running, port ${PORT}`);
	} else if (cmd === "stop") {
		await stop();
		console.log("stopped");
	} else if (cmd === "status") {
		console.log((await listening()) ? `running, port ${PORT}` : "not running");
	} else {
		console.log("usage: node launch.mjs start <vault> [vaultId] | stop | status");
		process.exit(2);
	}
}
