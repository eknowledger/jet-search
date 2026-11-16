// Typed queries for the speed test: words from the vault, one letter at a time, one or two words, a quarter with a dropped letter.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const rng = (seed) => () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const walk = (d) =>
	readdirSync(d, { withFileTypes: true }).flatMap((e) =>
		e.name.startsWith(".")
			? []
			: e.isDirectory()
				? walk(join(d, e.name))
				: e.name.endsWith(".md")
					? [join(d, e.name)]
					: [],
	);
export const speedQueries = (demoVault, count = 30, seed = 99) => {
	const df = new Map();
	for (const p of walk(demoVault))
		for (const line of readFileSync(p, "utf8").split("\n"))
			if (line.trim().length > 25 && !line.startsWith("---"))
				for (const w of new Set(line.toLowerCase().match(/[a-z]{4,12}/g) ?? []))
					df.set(w, (df.get(w) ?? 0) + 1);
	const vocab = [...df.entries()]
		.filter(([, c]) => c >= 3)
		.sort((a, b) => b[1] - a[1])
		.map(([w]) => w)
		.slice(0, 3000);
	const r = rng(seed);
	const out = [];
	for (let i = 0; i < count; i++) {
		let w1 = vocab[Math.floor(r() * vocab.length)];
		if (r() < 0.25) w1 = w1.slice(0, 2) + w1.slice(3);
		out.push(r() < 0.4 ? `${w1} ${vocab[Math.floor(r() * vocab.length)]}` : w1);
	}
	return out;
};
// Quality cases on the demo vault. `names` cases are things a note switcher is built for; `content` cases need the text.
// `want` is a list of vault paths; `wantText` means every note that contains that text; `wantPrefix` every note under that folder. A case passes when one is in the top 3.
export const QUALITY = [
	{
		id: "name-typo",
		group: "names",
		q: "kitchn renovaton",
		want: ["Projects/Kitchen Renovation/Kitchen Renovation.md"],
	},
	{ id: "name-typo-2", group: "names", q: "gaspacho andaluz", want: ["Areas/Cooking/Gazpacho andaluz.md"] },
	{ id: "initials", group: "names", q: "jtrip", want: ["Projects/Japan Trip 2027/Japan Trip 2027.md"] },
	{ id: "alias", group: "names", q: "TLK", want: ["Projects/The Lighthouse Keeper/The Lighthouse Keeper.md"] },
	{ id: "accents", group: "names", q: "pasteis de nata", want: ["Areas/Cooking/Pastéis de nata.md"] },
	{ id: "arabic", group: "names", q: "شوربة", want: ["Areas/Cooking/شوربة العدس.md"] },
	{ id: "japanese", group: "names", q: "味噌汁", want: ["Areas/Cooking/味噌汁の作り方.md"] },
	{ id: "exact-name", group: "names", q: "Monthly budget", want: ["Areas/Finances/Monthly budget.md"] },
	{
		id: "prefix",
		group: "names",
		q: "rotten joi",
		want: ["Projects/Kitchen Renovation/Rotten joist under the sink.md"],
	},
	{ id: "text-word", group: "content", q: "calacatta", wantText: "Calacatta" },
	{
		id: "text-two-words",
		group: "content",
		q: "ladybird larva",
		want: ["Projects/Rooftop Garden/Aphids and ladybirds.md"],
	},
	{
		id: "text-phrase",
		group: "content",
		q: '"first thursday"',
		want: ["Areas/Reading/Book Club.md", "Areas/Reading/Reading.md", "Journal/2026-09-03.md"],
	},
	{ id: "text-typo", group: "content", q: "restik backup", want: ["Projects/Home Server/Backups with restic.md"] },
	{
		id: "meaning-basil",
		group: "meaning",
		q: "how do I stop my basil dying",
		want: ["Projects/Rooftop Garden/Herbs — basil, mint, parsley.md", "Projects/Rooftop Garden/Rooftop Garden.md"],
	},
	{
		id: "meaning-cold",
		group: "meaning",
		q: "keeping plants alive when it gets cold outside",
		wantPrefix: "Projects/Rooftop Garden/",
	},
	{ id: "fact", group: "meaning", q: "how much was the quartz countertop?", wantText: "2,340" },
];

