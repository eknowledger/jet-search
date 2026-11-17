// Diagram definitions. Add a diagram by building one with diagram(...) and
// listing it in the export at the bottom. See README.md.
import { diagram, box, cylinder, group, arrow, note } from "./lib.mjs";

// The whole plugin: what Obsidian gives it, the two threads, and what is kept on disk.
const X = [40, 290, 540, 860, 1130];
const Y = [110, 260, 410, 560];
const system = diagram("system", { width: 1360, height: 780, seed: 11 }, [
	group("g-obs", { label: "Obsidian", around: ["workspace", "vault"], pad: 26 }),
	group("g-main", { label: "Main thread: decides and draws", around: ["modal", "search", "names", "scopes", "feeder", "meaning"], pad: 26 }),
	group("g-work", { label: "Worker: holds the index", around: ["engine", "router", "vectors"], pad: 26 }),

	box("workspace", { x: X[0], y: Y[0], w: 190, h: 96, title: "Workspace", sub: ["Shift Shift, commands", "editor, settings"] }),
	box("vault", { x: X[0], y: Y[2], w: 190, h: 96, title: "Vault", sub: ["files, metadata cache", "change events"] }),

	box("modal", { x: X[1], y: Y[0], w: 190, h: 96, title: "Modal and host", sub: ["rows, keys, preview"], rounded: true }),
	box("names", { x: X[1], y: Y[1], w: 190, h: 96, title: "Names tier", sub: ["same frame as the key"] }),
	box("feeder", { x: X[1], y: Y[2], w: 190, h: 96, title: "Feeder", sub: ["reads notes in batches"] }),

	box("search", { x: X[2], y: Y[0], w: 190, h: 96, title: "Search", sub: ["merges both answers"], accent: true }),
	box("scopes", { x: X[2], y: Y[1], w: 190, h: 96, title: "Scopes, filters", sub: ["which notes may match"] }),
	box("meaning", { x: X[2], y: Y[3], w: 190, h: 96, title: "Meaning", sub: ["model, answers"] }),

	box("engine", { x: X[3], y: Y[0], w: 190, h: 96, title: "JetEngine", sub: ["words, typos, BM25"] }),
	box("router", { x: X[3], y: Y[1], w: 190, h: 96, title: "Router", sub: ["one message at a time"], accent: true }),
	box("vectors", { x: X[3], y: Y[2], w: 190, h: 96, title: "Vectors", sub: ["int8 vector per note"] }),

	cylinder("idb", { x: X[4], y: Y[1] - 12, w: 170, h: 130, title: "IndexedDB", sub: ["index, vectors"] }),
	cylinder("folder", { x: X[0] + 10, y: Y[3] - 14, w: 170, h: 130, title: "Plugin folder", sub: ["data.json, model"] }),

	arrow("workspace", "modal", { label: "open" }),
	arrow("modal", "search", { label: "text" }),
	arrow("search", "names", { elbow: true, fromSide: "b", toSide: "t", fromAt: 0.2, toAt: 0.8, label: "sync" }),
	arrow("search", "router", { elbow: true, fromSide: "r", toSide: "l", fromAt: 0.5, toAt: 0.3, label: "query" }),
	arrow("scopes", "router", { toAt: 0.6, label: "allow" }),
	arrow("vault", "feeder", { label: "notes" }),
	arrow("feeder", "router", { elbow: true, fromSide: "r", toSide: "l", fromAt: 0.5, toAt: 0.85, label: "batches" }),
	arrow("router", "engine"),
	arrow("router", "vectors"),
	arrow("meaning", "vectors", { elbow: true, fromSide: "r", toSide: "l", fromAt: 0.5, toAt: 0.7, dashed: true, label: "nearest" }),
	arrow("router", "idb", { dashed: true, label: "save" }),
	arrow("meaning", "folder", { dashed: true, label: "model" }),

	note("legend", { x: 540, y: 710, text: "solid: the user waits for it, dashed: in the background" }),
]);

