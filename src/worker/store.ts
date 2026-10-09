/**
 * Where the worker keeps the index: IndexedDB, one database per vault id, outside
 * the vault. A small registry database remembers when each vault's index was last used, so indexes of
 * vaults not opened for 90 days are deleted.
 */

import type { SavedVectors } from "../meaning/vectors";

export type Saved = { base: ArrayBuffer; sidecar: Uint8Array; savedAt: number; version: number };
/** A save: without `base`, only the sidecar and meta are written (the base did not change). */
export type Save = { base?: ArrayBuffer; sidecar: Uint8Array; savedAt: number; version: number };

/** What the router needs from storage; tests pass an in-memory one. */
export type Store = {
	load(): Promise<Saved | null>;
	save(s: Save): Promise<void>;
	clear(): Promise<void>;
	/** Search by meaning's note vectors, apart from the index: saved when they change. */
	loadVectors?(): Promise<SavedVectors | null>;
	saveVectors?(v: SavedVectors | null): Promise<void>;
};

const REGISTRY = "jet-search";
const STALE_MS = 90 * 86_400_000;

const request = <T>(r: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		r.onsuccess = () => resolve(r.result);
		r.onerror = () => reject(r.error ?? new Error("IndexedDB request failed"));
	});

const done = (t: IDBTransaction): Promise<void> =>
	new Promise((resolve, reject) => {
		t.oncomplete = () => resolve();
		t.onerror = () => reject(t.error ?? new Error("IndexedDB transaction failed"));
		t.onabort = () => reject(t.error ?? new Error("IndexedDB transaction aborted"));
	});

const open = (name: string, store: string): Promise<IDBDatabase> => {
	const r = indexedDB.open(name, 1);
	r.onupgradeneeded = () => {
		if (!r.result.objectStoreNames.contains(store)) r.result.createObjectStore(store);
	};
	return request(r);
};

/** The vault's index in IndexedDB (`jet-search/<vaultId>`): base, sidecar and meta written in one transaction. */
export const idbStore = (vaultId: string): Store => {
	const name = `${REGISTRY}/${vaultId}`;
	let db: Promise<IDBDatabase> | null = null;
	const get = (): Promise<IDBDatabase> => (db ??= open(name, "index"));
	return {
		async load() {
			const d = await get();
			const t = d.transaction("index", "readonly");
			const s = t.objectStore("index");
			const [base, sidecar, meta] = await Promise.all([
				request(s.get("base") as IDBRequest<ArrayBuffer | undefined>),
				request(s.get("sidecar") as IDBRequest<Uint8Array | undefined>),
				request(s.get("meta") as IDBRequest<{ savedAt: number; version: number } | undefined>),
			]);
			if (!base || !meta) return null;
			return { base, sidecar: sidecar ?? new Uint8Array(0), savedAt: meta.savedAt, version: meta.version };
		},
		async save(x) {
			const d = await get();
			const t = d.transaction("index", "readwrite");
			const s = t.objectStore("index");
			// One transaction: a crash leaves either the old index or the new one, never a mix.
			if (x.base) s.put(x.base, "base");
			s.put(x.sidecar, "sidecar");
			s.put({ savedAt: x.savedAt, version: x.version }, "meta");
			await done(t);
			await touch(vaultId);
		},
		async clear() {
			const d = await get();
			const t = d.transaction("index", "readwrite");
			t.objectStore("index").clear();
			await done(t);
		},
		async loadVectors() {
			const d = await get();
			const t = d.transaction("index", "readonly");
			const v = await request(t.objectStore("index").get("vectors") as IDBRequest<SavedVectors | undefined>);
			return v ?? null;
		},
		async saveVectors(v) {
			const d = await get();
			const t = d.transaction("index", "readwrite");
			if (v) t.objectStore("index").put(v, "vectors");
			else t.objectStore("index").delete("vectors");
			await done(t);
		},
	};
};

/** Note that this vault's index was used; delete the indexes of vaults unused for 90 days. */
export const touch = async (vaultId: string, now = Date.now()): Promise<string[]> => {
	const d = await open(REGISTRY, "vaults");
	const t = d.transaction("vaults", "readwrite");
	const s = t.objectStore("vaults");
	const keys = (await request(s.getAllKeys())) as string[];
	const stale: string[] = [];
	for (const k of keys) {
		if (k === vaultId) continue;
		const last = (await request(s.get(k) as IDBRequest<number | undefined>)) ?? 0;
		if (now - last > STALE_MS) {
			stale.push(k);
			s.delete(k);
		}
	}
	s.put(now, vaultId);
	await done(t);
	d.close();
	for (const k of stale) indexedDB.deleteDatabase(`${REGISTRY}/${k}`);
	return stale;
};

/** A store in memory, for tests and when IndexedDB is unavailable (search still works). */
export const memoryStore = (): Store & { saved: Saved | null; vectors: SavedVectors | null } => {
	const m = {
		saved: null as Saved | null,
		vectors: null as SavedVectors | null,
		loadVectors: () => Promise.resolve(m.vectors),
		saveVectors: (v: SavedVectors | null) => {
			m.vectors = v;
			return Promise.resolve();
		},
		load: () => Promise.resolve(m.saved),
		save: (s: Save) => {
			const base = s.base ? s.base.slice(0) : m.saved?.base;
			if (base) m.saved = { base, sidecar: s.sidecar.slice(), savedAt: s.savedAt, version: s.version };
			return Promise.resolve();
		},
		clear: () => {
			m.saved = null;
			return Promise.resolve();
		},
	};
	return m;
};
