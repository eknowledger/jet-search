/**
 * Scopes as stored in data.json: a name, aliases, rules that say which notes
 * belong, how the rules combine, and how typing the name behaves. Generated scopes remember where they
 * were found and the rules generation gave them, so generating again can tell new, changed and gone
 * from your own edits. Pure: no Obsidian imports.
 */

export type Rule =
	/** The folder and its subfolders. */
	| { kind: "folder"; path: string }
	/** A property whose link resolves to `target` (a note path), so every spelling of the link counts. */
	| { kind: "property"; key: string; target: string }
	/** A property with a plain value (case-insensitive). */
	| { kind: "property"; key: string; value: string }
	/** A tag and its nested tags (case-insensitive). */
	| { kind: "tag"; tag: string };

export type Mode = "suggest" | "auto" | "in-only";

export type Scope = {
	id: string;
	name: string;
	aliases: string[];
	/** The label shown next to the name ("Projects", "Clients"), from where it was found; "" if none. */
	kind: string;
	rules: Rule[];
	combine: "any" | "all";
	mode: Mode;
	source: "generated" | "manual";
	/** Where generation found it ("Projects" container, "category" property, "#client" tag root). */
	origin?: { kind: string; at: string };
	/** The rules generation gave it, to tell its own rules from your edits when generated again. */
	generated?: Rule[];
};

const MODES: readonly Mode[] = ["suggest", "auto", "in-only"];

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** A rule as stored, cleaned (trailing slashes, a leading # on tags), or null if it is not one. */
const rule = (raw: unknown): Rule | null => {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	if (r.kind === "folder") {
		const path = str(r.path)?.replace(/\/+$/, "");
		return path ? { kind: "folder", path } : null;
	}
	if (r.kind === "tag") {
		const tag = str(r.tag);
		return tag ? { kind: "tag", tag: tag.startsWith("#") ? tag : `#${tag}` } : null;
	}
	if (r.kind === "property") {
		const key = str(r.key);
		if (!key) return null;
		const target = str(r.target);
		if (target) return { kind: "property", key, target };
		const value = str(r.value);
		return value ? { kind: "property", key, value } : null;
	}
	return null;
};

const rules = (raw: unknown): Rule[] => (Array.isArray(raw) ? raw.map(rule).filter((x): x is Rule => x !== null) : []);

/** A short stable id from a scope's name and first rule (FNV-1a, base 36). */
export const scopeId = (name: string, rs: readonly Rule[]): string => {
	const r = rs[0];
	const key = `${name.toLowerCase()}|${r ? JSON.stringify(r) : ""}`;
	let h = 0x811c9dc5;
	for (let i = 0; i < key.length; i++) {
		h ^= key.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return `s${h.toString(36)}`;
};

/** Scopes as loaded from data.json: unknown fields dropped, bad rules skipped, defaults filled, ids unique. */
export const normalizeScopes = (raw: unknown): Scope[] => {
	if (!Array.isArray(raw)) return [];
	const out: Scope[] = [];
	const ids = new Set<string>();
	for (const x of raw) {
		if (!x || typeof x !== "object") continue;
		const r = x as Record<string, unknown>;
		const name = str(r.name);
		if (!name) continue;
		const rs = rules(r.rules);
		let id = str(r.id) ?? scopeId(name, rs);
		for (let n = 2; ids.has(id); n++) id = `${str(r.id) ?? scopeId(name, rs)}-${n}`;
		ids.add(id);
		const s: Scope = {
			id,
			name,
			aliases: Array.isArray(r.aliases) ? r.aliases.map(str).filter((a): a is string => a !== null) : [],
			kind: str(r.kind) ?? "",
			rules: rs,
			combine: r.combine === "all" ? "all" : "any",
			mode: MODES.includes(r.mode as Mode) ? (r.mode as Mode) : "suggest",
			source: r.source === "generated" ? "generated" : "manual",
		};
		const o = r.origin as Record<string, unknown> | undefined;
		if (o && str(o.kind) && str(o.at)) s.origin = { kind: str(o.kind) as string, at: str(o.at) as string };
		if (Array.isArray(r.generated)) s.generated = rules(r.generated);
		out.push(s);
	}
	return out;
};