// One keystroke: names paint in the same frame, the worker answers a few milliseconds later.
const KX = [40, 270, 500, 730, 960, 1190];
const keystroke = diagram("keystroke", { width: 1400, height: 660, seed: 5 }, [
	group("g-main", { label: "Main thread", x: 20, y: 62, w: 1360, h: 330 }),
	group("g-work", { label: "Worker", around: ["router", "engine"], pad: 26 }),

	box("input", { x: KX[0], y: 120, w: 170, h: 84, title: "Key", sub: ["input event"], rounded: true }),
	box("refresh", { x: KX[1], y: 120, w: 170, h: 84, title: "refresh", sub: ["chips, scope, seq"] }),
	box("list", { x: KX[2], y: 120, w: 170, h: 84, title: "Search.list", sub: ["starts both tiers"], accent: true }),
	box("names", { x: KX[3], y: 120, w: 170, h: 84, title: "NameIndex", sub: ["names, paths"] }),
	box("compose", { x: KX[4], y: 120, w: 170, h: 84, title: "composeHits", sub: ["Titles, In text"], accent: true }),
	box("paint", { x: KX[5], y: 120, w: 170, h: 84, title: "Paint", sub: ["rows keep place"], rounded: true }),
	box("excerpt", { x: KX[5], y: 270, w: 170, h: 84, title: "Excerpts", sub: ["first 24 rows"] }),
	box("router", { x: KX[2], y: 470, w: 170, h: 84, title: "Router", sub: ["latest query only"] }),
	box("engine", { x: KX[3], y: 470, w: 170, h: 84, title: "JetEngine", sub: ["words, typos, rank"] }),

	arrow("input", "refresh"),
	arrow("refresh", "list"),
	arrow("list", "names", { label: "1" }),
	arrow("names", "compose", { label: "hits" }),
	arrow("compose", "paint", { label: "paint" }),
	arrow("list", "router", { dashed: true, label: "2" }),
	arrow("router", "engine"),
	arrow("engine", "compose", { dashed: true, elbow: true, fromSide: "r", toSide: "b", fromAt: 0.5, toAt: 0.25, label: "3" }),
	arrow("compose", "excerpt", { elbow: true, fromSide: "b", toSide: "l", fromAt: 0.8, toAt: 0.5, label: "4" }),

	note("legend", { x: 40, y: 600, text: "1 names answer in the key's frame   2 the query goes to the worker   3 hits come back   4 excerpts are cut from the notes\nEach paint draws the whole list again. The selection follows the note, not the row number." }),
]);

// The engine: from a note to terms, to a segment, to a ranked list.
const engine = diagram("engine", { width: 1300, height: 660, seed: 9 }, [
	group("g-build", { label: "Build: a note becomes a segment", around: ["raw", "fields", "analyzer", "segment", "store"], pad: 28 }),
	group("g-query", { label: "Query: words become a ranked list", around: ["expand", "score", "rank"], pad: 28 }),

	box("raw", { x: 40, y: 110, w: 200, h: 84, title: "RawNote", sub: ["text, headings, tags"], rounded: true }),
	box("fields", { x: 300, y: 110, w: 200, h: 84, title: "fieldsFromRaw", sub: ["name, h1, tags, body"] }),
	box("analyzer", { x: 560, y: 110, w: 200, h: 84, title: "tokenize", sub: ["one set of rules"], accent: true }),
	box("segment", { x: 820, y: 110, w: 200, h: 84, title: "buildSegment", sub: ["terms, postings"] }),
	cylinder("store", { x: 1080, y: 88, w: 170, h: 130, title: "Segments", sub: ["frozen, delta, dead"] }),

	box("stem", { x: 40, y: 400, w: 200, h: 84, title: "Stemmers", sub: ["nine languages"] }),
	box("typos", { x: 40, y: 530, w: 200, h: 84, title: "Typo walk", sub: ["sorted terms"] }),
	box("expand", { x: 330, y: 460, w: 200, h: 84, title: "expand", sub: ["forms, prefix, typos"], accent: true }),
	box("score", { x: 620, y: 460, w: 200, h: 84, title: "score", sub: ["weight x idf x field"] }),
	box("rank", { x: 910, y: 460, w: 200, h: 84, title: "rank", sub: ["matched, boosts, top k"], rounded: true }),

	arrow("raw", "fields"),
	arrow("fields", "analyzer"),
	arrow("analyzer", "segment"),
	arrow("segment", "store", { label: "freeze" }),
	arrow("stem", "expand", { dashed: true, toAt: 0.3 }),
	arrow("typos", "expand", { dashed: true, toAt: 0.7 }),
	arrow("expand", "score"),
	arrow("score", "rank"),
	arrow("store", "score", { elbow: true, fromSide: "b", toSide: "t", fromAt: 0.5, toAt: 0.5, dashed: true, label: "postings" }),
]);