// A larger set of quality cases, made from the vault itself with a fixed seed, so nobody picks them by hand.
// Every case has a rule for the right answer: the note with that title, or every note whose text holds the words asked for.
//   name cases (a note switcher can answer them): title-exact, title-typo, title-prefix
//   content cases: word, two-words, phrase, word-typo
// Words are whole words in the Latin script; a phrase is three words that follow each other in a line with only spaces between.
export const autoQuality = (vaultDir, perGroup = 25, seed = 7) => {
	const r = rng(seed);
	const nfc = (s) => s.normalize("NFC");
	const latin = (s) => /^[\p{Script=Latin}\d' -]+$/u.test(s);
	const tokens = (t) => t.match(/\p{Script=Latin}+/gu) ?? [];
	const notes = walk(vaultDir).map((p) => {
		const rel = nfc(p.slice(vaultDir.length + 1));
		const title = rel.replace(/^.*\//, "").replace(/\.md$/, "");
		const text = nfc(readFileSync(p, "utf8").replace(/^---[\s\S]*?\n---\n/, "")).toLowerCase();
		return { rel, title, text, words: new Set(tokens(text)) };
	});
	const pick = (xs, n) => {
		const a = [...xs];
		const out = [];
		while (out.length < n && a.length) out.push(a.splice(Math.floor(r() * a.length), 1)[0]);
		return out;
	};
	const dropOne = (w) => {
		const i = 1 + Math.floor(r() * (w.length - 2));
		return w.slice(0, i) + w.slice(i + 1);
	};
	const cases = [];
	const add = (group, q, want) =>
		want.length &&
		cases.push({ id: `${group}-${cases.filter((c) => c.group === group).length + 1}`, group, q, want });
	// names
	const titled = notes.filter((n) => latin(n.title) && /^[a-z]/i.test(n.title) && n.title.length >= 8);
	for (const n of pick(titled, perGroup))
		add(
			"title-exact",
			n.title,
			notes.filter((m) => m.title === n.title).map((m) => m.rel),
		);
	for (const n of pick(
		titled.filter((n) => n.title.split(" ").some((w) => /^[a-z]{5,}$/i.test(w))),
		perGroup,
	)) {
		const words = n.title.split(" ");
		const k = words.findIndex((w) => /^[a-z]{5,}$/i.test(w));
		words[k] = dropOne(words[k]);
		add("title-typo", words.join(" "), [n.rel]);
	}
	for (const n of pick(
		titled.filter((n) => n.title.length >= 12),
		perGroup,
	)) {
		const q = n.title.slice(0, Math.ceil(n.title.length * 0.6)).trimEnd();
		add(
			"title-prefix",
			q,
			notes.filter((m) => m.title.toLowerCase().startsWith(q.toLowerCase())).map((m) => m.rel),
		);
	}
	// content: whole words that are in the text of one to three notes and in no title
	const titleWords = new Set(notes.flatMap((n) => tokens(n.title.toLowerCase())));
	const df = new Map();
	for (const n of notes)
		for (const w of n.words) if (w.length >= 5 && w.length <= 12) df.set(w, (df.get(w) ?? 0) + 1);
	const rare = [...df.entries()].filter(([w, c]) => c <= 3 && !titleWords.has(w)).map(([w]) => w);
	const holders = (...ws) => notes.filter((n) => ws.every((w) => n.words.has(w))).map((n) => n.rel);
	for (const w of pick(rare, perGroup)) add("word", w, holders(w));
	for (const w of pick(
		rare.filter((w) => w.length >= 7),
		perGroup,
	))
		add("word-typo", dropOne(w), holders(w));
	const pairs = [];
	for (const n of notes) {
		const ws = [...n.words].filter(
			(w) => w.length >= 5 && w.length <= 12 && (df.get(w) ?? 0) <= 6 && !titleWords.has(w),
		);
		if (ws.length >= 2) pairs.push([ws[Math.floor(r() * ws.length)], ws[Math.floor(r() * ws.length)]]);
	}
	for (const [a, b] of pick(
		pairs.filter(([a, b]) => a !== b),
		perGroup,
	))
		add("two-words", `${a} ${b}`, holders(a, b));
	const phrases = [];
	for (const n of notes)
		for (const line of n.text.split("\n")) {
			const found = [
				...line.matchAll(
					/(?<![\p{L}])(\p{Script=Latin}{3,} \p{Script=Latin}{3,} \p{Script=Latin}{3,})(?![\p{L}])/gu,
				),
			].map((m) => m[1]);
			if (found.length) phrases.push(found[Math.floor(r() * found.length)]);
		}
	const holdsPhrase = (n, p) => new RegExp(`(?<![\\p{L}])${p}(?![\\p{L}])`, "u").test(n.text);
	const unique = [...new Set(phrases)].filter((p) => {
		const c = notes.filter((n) => holdsPhrase(n, p)).length;
		return c >= 1 && c <= 3;
	});
	for (const p of pick(unique, perGroup))
		add(
			"phrase",
			`"${p}"`,
			notes.filter((n) => holdsPhrase(n, p)).map((n) => n.rel),
		);
	return cases;
};
