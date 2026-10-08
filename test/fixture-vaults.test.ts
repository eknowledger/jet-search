// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeVault, SHAPES } from "../bench/fixtures/make-vaults.mjs";

type Rule = { kind: "folder" | "property" | "tag"; key?: string; value: string; count: number };
type Scope = {
	name: string;
	aliases?: string[];
	rules: Rule[];
	members: number;
	outside: number;
	ambiguity: number;
	auto: boolean;
};
type Expected = {
	shape: string;
	notes: number;
	preset: string;
	scopes: Scope[];
	notes_on_scopes: string;
	notes_on_auto: string;
	hubs?: { note: string; links: number }[];
};
type Note = { path: string; text: string; fm: Map<string, string[]>; tags: string[] };
type Made = { shape: string; notes: number; bytes: number };
const make = makeVault as (shape: string, dir: string, opts?: { source?: string; log?: (m: string) => void }) => Made;

const RANGES: Record<string, [number, number]> = {
	para: [270, 340],
	flat: [180, 220],
	deep: [220, 280],
	"tags-only": [180, 220],
	"properties-only": [180, 220],
	"johnny-decimal": [170, 240],
	zettelkasten: [270, 330],
	"non-english": [180, 230],
};
const PRESETS: Record<string, string> = {
	para: "para",
	flat: "none",
	deep: "top-level",
	"tags-only": "tags",
	"properties-only": "properties",
	"johnny-decimal": "johnny-decimal",
	zettelkasten: "none",
	"non-english": "para",
};

// ---------- an independent reader of the generated files ----------

/** Every file under dir (dot-folders included only as names), relative with "/", sorted. */
const walk = (dir: string, rel = ""): string[] =>
	readdirSync(join(dir, rel), { withFileTypes: true })
		.flatMap((e) => {
			const r = rel ? `${rel}/${e.name}` : e.name;
			return e.isDirectory() ? (e.name.startsWith(".") ? [r] : walk(dir, r)) : [r];
		})
		.sort();

const unquote = (s: string): string => {
	const t = s.trim();
	return t.startsWith('"') && t.endsWith('"') ? (JSON.parse(t) as string) : t;
};

/** Frontmatter (key: value and block lists), inline #tags and frontmatter tags, lowercased. */
const parse = (path: string, text: string): Note => {
	const fm = new Map<string, string[]>();
	let body = text;
	if (text.startsWith("---\n")) {
		const end = text.indexOf("\n---\n", 4);
		let key = "";
		for (const line of text.slice(4, end).split("\n")) {
			const item = /^\s+-\s+(.*)$/.exec(line);
			if (item && key) {
				fm.get(key)?.push(unquote(item[1] ?? ""));
				continue;
			}
			const kv = /^([^\s:][^:]*):\s*(.*)$/.exec(line);
			if (!kv) continue;
			key = kv[1] ?? "";
			fm.set(key, kv[2] ? [unquote(kv[2])] : []);
		}
		body = text.slice(end + 5);
	}
	const inline = [...body.matchAll(/(?<=^|\s)#([\p{L}\p{N}_/-]+)/gmu)].map((m) => m[1] ?? "");
	const tags = [...(fm.get("tags") ?? []), ...inline].map((t) => t.toLowerCase());
	return { path, text, fm, tags };
};

const readVault = (dir: string): Note[] =>
	walk(dir)
		.filter((p) => p.endsWith(".md"))
		.map((p) => parse(p, readFileSync(join(dir, p), "utf8")));

/** The note a property value names: [[X]], [[path/X]] and [[X|alias]] all give "x"; plain values lowercase. */
const target = (v: string): string => {
	const m = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/.exec(v.trim());
	const t = m ? (m[1]?.split("/").pop() ?? "").replace(/\.md$/i, "") : v;
	return t.trim().toLowerCase();
};

const matches = (n: Note, r: Rule): boolean => {
	if (r.kind === "folder") return n.path.startsWith(`${r.value}/`);
	if (r.kind === "property") return (n.fm.get(r.key ?? "") ?? []).some((v) => target(v) === target(r.value));
	const t = r.value.replace(/^#/, "").toLowerCase();
	return n.tags.some((x) => x === t || x.startsWith(`${t}/`));
};

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (text: string, name: string): boolean =>
	CJK.test(name)
		? text.includes(name)
		: new RegExp(`(?<![\\p{L}\\p{N}])${esc(name)}(?![\\p{L}\\p{N}])`, "iu").test(text);

const fingerprint = (dir: string): string[] =>
	walk(dir).map((p) => {
		const full = join(dir, p);
		const st = statSync(full);
		if (st.isDirectory()) return `${p}/`;
		return `${p} ${createHash("sha256").update(readFileSync(full)).digest("hex")} ${st.mtimeMs}`;
	});

const share = (notes: Note[], root: string): number =>
	notes.filter((n) => n.tags.some((t) => t.startsWith(`${root}/`))).length / notes.length;

// ---------- the shapes ----------

let root = "";
const vaults = new Map<string, { expected: Expected; notes: Note[]; dir: string; ms: number }>();

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "jet-fixtures-"));
	for (const shape of SHAPES as string[]) {
		const dir = join(root, "a", shape);
		const t0 = performance.now();
		make(shape, dir);
		const ms = performance.now() - t0;
		const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")) as Expected;
		vaults.set(shape, { expected, notes: readVault(dir), dir, ms });
	}
});