// Getting notes in and keeping them current.
const indexing = diagram("indexing", { width: 1100, height: 660, seed: 3 }, [
	group("g-main", { label: "Main thread", around: ["events", "feeder", "gather", "client"], pad: 28 }),
	group("g-work", { label: "Worker", around: ["router", "fields", "engine"], pad: 28 }),

	box("events", { x: 40, y: 110, w: 200, h: 84, title: "Obsidian events", sub: ["modify, create, rename"], rounded: true }),
	box("feeder", { x: 300, y: 110, w: 200, h: 84, title: "Feeder", sub: ["dirty map, 100 ms"], accent: true }),
	box("gather", { x: 560, y: 110, w: 200, h: 84, title: "gather", sub: ["cache data only"] }),
	box("client", { x: 820, y: 110, w: 200, h: 84, title: "JetClient", sub: ["ids, postMessage"] }),

	box("router", { x: 820, y: 320, w: 200, h: 84, title: "Router", sub: ["open, batch, upsert"], accent: true }),
	box("fields", { x: 560, y: 320, w: 200, h: 84, title: "fieldsFromRaw", sub: ["tokenize here"] }),
	box("engine", { x: 300, y: 320, w: 200, h: 84, title: "JetEngine", sub: ["upsertMany, merge"] }),
	cylinder("idb", { x: 315, y: 480, w: 170, h: 130, title: "IndexedDB", sub: ["base, sidecar"] }),

	arrow("events", "feeder"),
	arrow("feeder", "gather", { label: "read" }),
	arrow("gather", "client", { label: "RawNote" }),
	arrow("client", "router", { label: "message" }),
	arrow("router", "fields"),
	arrow("fields", "engine"),
	arrow("engine", "idb", { dashed: true, label: "save after 2 s" }),
	arrow("engine", "feeder", { dashed: true, label: "mtimes at start" }),
]);

// Search by meaning and answers.
const meaning = diagram("meaning", { width: 1340, height: 660, seed: 14 }, [
	group("g-main", { label: "Main thread", around: ["confirm", "install", "feeder", "search"], pad: 28 }),
	group("g-work", { label: "Worker", around: ["router", "vectors", "rank"], pad: 28 }),

	box("confirm", { x: 40, y: 110, w: 200, h: 84, title: "Confirm", sub: ["nothing fetched yet"], rounded: true }),
	box("install", { x: 300, y: 110, w: 200, h: 84, title: "install", sub: ["SHA-256, int8 pack"], accent: true }),
	cylinder("model", { x: 590, y: 88, w: 180, h: 130, title: "Model file", sub: ["plugin folder"] }),
	box("feeder", { x: 300, y: 300, w: 200, h: 84, title: "Feeder", sub: ["load, embed missing"] }),
	box("search", { x: 300, y: 470, w: 200, h: 84, title: "Search", sub: ["byMeaning, answers"] }),

	box("router", { x: 840, y: 300, w: 200, h: 84, title: "Router", sub: ["meaning:*, answers:*"], accent: true }),
	box("rank", { x: 1100, y: 300, w: 200, h: 84, title: "rankAnswers", sub: ["best line per note"] }),
	box("vectors", { x: 840, y: 470, w: 200, h: 84, title: "Vectors", sub: ["flat scan, int8"] }),
	cylinder("idb", { x: 1115, y: 448, w: 170, h: 130, title: "IndexedDB", sub: ["vectors"] }),

	arrow("confirm", "install", { label: "fetch" }),
	arrow("install", "model", { label: "write" }),
	arrow("model", "feeder", { elbow: true, fromSide: "b", toSide: "t", fromAt: 0.5, toAt: 0.7, dashed: true, label: "first question" }),
	arrow("feeder", "router", { label: "model, notes" }),
	arrow("search", "router", { elbow: true, fromSide: "r", toSide: "l", fromAt: 0.5, toAt: 0.8, label: "nearest, answers" }),
	arrow("router", "vectors"),
	arrow("router", "rank"),
	arrow("vectors", "idb", { dashed: true, label: "save" }),
]);

