/**
 * Getting the meaning model: after you confirm, Jet downloads the model's two files
 * from Hugging Face at a pinned revision, checks each against its pinned SHA-256, packs them (int8) and
 * keeps the packed file in its own folder. Or you give it the two files you already have (no network).
 * Nothing else goes over the network.
 */
import { type App, normalizePath, requestUrl } from "obsidian";
import { MODEL, packModel } from "./model";

export const MODEL_FILE = `meaning-${MODEL.id}.bin`;

const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Whether a file is the pinned one. */
export const checks = async (name: keyof typeof MODEL.files, buf: ArrayBuffer): Promise<boolean> =>
	hex(await crypto.subtle.digest("SHA-256", buf)) === MODEL.files[name];

export const fileUrl = (name: string): string =>
	`https://huggingface.co/${MODEL.repo}/resolve/${MODEL.revision}/${name}`;

const path = (dir: string): string => normalizePath(`${dir}/${MODEL_FILE}`);

/** Check, pack and keep the two files; the packed size in bytes. */
export const install = async (
	app: App,
	dir: string,
	files: { "model.safetensors": ArrayBuffer; "tokenizer.json": ArrayBuffer },
): Promise<number> => {
	for (const name of Object.keys(MODEL.files) as Array<keyof typeof MODEL.files>)
		if (!(await checks(name, files[name])))
			throw new Error(`${name} is not the expected file (its checksum differs); nothing was installed`);
	const packed = packModel(files["model.safetensors"], new TextDecoder().decode(files["tokenizer.json"]));
	await app.vault.adapter.writeBinary(path(dir), packed);
	return packed.byteLength;
};

/** Download the two files (about 31 MB), then install them. */
export const download = async (app: App, dir: string, progress?: (step: string) => void): Promise<number> => {
	const get = async (name: keyof typeof MODEL.files): Promise<ArrayBuffer> => {
		progress?.(`Downloading ${name}…`);
		const r = await requestUrl({ url: fileUrl(name), method: "GET" });
		if (r.status !== 200) throw new Error(`Downloading ${name} failed (HTTP ${r.status})`);
		return r.arrayBuffer;
	};
	const files = {
		"model.safetensors": await get("model.safetensors"),
		"tokenizer.json": await get("tokenizer.json"),
	};
	progress?.("Checking and packing…");
	return install(app, dir, files);
};

/** The packed model, or null when it is not installed. */
export const readModel = async (app: App, dir: string): Promise<ArrayBuffer | null> => {
	const p = path(dir);
	if (!(await app.vault.adapter.exists(p))) return null;
	return app.vault.adapter.readBinary(p);
};

export const removeModel = async (app: App, dir: string): Promise<void> => {
	const p = path(dir);
	if (await app.vault.adapter.exists(p)) await app.vault.adapter.remove(p);
};