afterAll(() => {
	if (root) rmSync(root, { recursive: true, force: true });
});

const get = (shape: string) => {
	const v = vaults.get(shape);
	if (!v) throw new Error(`no vault for ${shape}`);
	return v;
};

describe("fixture vaults", () => {
	it("has the default shapes, without x10", () => {
		expect(SHAPES).toEqual(Object.keys(RANGES));
	});

	describe.each(SHAPES as string[])("%s", (shape) => {
		it("has the right number of notes, an empty .obsidian and expected.json", () => {
			const { expected, notes, dir } = get(shape);
			const [lo, hi] = RANGES[shape] ?? [0, 0];
			expect(notes.length).toBeGreaterThanOrEqual(lo);
			expect(notes.length).toBeLessThanOrEqual(hi);
			expect(expected.notes).toBe(notes.length);
			expect(expected.shape).toBe(shape);
			expect(expected.preset).toBe(PRESETS[shape]);
			expect(readdirSync(join(dir, ".obsidian"))).toEqual([]);
			expect(expected.notes_on_scopes.length).toBeGreaterThan(0);
			expect(expected.notes_on_auto.length).toBeGreaterThan(0);
		});

		it("counts members, rules and mentions the way the files say", () => {
			const { expected, notes } = get(shape);
			for (const s of expected.scopes) {
				for (const r of s.rules)
					expect(notes.filter((n) => matches(n, r)).length, `${s.name} ${r.value}`).toBe(r.count);
				const members = notes.filter((n) => s.rules.some((r) => matches(n, r)));
				expect(members.length, s.name).toBe(s.members);
				const inside = new Set(members);
				const outside = notes.filter((n) => !inside.has(n) && mentions(n.text, s.name)).length;
				expect(outside, `${s.name} outside`).toBe(s.outside);
				expect(s.ambiguity).toBe(Math.round((outside / members.length) * 100) / 100);
				expect(s.auto).toBe(s.ambiguity <= 1);
				// Far enough from the threshold that a slightly different mention count cannot flip Auto.
				expect(s.ambiguity <= 0.7 || s.ambiguity >= 1.4, `${s.name} ambiguity ${s.ambiguity}`).toBe(true);
				expect(s.members).toBeGreaterThanOrEqual(5);
			}
		});

		it("is deterministic: same files, bytes and mtimes", () => {
			const { dir } = get(shape);
			const again = join(root, "b", shape);
			make(shape, again);
			expect(fingerprint(again)).toEqual(fingerprint(dir));
		});

		it("is small and quick to make", () => {
			const { dir, ms } = get(shape);
			const bytes = walk(dir)
				.filter((p) => p.endsWith(".md"))
				.reduce((sum, p) => sum + statSync(join(dir, p)).size, 0);
			expect(bytes).toBeLessThan(10e6);
			// About 0.3 s alone; the whole suite runs files in parallel, so the bound leaves room for that.
			expect(ms).toBeLessThan(3000);
		});
	});

	it("para: projects and areas merge folder, property and tag; Team is not safe for Auto", () => {
		const { expected, notes } = get("para");
		expect(expected.scopes.map((s) => s.name)).toEqual([
			"Basalt",
			"Kestrel",
			"Lumen",
			"Orchard Rewrite",
			"Team",
			"Zephyr",
			"Finance",
			"Fitness",
			"Garden",
			"Mentoring",
		]);
		for (const s of expected.scopes) {
			const folder = s.rules.find((r) => r.kind === "folder");
			expect(s.members, s.name).toBeGreaterThan(folder?.count ?? 0);
		}
		const team = expected.scopes.find((s) => s.name === "Team");
		expect(team?.auto).toBe(false);
		expect(team?.ambiguity).toBeGreaterThan(2);
		expect(expected.scopes.filter((s) => s.auto)).toHaveLength(9);
		const values = notes.flatMap((n) => n.fm.get("project") ?? []);
		expect(values).toContain("[[Basalt]]");
		expect(values).toContain("[[2.Projects/Basalt/Basalt]]");
		expect(values.some((v) => v.startsWith("[[Basalt|"))).toBe(true);
		expect(notes.some((n) => (n.fm.get("project")?.length ?? 0) > 1)).toBe(true);
		for (const top of ["1.Inbox", "4.Resources", "5.Journal", "6.Archive"]) {
			expect(expected.scopes.some((s) => s.rules.some((r) => r.value.startsWith(top)))).toBe(false);
		}
	});

	it("flat: no folders, no frontmatter, no scopes", () => {
		const { expected, notes } = get("flat");
		expect(notes.every((n) => !n.path.includes("/") && n.fm.size === 0)).toBe(true);
		expect(notes.some((n) => n.tags.length > 0)).toBe(true);
		expect(expected.scopes).toEqual([]);
	});

	it("deep: folders 5–7 levels deep, one scope per top-level folder with at least 5 notes", () => {
		const { expected, notes } = get("deep");
		const depth = Math.max(...notes.map((n) => n.path.split("/").length - 1));
		expect(depth).toBeGreaterThanOrEqual(5);
		expect(depth).toBeLessThanOrEqual(7);
		expect(notes.filter((n) => n.path.split("/").length - 1 >= 5).length / notes.length).toBeGreaterThan(0.6);
		expect(expected.scopes.map((s) => s.name)).toEqual(["Work", "Personal", "Learning", "Notes"]);
		expect(notes.filter((n) => n.path.startsWith("Misc/")).length).toBeLessThan(5);
		expect(expected.scopes.find((s) => s.name === "Notes")?.auto).toBe(false);
	});

	it("tags-only: two roots over 5% become scopes, the root under 5% does not", () => {
		const { expected, notes } = get("tags-only");
		expect(notes.every((n) => !n.path.includes("/"))).toBe(true);
		expect(notes.every((n) => [...n.fm.keys()].every((k) => k === "tags"))).toBe(true);
		expect(share(notes, "project")).toBeGreaterThanOrEqual(0.05);
		expect(share(notes, "client")).toBeGreaterThanOrEqual(0.05);
		expect(share(notes, "reading")).toBeLessThan(0.05);
		expect(share(notes, "reading")).toBeGreaterThan(0);
		expect(expected.scopes.map((s) => s.rules[0]?.value)).toEqual([
			"#project/alpha",
			"#project/beta",
			"#project/gamma",
			"#client/acme",
			"#client/globex",
			"#client/general",
		]);
		expect(notes.some((n) => n.tags.includes("project/alpha/design"))).toBe(true);
		expect(notes.some((n) => n.fm.has("tags"))).toBe(true);
		expect(expected.scopes.find((s) => s.name === "general")?.auto).toBe(false);
	});

	it("properties-only: category and client become scopes; id, created and course do not", () => {
		const { expected, notes } = get("properties-only");
		const keys = new Set(expected.scopes.flatMap((s) => s.rules.map((r) => r.key)));
		expect([...keys]).toEqual(["category", "client"]);
		expect(new Set(notes.flatMap((n) => n.fm.get("id") ?? [])).size).toBe(notes.length);
		expect(new Set(notes.flatMap((n) => n.fm.get("created") ?? [])).size).toBeGreaterThan(50);
		expect(notes.filter((n) => n.fm.has("course")).length / notes.length).toBeLessThan(0.05);
		const categories = new Set(notes.flatMap((n) => n.fm.get("category") ?? []).map((c) => c.toLowerCase()));
		expect(categories.size).toBeLessThanOrEqual(12);
		expect(notes.every((n) => n.tags.length === 0 && !n.path.includes("/"))).toBe(true);
		expect(expected.scopes.find((s) => s.name === "Meeting")?.auto).toBe(false);
	});

	it("johnny-decimal: one scope per area range and per category", () => {
		const { expected, notes } = get("johnny-decimal");
		const jd = /^\d0-\d9 [^/]+\/\d\d [^/]+\/(\d\d\.\d\d [^/]+\/)?[^/]+\.md$/;
		expect(notes.filter((n) => !jd.test(n.path)).map((n) => n.path)).toEqual(["00.00 Index.md"]);
		expect(expected.scopes).toHaveLength(4 + 11);
		for (const s of expected.scopes) {
			const value = s.rules[0]?.value ?? "";
			expect(value.endsWith(s.name)).toBe(true);
			expect(
				value
					.split("/")
					.pop()
					?.startsWith(s.aliases?.[0] ?? "?"),
			).toBe(true);
		}
	});

	it("zettelkasten: timestamp-named notes, heavy links, hubs, no scopes", () => {
		const { expected, notes } = get("zettelkasten");
		const zettels = notes.filter((n) => /^\d{12} /.test(n.path));
		expect(zettels.length).toBeGreaterThan(280);
		const links = zettels.map((n) => (n.text.match(/\[\[/g) ?? []).length);
		expect(links.reduce((a, b) => a + b, 0) / links.length).toBeGreaterThanOrEqual(3);
		expect(expected.scopes).toEqual([]);
		expect(expected.hubs?.length).toBe(6);
		for (const h of expected.hubs ?? []) {
			const hub = notes.find((n) => n.path === h.note);
			expect(hub?.text.match(/^- \[\[/gm)?.length).toBe(h.links);
		}
	});

	it("non-english: names in French, German, Japanese and Arabic", () => {
		const { expected, notes } = get("non-english");
		const paths = notes.map((n) => n.path).join("\n");
		expect(paths).toMatch(/[éèàçÜ]/u);
		expect(paths).toMatch(/[\p{Script=Han}\p{Script=Katakana}]/u);
		expect(paths).toMatch(/\p{Script=Arabic}/u);
		expect(paths).toContain("2.Projets/Réseau/");
		expect(paths).toContain("2.Projets/音声/");
		expect(expected.scopes.map((s) => s.name)).toContain("Übersetzung");
		expect(expected.scopes.map((s) => s.name)).toContain("المكتبة");
		const values = notes.flatMap((n) => n.fm.get("domaine") ?? []);
		expect(values).toContain("Santé");
		expect(expected.scopes.find((s) => s.name === "家族")?.auto).toBe(false);
	});

	it("refuses to replace a folder that is not a fixture vault", () => {
		const dir = join(root, "not-a-vault");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "keep.md"), "# Keep me\n");
		expect(() => make("flat", dir)).toThrow(/not a fixture vault/);
		expect(readFileSync(join(dir, "keep.md"), "utf8")).toBe("# Keep me\n");
	});
});

describe("x10 corpus", () => {
	it("copies a source nine times, suffixing its rare long words per copy", () => {
		const src = join(root, "x10-source");
		mkdirSync(join(src, "Zoo"), { recursive: true });
		mkdirSync(join(src, ".obsidian"), { recursive: true });
		// Only quokka (one note) and cassowary (two notes) are rare words of six or more letters; pelican is in
		// four notes and emu is short, so they stay.
		const common = "pelican pelican";
		writeFileSync(join(src, "Zoo", "Quokka facts.md"), `# Quokka facts\n\nThe quokka is here. ${common} emu\n`);
		writeFileSync(join(src, "Birds.md"), `# Birds\n\n${common} and a cassowary.\n`);
		writeFileSync(join(src, "Coast.md"), `# Coast\n\nA ${common} on the jetty.\n`);
		writeFileSync(join(src, "Day.md"), "# Day\n\nNo news.\n");
		writeFileSync(join(src, "Dusk.md"), `# Dusk\n\n${common}, cassowary again.\n`);
		writeFileSync(join(src, ".obsidian", "app.md"), "ignored\n");
		writeFileSync(join(src, "photo.png"), "not markdown");
		const out = join(root, "x10-out", "x10");
		const lines: string[] = [];
		const r = make("x10", out, { source: src, log: (m) => lines.push(m) });
		expect(r.notes).toBe(50);
		expect(JSON.parse(readFileSync(join(out, "expected.json"), "utf8"))).toEqual({ shape: "x10", notes: 50 });
		expect(lines.length).toBeGreaterThan(0);
		expect(walk(out).filter((p) => p.endsWith(".md"))).toHaveLength(50);
		expect(readdirSync(join(out, ".obsidian"))).toEqual([]);
		const original = readFileSync(join(src, "Zoo", "Quokka facts.md"), "utf8");
		expect(readFileSync(join(out, "Zoo", "Quokka facts.md"), "utf8")).toBe(original);
		const copy3 = join(out, "copy3", "Zoo", "Quokkak3 facts.md");
		expect(readFileSync(copy3, "utf8")).toBe(`# Quokkak3 facts\n\nThe quokkak3 is here. ${common} emu\n`);
		expect(readFileSync(join(out, "copy9", "Dusk.md"), "utf8")).toBe(`# Dusk\n\n${common}, cassowaryk9 again.\n`);
		expect(readFileSync(join(out, "copy1", "Day.md"), "utf8")).toBe("# Day\n\nNo news.\n");
		const drift = statSync(copy3).mtimeMs - statSync(join(src, "Zoo", "Quokka facts.md")).mtimeMs;
		expect(Math.abs(drift)).toBeLessThan(1);
		const again = join(root, "x10-again", "x10");
		make("x10", again, { source: src, log: () => {} });
		expect(fingerprint(again)).toEqual(fingerprint(out));
	});

	it("needs a source and refuses an output inside it", () => {
		expect(() => make("x10", join(root, "x10-none"), { log: () => {} })).toThrow(/--source/);
		const src = join(root, "x10-source");
		expect(() => make("x10", join(src, "inside"), { source: src, log: () => {} })).toThrow(/overlap/);
	});
});