// Scopes: generated from the vault, kept by the main thread, used by the worker as an allow list.
const scopes = diagram("scopes", { width: 1440, height: 660, seed: 21 }, [
	group("g-gen", { label: "Generate (pure)", around: ["snapshot", "generate", "review", "watcher"], pad: 28 }),
	group("g-keep", { label: "Keep and use", around: ["keeper", "worker", "parse"], pad: 28 }),

	box("snapshot", { x: 40, y: 110, w: 200, h: 84, title: "Snapshot", sub: ["paths, properties, tags"], rounded: true }),
	box("generate", { x: 300, y: 110, w: 200, h: 84, title: "generate", sub: ["same vault, same result"], accent: true }),
	box("review", { x: 560, y: 110, w: 200, h: 84, title: "review", sub: ["new, changed, gone"] }),
	box("watcher", { x: 300, y: 290, w: 200, h: 84, title: "ScopeWatcher", sub: ["5 s quiet, 1 a minute"] }),
	cylinder("data", { x: 850, y: 88, w: 170, h: 130, title: "data.json", sub: ["scopes, rules"] }),

	box("keeper", { x: 830, y: 480, w: 200, h: 84, title: "ScopeKeeper", sub: ["members of each scope"], accent: true }),
	box("worker", { x: 500, y: 480, w: 200, h: 84, title: "Worker sets", sub: ["allow list per scope"] }),
	box("parse", { x: 1160, y: 480, w: 200, h: 84, title: "parseScope", sub: ["@name, in:name, typed"] }),

	arrow("snapshot", "generate"),
	arrow("generate", "review"),
	arrow("review", "data", { label: "Add" }),
	arrow("watcher", "generate", { dashed: true, label: "vault changed" }),
	arrow("data", "keeper", { elbow: true, fromSide: "b", toSide: "t", label: "rules" }),
	arrow("keeper", "worker", { label: "scope:set, delta" }),
	arrow("parse", "keeper", { dashed: true, label: "which scope" }),
]);

// From source to the three files Obsidian installs.
const build = diagram("build", { width: 1180, height: 480, seed: 8 }, [
	group("g-esb", { label: "esbuild.config.mjs", around: ["main", "esbuild", "worker", "plugin"], pad: 28 }),

	box("main", { x: 40, y: 100, w: 190, h: 80, title: "src/main.ts", sub: ["plugin entry"], rounded: true }),
	box("esbuild", { x: 320, y: 100, w: 190, h: 80, title: "esbuild", sub: ["bundle, minify"], accent: true }),
	box("worker", { x: 40, y: 270, w: 190, h: 80, title: "jet-worker.ts", sub: ["imported as worker:"], rounded: true }),
	box("plugin", { x: 320, y: 270, w: 190, h: 80, title: "inline-worker", sub: ["IIFE, no externals"] }),
	box("bundle", { x: 640, y: 100, w: 170, h: 80, title: "main.js", sub: ["worker is a string"] }),
	box("css", { x: 640, y: 230, w: 170, h: 80, title: "styles.css", sub: ["hand written"] }),
	box("manifest", { x: 640, y: 350, w: 170, h: 80, title: "manifest.json", sub: ["and versions.json"] }),
	box("tag", { x: 930, y: 205, w: 190, h: 110, title: "Release", sub: ["tag = version", "build attested"], accent: true }),

	arrow("main", "esbuild"),
	arrow("worker", "plugin"),
	arrow("plugin", "esbuild", { dashed: true, label: "worker text" }),
	arrow("esbuild", "bundle"),
	arrow("bundle", "tag", { elbow: true, fromSide: "r", toSide: "l", toAt: 0.2 }),
	arrow("css", "tag", { toAt: 0.5 }),
	arrow("manifest", "tag", { elbow: true, fromSide: "r", toSide: "l", toAt: 0.8 }),

	note("legend", { x: 40, y: 450, text: "Obsidian installs exactly three files, so the worker travels inside main.js." }),
]);

export const diagrams = [system, keystroke, engine, indexing, meaning, scopes, build];
