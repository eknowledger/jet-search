// Synthetic Obsidian vaults for testing the scope generator, and the 10× corpus.
//   node bench/fixtures/make-vaults.mjs <out-dir> [shape ...] [--source <corpus-dir>]
// Shapes: para flat deep tags-only properties-only johnny-decimal zettelkasten non-english (the default set), and
// x10 (needs --source, never in the default set). Each vault is <out-dir>/<shape>/: Markdown notes, an empty
// .obsidian/ and expected.json. Seeded, so the same command makes byte-identical vaults with identical mtimes.
//
// expected.json is what a correct scope generator should propose:
//   preset     para | top-level | johnny-decimal | properties | tags | none
//   scopes     [{ name, aliases?, rules, members, outside, ambiguity, auto }]; rules combine as any (union)
//     folder   { kind, value: "2.Projects/Basalt", count }  notes whose path starts with value + "/"
//     property { kind, key, value: "[[Basalt]]", count }    links are equal when they name the same note, so
//              [[Basalt]], [[2.Projects/Basalt/Basalt]] and [[Basalt|bas]] are one value; plain values are equal
//              trimmed and case-insensitive; a list matches when any element does
//     tag      { kind, value: "#project/alpha", count }     inline #tags and frontmatter tags:, nested tags by
//              prefix, case-insensitive
//     count    notes matching that rule alone; members = notes matching any rule
//   outside    notes not in the scope whose text has the name as a whole word (case-insensitive; a substring for
//              Chinese or Japanese names)
//   ambiguity  outside ÷ members; auto = ambiguity ≤ 1. Every fixture keeps ambiguity ≤ 0.7 or ≥ 1.4, so
//              small differences in how a generator counts mentions cannot flip the Auto decision.
//   notes_on_scopes, notes_on_auto  the judgement behind the list, in words
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SHAPES = [
	"para",
	"flat",
	"deep",
	"tags-only",
	"properties-only",
	"johnny-decimal",
	"zettelkasten",
	"non-english",
];
const ALL_SHAPES = [...SHAPES, "x10"];

/** Notes are dated 2026-01-01 plus 0–279 days (to 2026-10-07): a fixed epoch and a seeded offset. */
const BASE = Date.UTC(2026, 0, 1) / 1000;
const DAY = 86400;
const LAST_DAY = 279;
const MAX_BYTES = 10e6;

// ---------- randomness ----------

const mulberry32 = (seed) => {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

const hash = (s) => {
	let h = 2166136261;
	for (const c of s) h = Math.imul(h ^ (c.codePointAt(0) ?? 0), 16777619);
	return h >>> 0;
};

const makeRng = (seed) => {
	const next = mulberry32(seed);
	const int = (n) => Math.floor(next() * n);
	const sample = (arr, k) => {
		const a = [...arr];
		const n = Math.min(k, a.length);
		for (let i = 0; i < n; i++) {
			const j = i + int(a.length - i);
			[a[i], a[j]] = [a[j], a[i]];
		}
		return a.slice(0, n);
	};
	return {
		int,
		sample,
		pick: (arr) => arr[int(arr.length)],
		range: (lo, hi) => lo + int(hi - lo + 1),
		chance: (p) => next() < p,
	};
};

// ---------- names that become scopes (kept out of the filler text) ----------

const PARA_PROJECTS = [
	["Basalt", 26, "bas"],
	["Kestrel", 24, "kes"],
	["Lumen", 22, "lum"],
	["Orchard Rewrite", 20, "orchard"],
	["Team", 25, "core group"],
	["Zephyr", 18, "zeph"],
];
const PARA_AREAS = [
	["Finance", 16],
	["Fitness", 14],
	["Garden", 12],
	["Mentoring", 12],
];
const NE_PROJECTS = [
	["Réseau", 20, "réseau", "fr"],
	["Übersetzung", 18, "Ü", "de"],
	["音声", 18, "おんせい", "ja"],
	["المكتبة", 16, "مكتبة", "ar"],
	["Café Crème", 12, "café", "fr"],
];
const NE_AREAS = [
	["Santé", 12, "fr"],
	["Finanzen", 12, "de"],
	["家族", 10, "ja"],
	["التعليم", 10, "ar"],
];
const DEEP_TREE = [
	["Work/Clients/Acme/2026/Q3/Meetings", 22],
	["Work/Clients/Acme/2026/Q3/Reports", 8],
	["Work/Clients/Acme/2026/Q2/Meetings", 10],
	["Work/Clients/Globex/2025/Q4/Meetings", 12],
	["Work/Clients/Globex/2026/Q1/Contracts/Drafts", 8],
	["Work/Internal/Engineering/Platform/Design/Reviews", 22],
	["Work/Internal/Engineering/Platform/Runbooks", 10],
	["Work/Internal/People/Onboarding/2026/Week 1", 8],
	["Work/Admin", 6],
	["Personal/Home/Renovation/Kitchen/Quotes/2026", 10],
	["Personal/Home/Renovation/Bathroom/Ideas", 8],
	["Personal/Travel/2026/Portugal/Lisbon/Days", 18],
	["Personal/Health/Running/Plans/2026", 10],
	["Personal/Finances/Taxes/2025/Receipts", 12],
	["Personal/Finances/Taxes/2025", 6],
	["Learning/Courses/Databases/Module 3/Week 2/Lectures", 12],
	["Learning/Courses/Databases/Module 3/Week 3/Lectures", 10],
	["Learning/Books/Nonfiction/History/Rome/Chapters", 14],
	["Learning/Languages/Spanish/Grammar/Verbs", 8],
	["Learning", 4],
	["Notes/Scratch", 12],
	["Notes", 6],
	["Misc", 3],
	["", 4],
];
const TAG_CHILDREN = [
	["project/alpha", 26],
	["project/beta", 20],
	["project/gamma", 14],
	["client/acme", 18],
	["client/globex", 14],
	["client/general", 12],
];
const CATEGORIES = [
	["Recipe", 22],
	["Book", 24],
	["Meeting", 20],
	["Idea", 18],
	["Travel", 16],
	["Workout", 18],
	["Film", 14],
	["Podcast", 14],
	["Lecture", 12],
	["Interview", 10],
];
const CLIENTS = [
	["Acme Corp", 22, "Acme"],
	["Globex", 18, "GX"],
	["Initech", 14, "Ini"],
	["Umbrella Health", 12, "Umbrella"],
];
const JD = [
	[
		"10-19",
		"Admin",
		[
			["11", "Finance", ["Budget", "Taxes", "Bank statements", "Pension", "Invoices"]],
			["12", "Legal", ["Lease", "Will", "Contracts", "Licences"]],
			["13", "Insurance", ["Health policy", "Property policy", "Travel cover", "Claims"]],
		],
	],
	[
		"20-29",
		"Work",
		[
			["21", "Clients", ["Northwind", "Contoso", "Fabrikam", "Tailspin", "Proposals"]],
			["22", "Projects", ["Website refresh", "Data platform", "Mobile app", "Status reports"]],
			["23", "Hiring", ["Job descriptions", "Candidates", "Assessments", "Offers"]],
		],
	],
	[
		"30-39",
		"Home",
		[
			["31", "House", ["Repairs", "Utilities", "Moving", "Appliances"]],
			["32", "Car", ["Service history", "Fuel log", "Parking"]],
			["33", "Garden", ["Planting plan", "Tools", "Harvest log", "Compost"]],
		],
	],
	[
		"40-49",
		"Learning",
		[
			["41", "Courses", ["Statistics", "Spanish", "Pottery", "Photography"]],
			["42", "Books", ["Reading list", "Reviews", "Quotes", "Lending"]],
		],
	],
];

const RESERVED = [
	...PARA_PROJECTS.map((p) => p[0]),
	...PARA_AREAS.map((a) => a[0]),
	...NE_PROJECTS.map((p) => p[0]),
	...NE_AREAS.map((a) => a[0]),
	"Work",
	"Personal",
	"Learning",
	"Notes",
	...TAG_CHILDREN.map((t) => t[0].split("/")[1]),
	...CATEGORIES.map((c) => c[0]),
	...CLIENTS.map((c) => c[0]),
	...JD.flatMap(([, area, cats]) => [area, ...cats.map((c) => c[1])]),
];

// ---------- mentions: the one definition used for "outside" ----------

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentionRe = (name) =>
	CJK.test(name)
		? new RegExp(escapeRe(name), "u")
		: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, "iu");
const RESERVED_RE = RESERVED.map(mentionRe);
const isClean = (text) => !RESERVED_RE.some((re) => re.test(text));
const clean = (list) => list.filter(isClean);
const words = (s) => clean(s.trim().split(/\s+/));

// ---------- text ----------

const EN_WORDS = words(`
	the a of and to in for with on is was that this about after again ahead almost already answer around asked away
	basic before better between bring brief broad build calm careful change check clean clear close common could
	create current daily decide detail different direction draft early easy enough every exact example extra fair
	fast field final first focus follow found fresh future gather given good great guess habit half happen heavy
	honest hope hour inside issue keep kind large later layer least level light limit little local long loose main
	make maybe measure middle minor model month morning move near next number often open option order other outline
	owner pace part pass path pattern plain plan point quick quiet rather ready reason recent record rough round rule
	safe sample scale second section short signal simple slow small solid sort source space split stable start step
	still story strong study style summary support sure table task test thought thread through today topic track
	trade tried under until update usual value version view wait week while whole wide window within without write
	year`);
const FR_WORDS = words(`
	le la les un une des et pour avec dans sur par plus très bien encore déjà souvent semaine mois jour matin soir
	équipe réunion idée tâche étape délai choix piste retour besoin question réponse liste document version
	brouillon résumé prochaine première rapide simple clair ouvert prévu fini commencé noter vérifier préparer
	envoyer relire garder changer écrire lire`);
const DE_WORDS = words(`
	der die das und mit für auf ist nicht noch schon heute morgen Woche Monat Termin Entwurf Bericht Ziel Liste Frage
	Antwort Aufgabe Schritt Plan Stand Idee Ergebnis Änderung Prüfung Kosten Zeitplan Version kurz klar offen fertig
	neu wichtig später zuerst danach prüfen schreiben lesen senden klären ändern planen`);
const JA_WORDS = words(`
	会議 資料 確認 予定 課題 共有 設計 改善 検討 報告 準備 対応 週末 記録 目標 進捗 作業 連絡 整理 方針 結果 質問 回答 今日 明日
	来週 全体 詳細`);
const AR_WORDS = words(`
	اجتماع خطة مراجعة تقرير موعد مشروع فريق عمل سؤال جواب قائمة هدف أسبوع يوم ملاحظة فكرة مسودة في من على مع إلى هذا
	بعد قبل جديد مهم سريع واضح تحديث نتيجة خطوة`);
const JA_PARTICLES = ["の", "を", "に", "は", "と", "で", "が"];
const JA_ENDS = ["した。", "する。", "です。", "を進める。"];

const TITLE_A = words(`
	Kickoff Vendor Design Roadmap Retro Launch Research Pricing Onboarding Migration Security Support Release Quarterly
	Customer Partner Budget Survey Pilot Hardware Network Storage Billing Search Mobile Offline Pipeline Backlog Cleanup
	Hiring`);
const TITLE_B = words(`
	plan review draft checklist summary outline questions findings proposal options risks timeline decisions metrics
	brief log sketch estimate feedback notes`);
const FOOD = clean([
	"Lentil soup",
	"Sourdough loaf",
	"Tomato salad",
	"Green curry",
	"Oat cookies",
	"Miso glaze",
	"Pear tart",
	"Chili beans",
	"Lemon rice",
	"Pea risotto",
]);
const FR_FOOD = clean([
	"Soupe de lentilles",
	"Pain au levain",
	"Tarte aux poires",
	"Ratatouille",
	"Gratin dauphinois",
	"Crêpes",
	"Quiche aux poireaux",
	"Taboulé",
]);
const ZK_SUBJECTS = clean([
	"Spaced repetition",
	"Short drafts",
	"Daily review",
	"Small habits",
	"Clear names",
	"Open questions",
	"Walking",
	"Sleep",
	"Constraints",
	"Checklists",
	"Deadlines",
	"Tiny experiments",
	"Feedback loops",
	"Boredom",
	"Rereading",
	"Outlines",
	"Index cards",
	"Quiet mornings",
	"Margins",
	"Analogies",
	"Examples",
	"Friction",
	"Defaults",
]);
const ZK_VERBS = [
	"beats",
	"needs",
	"shapes",
	"feeds",
	"outlasts",
	"hides",
	"invites",
	"reduces",
	"protects",
	"reveals",
];
const ZK_OBJECTS = clean([
	"cramming",
	"willpower",
	"memory",
	"attention",
	"long plans",
	"motivation",
	"recall",
	"focus",
	"rework",
	"clutter",
	"fatigue",
	"taste",
	"judgement",
	"momentum",
	"curiosity",
	"clarity",
]);
const ZK_TOPICS = ["memory", "writing", "habits", "attention", "craft"];

/** Per language: filler words, title parts, headings, and sentence templates ({N} = a scope name, t = a link). */
const LANGS = {
	en: {
		words: EN_WORDS,
		join: " ",
		titleA: TITLE_A,
		titleB: TITLE_B,
		titleJoin: " ",
		heads: ["Context", "Open questions", "Next steps", "Decisions", "Summary", "Log", "Details", "Risks"],
		say: [
			"{N} came up again in the review.",
			"Spent an hour on {N} this morning.",
			"Next step for {N} is to close the open questions.",
			"Quick check on {N} before the weekend.",
			"{N} needs a clear owner.",
		],
		link: [(t) => `See [[${t}]].`, (t) => `Related: [[${t}]].`, (t) => `Builds on [[${t}]].`],
	},
	fr: {
		words: FR_WORDS,
		join: " ",
		titleA: ["Compte rendu", "Plan", "Liste", "Bilan", "Synthèse", "Brouillon", "Questions", "Choix", "Retour"],
		titleB: ["du lundi", "de la semaine", "technique", "client", "rapide", "mensuel", "final", "provisoire"],
		titleJoin: " ",
		heads: ["Contexte", "Questions", "Prochaines étapes", "Décisions", "Résumé"],
		say: ["Point rapide sur {N}.", "{N} avance bien cette semaine.", "Voir aussi {N} pour le contexte."],
		link: [(t) => `Voir [[${t}]].`, (t) => `Lien : [[${t}]].`],
	},
	de: {
		words: DE_WORDS,
		join: " ",
		titleA: ["Protokoll", "Entwurf", "Zeitplan", "Bericht", "Checkliste", "Angebot", "Rückblick", "Kostenplan"],
		titleB: ["Montag", "Woche 12", "intern", "final", "kurz", "Version 2", "offen", "Kunde", "Planung"],
		titleJoin: " ",
		heads: ["Kontext", "Offene Fragen", "Nächste Schritte", "Entscheidungen", "Zusammenfassung"],
		say: ["Kurzer Stand zu {N}.", "{N} ist diese Woche dran.", "Siehe auch {N} für den Kontext."],
		link: [(t) => `Siehe [[${t}]].`, (t) => `Verwandt: [[${t}]].`],
	},
	ja: {
		words: JA_WORDS,
		join: "",
		titleA: ["会議", "設計", "週次", "課題", "要件", "作業", "振り返り", "参考", "改善", "進捗"],
		titleB: ["メモ", "レビュー", "報告", "一覧", "整理", "計画", "資料", "案", "確認", "記録"],
		titleJoin: "",
		heads: ["背景", "論点", "次のステップ", "決定事項", "まとめ"],
		say: ["{N}の進捗を確認した。", "{N}について共有する。", "{N}の課題を整理した。"],
		link: [(t) => `[[${t}]]を参照。`, (t) => `関連：[[${t}]]。`],
	},
	ar: {
		words: AR_WORDS,
		join: " ",
		titleA: ["خطة", "محضر", "قائمة", "مراجعة", "أفكار", "مسودة", "أسئلة", "جدول", "ملخص", "تقييم"],
		titleB: ["العمل", "الاجتماع", "المهام", "أسبوعية", "أولية", "التقرير", "مفتوحة", "زمني", "القراءة"],
		titleJoin: " ",
		heads: ["السياق", "أسئلة", "الخطوات التالية", "القرارات", "الخلاصة"],
		say: ["مراجعة {N} هذا الأسبوع.", "ملاحظة حول {N}.", "خطوة جديدة في {N} اليوم."],
		link: [(t) => `انظر [[${t}]].`, (t) => `ذو صلة: [[${t}]].`],
	},
};

/** Everyday uses of names that are also plain words: what makes Auto unsafe for them. */
const PLAIN = {
	team: ["The team agreed on the plan.", "Quick sync with the team after lunch.", "Shared the draft with the team."],
	work: ["Plenty of work left on this.", "Most of the work happened offline.", "Good work on the outline."],
	home: ["Back home early today.", "Stayed home most of the day.", "Took the papers home to read."],
	notes: ["My notes from the call are below.", "Cleaned up the notes afterwards.", "Rough notes, to tidy later."],
	general: ["In general the approach holds.", "A general sense of progress.", "The general direction is sound."],
	meeting: ["The meeting ran long again.", "Booked a meeting for Thursday.", "Short meeting, clear outcome."],
	car: ["Took the car in for a service.", "The car needs new tyres.", "Left the car at the station."],
	家族: ["家族と週末を過ごした。", "家族の予定を確認した。", "家族に連絡した。"],
};

// The templates must not name a scope by accident, or the outside counts drift from the design.
for (const L of Object.values(LANGS)) {
	for (const s of [...L.heads, ...L.titleA, ...L.titleB, ...L.say.map((t) => t.replace("{N}", ""))]) {
		if (!isClean(s)) throw new Error(`template names a scope: ${s}`);
	}
}
for (const [word, list] of Object.entries(PLAIN)) {
	for (const s of list) {
		if (!RESERVED_RE.every((re, i) => !re.test(s) || RESERVED[i]?.toLowerCase() === word)) {
			throw new Error(`plain sentence names another scope: ${s}`);
		}
	}
}

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const sentence = (rng, lang) => {
	const L = LANGS[lang];
	if (lang === "ja") {
		let s = "";
		for (let i = rng.range(2, 3); i > 0; i--) s += rng.pick(L.words) + rng.pick(JA_PARTICLES);
		return s + rng.pick(L.words) + rng.pick(JA_ENDS);
	}
	const ws = Array.from({ length: rng.range(6, 13) }, () => rng.pick(L.words));
	return `${capital(ws.join(" "))}.`;
};

const bullet = (rng, lang) => {
	const L = LANGS[lang];
	const ws = Array.from({ length: rng.range(2, 5) }, () => rng.pick(L.words));
	return lang === "ja" ? ws.join(rng.pick(JA_PARTICLES)) : capital(ws.join(" "));
};

const titleIn = (rng, lang) => {
	const L = LANGS[lang];
	return `${rng.pick(L.titleA)}${L.titleJoin}${rng.pick(L.titleB)}`;
};

/** A sentence naming a scope; a Latin name inside Japanese text gets spaces so it stays a separate word. */
const mention = (rng, lang, name) => {
	const n = lang === "ja" && !CJK.test(name) ? ` ${name} ` : name;
	return rng.pick(LANGS[lang].say).replace("{N}", n);
};

const isoDate = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 10);
const stamp = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 16).replace(/[-T:]/g, "");

// ---------- the vault model ----------

/** Notes before rendering: path, frontmatter, tags, links and what the body should say. Titles are unique. */
const makeModel = (rng) => {
	const notes = [];
	const taken = new Set();
	const add = ({ folder = "", title, lang = "en", day, mtime, linkable = true, paras = [2, 4] }) => {
		const base = title.normalize("NFC");
		let t = base;
		for (let i = 2; taken.has(t.toLowerCase()); i++) t = `${base} ${i}`;
		taken.add(t.toLowerCase());
		const at = mtime ?? BASE + (day ?? rng.range(0, LAST_DAY)) * DAY + rng.int(DAY);
		const note = {
			path: `${folder ? `${folder}/` : ""}${t}.md`,
			title: t,
			lang,
			mtime: at,
			linkable,
			paras,
			fm: [],
			fmTags: [],
			tags: [],
			links: [],
			say: [],
			lines: [],
		};
		notes.push(note);
		return note;
	};
	return { notes, add };
};

/** Sets a property; a second value for the same key turns it into a list. */
const setProp = (note, key, value) => {
	const entry = note.fm.find((e) => e[0] === key);
	if (!entry) note.fm.push([key, value]);
	else if (Array.isArray(entry[1])) entry[1].push(value);
	else entry[1] = [entry[1], value];
};

/** Adds a tag inline, or in frontmatter tags: with probability fmShare. */
const addTag = (rng, note, tag, fmShare = 0.3) => {
	if (rng.chance(fmShare)) note.fmTags.push(tag);
	else note.tags.push(tag);
};

const linkRandom = (rng, notes, lo, hi) => {
	const pool = notes.filter((n) => n.linkable);
	for (const n of notes) {
		for (const t of rng.sample(pool, rng.range(lo, hi))) {
			if (t !== n && !n.links.includes(t.title)) n.links.push(t.title);
		}
	}
};

const noiseTags = (rng, notes, tags, p) => {
	for (const n of notes) if (rng.chance(p)) n.tags.push(rng.pick(tags));
};

const folderRule = (value) => ({ kind: "folder", value });
const propRule = (key, value) => ({ kind: "property", key, value });
const tagRule = (tag) => ({ kind: "tag", value: `#${tag}` });
const tagOf = (name) => (/\s/.test(name) ? null : name.toLowerCase());

/** The note a property value names: a link's target file name, or the plain value itself; lowercase. */
const valueKey = (v) => {
	const m = /^\[\[([^\]|#]+)[^\]]*\]\]$/.exec(v.trim());
	const t = m ? (m[1].split("/").pop() ?? "").replace(/\.md$/i, "") : v;
	return t.trim().toLowerCase();
};

const ruleMatch = (note, r) => {
	if (r.kind === "folder") return note.path.startsWith(`${r.value}/`);
	if (r.kind === "property") {
		const want = valueKey(r.value);
		return note.fm.some(([k, v]) => k === r.key && [v].flat().some((x) => valueKey(x) === want));
	}
	const t = r.value.slice(1).toLowerCase();
	return [...note.tags, ...note.fmTags].some((x) => {
		const l = x.toLowerCase();
		return l === t || l.startsWith(`${t}/`);
	});
};

// ---------- rendering ----------

const yamlValue = (v) => (/^[\p{L}\p{N}][\p{L}\p{N} ._/-]*$/u.test(v) ? v : JSON.stringify(v));

const render = (rng, note) => {
	const L = LANGS[note.lang];
	const out = [];
	if (note.fm.length || note.fmTags.length) {
		out.push("---");
		for (const [k, v] of note.fm) {
			if (Array.isArray(v)) out.push(`${k}:`, ...v.map((x) => `  - ${yamlValue(x)}`));
			else out.push(`${k}: ${yamlValue(v)}`);
		}
		if (note.fmTags.length) out.push("tags:", ...note.fmTags.map((t) => `  - ${yamlValue(t)}`));
		out.push("---");
	}
	out.push(`# ${note.title}`, "");
	if (note.lines.length) out.push(...note.lines, "");
	const n = rng.range(note.paras[0], note.paras[1]);
	const paras = Array.from({ length: n }, () =>
		Array.from({ length: rng.range(2, 4) }, () => sentence(rng, note.lang)),
	);
	const put = (s) => {
		const p = paras[rng.int(n)];
		p.splice(rng.int(p.length + 1), 0, s);
	};
	for (const s of note.say) put(s);
	for (const t of note.links) put(rng.pick(L.link)(t));
	const inline = note.tags.map((t) => `#${t}`).join(" ");
	const tagsInPara = inline && rng.chance(0.5);
	if (tagsInPara) {
		const p = paras[rng.int(n)];
		p[p.length - 1] += ` ${inline}`;
	}
	paras.forEach((p, i) => {
		if (i === 1) out.push(`## ${rng.pick(L.heads)}`, "");
		out.push(p.join(L.join), "");
		if (i === 0 && rng.chance(0.4)) {
			for (let j = rng.range(2, 4); j > 0; j--) out.push(`- ${bullet(rng, note.lang)}`);
			out.push("");
		}
	});
	if (inline && !tagsInPara) out.push(inline, "");
	return `${out.join("\n").trimEnd()}\n`;
};

// ---------- shapes ----------

/** A PARA vault: one scope per project and area, merged with the property value and tag of the same name. */
const buildPara = (rng, c) => {
	const v = makeModel(rng);
	const scopes = [];
	for (const [name, count, alias, lang = "en"] of c.projects) {
		const folder = `${c.top.projects}/${name}`;
		const tag = tagOf(name);
		v.add({ folder, title: name, lang, day: rng.range(0, 120), linkable: false });
		for (let i = 1; i < count; i++) {
			const where = rng.chance(0.25) ? `${folder}/${c.meetings}` : folder;
			const note = v.add({ folder: where, title: titleIn(rng, lang), lang, day: rng.range(60, LAST_DAY) });
			if (rng.chance(0.85)) setProp(note, c.projectKey, spell(rng, folder, name, alias));
			if (tag && rng.chance(0.4)) addTag(rng, note, tag);
			if (rng.chance(0.5)) note.links.push(name);
		}
		const rules = [folderRule(folder), propRule(c.projectKey, `[[${name}]]`)];
		scopes.push({ name, rules: tag ? [...rules, tagRule(tag)] : rules });
	}
	for (const [name, count, lang = "en"] of c.areas) {
		const folder = `${c.top.areas}/${name}`;
		const tag = tagOf(name);
		v.add({ folder, title: name, lang, day: rng.range(0, 60), linkable: false });
		for (let i = 1; i < count; i++) {
			const note = v.add({ folder, title: titleIn(rng, lang), lang });
			if (rng.chance(0.7)) setProp(note, c.areaKey, name);
			if (tag && rng.chance(0.3)) addTag(rng, note, tag);
			if (rng.chance(0.3)) note.links.push(name);
		}
		const rules = [folderRule(folder), propRule(c.areaKey, name)];
		scopes.push({ name, rules: tag ? [...rules, tagRule(tag)] : rules });
	}
	const other = (folder, lo, hi, title) => {
		const lang = rng.pick(c.langs);
		return v.add({ folder, title: title ?? titleIn(rng, lang), lang, day: rng.range(lo, hi) });
	};
	const inbox = Array.from({ length: c.counts.inbox }, () => other(c.top.inbox, 250, LAST_DAY));
	const resources = Array.from({ length: c.counts.resources }, () => other(c.top.resources, 0, LAST_DAY));
	for (const [sub, count, titles] of c.resourceSubs) {
		const folder = `${c.top.resources}/${sub}`;
		for (let i = 0; i < count; i++)
			resources.push(other(folder, 0, LAST_DAY, titles ? rng.pick(titles) : undefined));
	}
	const days = rng.sample(
		Array.from({ length: LAST_DAY - 99 }, (_, i) => 100 + i),
		c.counts.journal,
	);
	const journal = days
		.sort((a, b) => a - b)
		.map((d) => {
			const mtime = BASE + d * DAY + 18 * 3600 + rng.int(5 * 3600);
			return v.add({ folder: c.top.journal, title: isoDate(mtime), lang: rng.pick(c.langs), mtime });
		});
	for (let i = 0; i < c.counts.archive; i++) other(c.top.archive, 0, 60);
	for (let i = 0; i < c.archiveSub[1]; i++) other(`${c.top.archive}/${c.archiveSub[0]}`, 0, 60);
	// Notes outside the folders that belong through the property or a tag, so a scope is more than its folder.
	for (const [name, , alias] of c.projects) {
		const folder = `${c.top.projects}/${name}`;
		for (const note of rng.sample([...inbox, ...resources, ...journal], rng.range(4, 6))) {
			setProp(note, c.projectKey, spell(rng, folder, name, alias));
			if (rng.chance(0.5)) note.links.push(name);
		}
		const tag = tagOf(name);
		if (tag) for (const note of rng.sample([...inbox, ...resources], 2)) addTag(rng, note, tag, 0);
	}
	for (const [name] of c.areas) {
		for (const note of rng.sample(journal, 3)) setProp(note, c.areaKey, name);
		const tag = tagOf(name);
		if (tag) for (const note of rng.sample(resources, 2)) addTag(rng, note, tag, 0);
	}
	noiseTags(rng, v.notes, c.noise, 0.12);
	linkRandom(rng, v.notes, 1, 3);
	return { model: v, scopes, plain: c.plain, preset: "para", notesOnScopes: c.notesOnScopes };
};

/** The three ways a vault writes the same project link. */
const spell = (rng, folder, name, alias) =>
	[`[[${name}]]`, `[[${folder}/${name}]]`, `[[${name}|${alias}]]`][rng.int(3)];

const para = (rng) =>
	buildPara(rng, {
		top: {
			inbox: "1.Inbox",
			projects: "2.Projects",
			areas: "3.Areas",
			resources: "4.Resources",
			journal: "5.Journal",
			archive: "6.Archive",
		},
		projects: PARA_PROJECTS,
		areas: PARA_AREAS,
		projectKey: "project",
		areaKey: "area",
		meetings: "Meetings",
		langs: ["en"],
		counts: { inbox: 18, resources: 20, journal: 45, archive: 12 },
		resourceSubs: [
			["Recipes", 8, FOOD],
			["Reading", 8, null],
		],
		archiveSub: ["Old Website", 8],
		noise: ["todo", "later", "question"],
		plain: [["team", 0.6]],
		notesOnScopes:
			"PARA: one scope per child of 2.Projects and 3.Areas, each merged with the project: or area: value " +
			"and the #tag of the same name. project: links are written [[Name]], [[2.Projects/Name/Name]] and " +
			"[[Name|alias]] (some as lists of two projects) and all resolve to the hub note 2.Projects/Name/Name.md. " +
			"Journal, inbox and resource notes join through the property or a tag, so members exceed the folder " +
			"count. Orchard Rewrite has no tag (a tag cannot hold a space). Not proposed: 1.Inbox, 4.Resources " +
			"(with Recipes and Reading), 5.Journal, 6.Archive (with Old Website), and the flat noise tags.",
	});

const nonEnglish = (rng) =>
	buildPara(rng, {
		top: {
			inbox: "1.Boîte de réception",
			projects: "2.Projets",
			areas: "3.Domaines",
			resources: "4.Ressources",
			journal: "5.Journal",
			archive: "6.Archives",
		},
		projects: NE_PROJECTS,
		areas: NE_AREAS,
		projectKey: "projet",
		areaKey: "domaine",
		meetings: "Réunions",
		langs: ["fr", "de", "ja", "ja", "ar"],
		counts: { inbox: 12, resources: 16, journal: 22, archive: 6 },
		resourceSubs: [["Recettes", 8, FR_FOOD]],
		archiveSub: ["Ancien site", 6],
		noise: ["àfaire", "idée", "später"],
		plain: [["家族", 0.9, ["ja"]]],
		notesOnScopes:
			"PARA with French top-level folders (1.Boîte de réception, 2.Projets, 3.Domaines, 4.Ressources, " +
			"5.Journal, 6.Archives): detection must rely on the numbered 1.–6. prefixes or localized names. One " +
			"scope per project and area, named in French, German, Japanese and Arabic, merged with projet: links " +
			"(three spellings), domaine: values and Unicode tags (#réseau, #音声, #المكتبة …). Café Crème has no " +
			"tag. Not proposed: the inbox, resources (with Recettes), journal and archive folders.",
	});

const flat = (rng) => {
	const v = makeModel(rng);
	for (let i = 0; i < 200; i++) {
		const n = v.add({ title: titleIn(rng, "en") });
		if (rng.chance(0.12)) n.tags.push(rng.pick(["inbox", "todo", "reading", "later"]));
	}
	linkRandom(rng, v.notes, 1, 3);
	return {
		model: v,
		scopes: [],
		preset: "none",
		notesOnScopes:
			"No folders, no frontmatter, and only a few flat tags (#todo, #reading …; flat tags are not a preset). " +
			"A correct generator proposes nothing.",
	};
};

const deep = (rng) => {
	const v = makeModel(rng);
	for (const [folder, count] of DEEP_TREE) {
		for (let i = 0; i < count; i++) v.add({ folder, title: titleIn(rng, "en") });
	}
	noiseTags(rng, v.notes, ["todo", "draft", "followup"], 0.15);
	linkRandom(rng, v.notes, 1, 3);
	const tops = new Map();
	for (const n of v.notes) {
		const parts = n.path.split("/");
		if (parts.length > 1) tops.set(parts[0], (tops.get(parts[0]) ?? 0) + 1);
	}
	const big = [...tops].filter(([, c]) => c >= 5).map(([t]) => t);
	const small = [...tops].filter(([, c]) => c < 5).map(([t, c]) => `${t} (${c} notes)`);
	return {
		model: v,
		scopes: big.map((t) => ({ name: t, rules: [folderRule(t)] })),
		plain: [
			["work", 0.25],
			["notes", 0.45],
		],
		preset: "top-level",
		notesOnScopes:
			`Folders 5–7 levels deep and no other structure, so the default top-level preset: one scope per ` +
			`top-level folder with ≥ 5 notes (${big.join(", ")}). Not proposed: ${small.join(", ")} and the root ` +
			"notes. Deeper folders (Clients/Acme, Courses/Databases …) would also make good scopes but are not " +
			"what this preset proposes; the user adds them by hand.",
	};
};

const tagsOnly = (rng) => {
	const v = makeModel(rng);
	const notes = Array.from({ length: 200 }, () => v.add({ title: titleIn(rng, "en") }));
	const fmShare = new Map(notes.map((n) => [n, rng.chance(0.3) ? 1 : 0]));
	const tag = (n, t) => addTag(rng, n, t, fmShare.get(n));
	for (const [t, count] of TAG_CHILDREN) {
		const chosen = rng.sample(notes, count);
		chosen.forEach((n, i) => {
			if (t === "project/alpha" && i < 6) tag(n, "project/alpha/design");
			else if (t === "project/beta" && i < 2) tag(n, "Project/Beta");
			else tag(n, t);
		});
	}
	const readers = rng.sample(notes, 6);
	readers.forEach((n, i) => tag(n, i < 4 ? "reading/book" : "reading/paper"));
	noiseTags(rng, notes, ["idea", "todo", "draft", "followup"], 0.3);
	linkRandom(rng, notes, 1, 3);
	const share = (root) =>
		notes.filter((n) => [...n.tags, ...n.fmTags].some((t) => t.toLowerCase().startsWith(`${root}/`))).length /
		notes.length;
	const pct = (x) => `${Math.round(x * 100)}%`;
	if (share("project") < 0.05 || share("client") < 0.05 || share("reading") >= 0.05) {
		throw new Error("tags-only: tag roots do not straddle the 5% threshold as designed");
	}
	return {
		model: v,
		scopes: TAG_CHILDREN.map(([t]) => ({ name: t.split("/")[1], rules: [tagRule(t)] })),
		plain: [["general", 0.45]],
		preset: "tags",
		notesOnScopes:
			`Flat folder; two nested tag roots used by ≥ 5% of notes (#project ${pct(share("project"))}, #client ` +
			`${pct(share("client"))}): one scope per child tag, named by the child. #project/alpha/design counts ` +
			"under alpha and #Project/Beta equals #project/beta. Tags sit inline or in frontmatter tags:. Not " +
			`proposed: #reading/* (${pct(share("reading"))} of notes, under the threshold) and the flat noise ` +
			"tags (#idea, #todo, #draft, #followup).",
	};
};

const propertiesOnly = (rng) => {
	const v = makeModel(rng);
	const ids = new Set();
	const meta = (n) => {
		let id = "";
		while (!id || ids.has(id)) id = `n${rng.int(0xffffff).toString(16).padStart(6, "0")}`;
		ids.add(id);
		n.fm.push(["id", id], ["created", isoDate(n.mtime)]);
	};
	for (const [name] of CLIENTS) meta(v.add({ title: name, linkable: false }));
	const notes = Array.from({ length: 196 }, () => v.add({ title: titleIn(rng, "en") }));
	for (const n of notes) meta(n);
	const labels = CATEGORIES.flatMap(([c, count]) => Array.from({ length: count }, () => c));
	const order = rng.sample(notes, labels.length);
	// A few values in lowercase, as real vaults have them: still the same category.
	const lower = new Map([
		["Recipe", 3],
		["Book", 2],
	]);
	order.forEach((n, i) => {
		const c = labels[i];
		const left = lower.get(c) ?? 0;
		lower.set(c, left - 1);
		n.fm.push(["category", left > 0 ? c.toLowerCase() : c]);
	});
	for (const [name, count, alias] of CLIENTS) {
		for (const n of rng.sample(notes, count))
			setProp(n, "client", rng.chance(0.5) ? `[[${name}]]` : `[[${name}|${alias}]]`);
	}
	for (const n of rng.sample(notes, 6)) n.fm.push(["course", rng.pick(["Databases", "Compilers"])]);
	linkRandom(rng, v.notes, 1, 3);
	const created = new Set(v.notes.map((n) => n.fm.find((e) => e[0] === "created")?.[1])).size;
	const courseShare = v.notes.filter((n) => n.fm.some((e) => e[0] === "course")).length / v.notes.length;
	if (created <= 50 || ids.size <= 50 || courseShare >= 0.05) {
		throw new Error("properties-only: the noisy keys do not fall outside the rules as designed");
	}
	return {
		model: v,
		scopes: [
			...CATEGORIES.map(([c]) => ({ name: c, rules: [propRule("category", c)] })),
			...CLIENTS.map(([c]) => ({ name: c, rules: [propRule("client", `[[${c}]]`)] })),
		],
		plain: [["meeting", 0.35]],
		preset: "properties",
		notesOnScopes:
			`Flat folder, no tags. category: has ${CATEGORIES.length} short values on most notes: one scope per ` +
			"value (lowercase recipe and book count with Recipe and Book). client: is 100% links: one scope per " +
			"client, [[Name]] and [[Name|alias]] equal; the client notes themselves carry no client: and are not " +
			`members. Not proposed: id (${ids.size} distinct values), created (${created} distinct dates, > 50) ` +
			`and course (${Math.round(courseShare * 1000) / 10}% of notes, under 5%).`,
	};
};

const johnnyDecimal = (rng) => {
	const v = makeModel(rng);
	const scopes = [];
	const index = v.add({ title: "00.00 Index", linkable: false, paras: [1, 1] });
	for (const [range, area, cats] of JD) {
		const areaDir = `${range} ${area}`;
		scopes.push({ name: area, aliases: [range], rules: [folderRule(areaDir)] });
		index.lines.push(`- ${areaDir}`);
		for (const [num, cat, items] of cats) {
			const catDir = `${areaDir}/${num} ${cat}`;
			scopes.push({ name: cat, aliases: [num], rules: [folderRule(catDir)] });
			index.lines.push(`  - ${num} ${cat}`);
			items.forEach((label, i) => {
				const id = `${num}.${String(i + 1).padStart(2, "0")} ${label}`;
				if (i > 0 && rng.chance(0.25)) {
					v.add({ folder: catDir, title: id });
					return;
				}
				const idDir = `${catDir}/${id}`;
				v.add({ folder: idDir, title: id });
				for (let j = rng.range(2, 7); j > 0; j--)
					v.add({ folder: idDir, title: `${label} ${rng.pick(TITLE_B)}` });
			});
		}
	}
	linkRandom(rng, v.notes, 1, 3);
	return {
		model: v,
		scopes,
		plain: [
			["home", 0.85],
			["car", 0.3],
			["work", 0.1],
		],
		preset: "johnny-decimal",
		notesOnScopes:
			"Johnny.Decimal: one scope per area range (10-19 Admin …) and per category (11 Finance …), named " +
			"without the number, which becomes an alias. IDs are single notes (11.01 Budget.md) or folders of " +
			"notes (11.02 Taxes/…). Not proposed: the IDs themselves and the root 00.00 Index note.",
	};
};

const zettelkasten = (rng) => {
	const v = makeModel(rng);
	const times = new Set();
	while (times.size < 294) times.add(BASE + rng.int(LAST_DAY + 1) * DAY + (7 * 60 + rng.int(16 * 60)) * 60);
	const zettels = [...times]
		.sort((a, b) => a - b)
		.map((t) => {
			const title = `${stamp(t)} ${rng.pick(ZK_SUBJECTS)} ${rng.pick(ZK_VERBS)} ${rng.pick(ZK_OBJECTS)}`;
			const n = v.add({ title, mtime: t + rng.int(3600), paras: [1, 3] });
			n.tags.push(rng.chance(0.6) ? "permanent" : rng.chance(0.6) ? "literature" : "fleeting");
			if (rng.chance(0.4)) n.tags.push(rng.pick(ZK_TOPICS));
			return n;
		});
	for (const n of rng.sample(zettels, 8)) n.tags.push(rng.pick(["source/book", "source/paper"]));
	zettels.forEach((n, i) => {
		for (let k = rng.range(3, 7); k > 0; k--) {
			const j = i > 0 && rng.chance(0.8) ? rng.int(i) : rng.int(zettels.length);
			const t = zettels[j];
			if (t === n || n.links.some((l) => l.startsWith(t.title))) continue;
			n.links.push(rng.chance(0.2) ? `${t.title}|${t.title.slice(13).toLowerCase()}` : t.title);
		}
	});
	const hubs = ZK_TOPICS.map((topic) => {
		const hub = v.add({ title: `Hub ${capital(topic)}`, linkable: false, paras: [1, 1] });
		const mine = zettels.filter((z) => z.tags.includes(topic));
		const more = rng.sample(
			zettels.filter((z) => !mine.includes(z)),
			rng.range(10, 25),
		);
		for (const z of [...mine, ...more].sort((a, b) => (a.title < b.title ? -1 : 1)))
			hub.lines.push(`- [[${z.title}]]`);
		return hub;
	});
	const index = v.add({ title: "Index", linkable: false, paras: [1, 1] });
	for (const h of hubs) index.lines.push(`- [[${h.title}]]`);
	for (const z of rng.sample(zettels, 10)) index.lines.push(`- [[${z.title}]]`);
	const sourceShare = zettels.filter((z) => z.tags.some((t) => t.startsWith("source/"))).length / v.notes.length;
	if (sourceShare >= 0.05) throw new Error("zettelkasten: #source/* should stay under 5%");
	return {
		model: v,
		scopes: [],
		preset: "none",
		hubs: [index, ...hubs].map((h) => ({ note: h.path, links: h.lines.length })),
		notesOnScopes:
			"Flat notes named by timestamp id, 3–7 wikilinks each, flat tags only (#permanent, #literature, " +
			`#fleeting and topics); #source/* is nested but on ${Math.round(sourceShare * 1000) / 10}% of notes ` +
			"(< 5%). No folder, property or tag preset applies, so nothing is proposed. The hub notes (Index, " +
			"Hub …) are listed under hubs for the later hub-note preset.",
	};
};

const PLANNERS = {
	para,
	flat,
	deep,
	"tags-only": tagsOnly,
	"properties-only": propertiesOnly,
	"johnny-decimal": johnnyDecimal,
	zettelkasten,
	"non-english": nonEnglish,
};

// ---------- expected.json ----------

const round2 = (x) => Math.round(x * 100) / 100;

const autoNote = (scopes) => {
	if (!scopes.length) return "No scopes, so Auto never applies: every typed word stays a plain search.";
	const on = scopes.filter((s) => s.auto);
	const off = scopes.filter((s) => !s.auto);
	const parts = [];
	if (on.length) {
		const worst = Math.max(...on.map((s) => s.ambiguity));
		parts.push(`Auto is safe for ${on.length} of ${scopes.length} scopes (ambiguity ≤ ${worst}).`);
	}
	if (off.length) {
		const list = off.map((s) => `${s.name} (mentioned in ${s.outside} notes outside, ambiguity ${s.ambiguity})`);
		parts.push(`Not for ${list.join(", ")}: an everyday word here, so it stays Suggest.`);
	}
	return parts.join(" ");
};

/** Decides what bodies say, renders them, and counts what a generator should find. */
const finish = (shape, rng, built) => {
	const { notes } = built.model;
	const scopes = built.scopes.map((s) => ({
		...s,
		members: new Set(notes.filter((n) => s.rules.some((r) => ruleMatch(n, r)))),
	}));
	for (const n of notes) {
		for (const s of scopes)
			if (rng.chance(s.members.has(n) ? 0.4 : 0.015)) n.say.push(mention(rng, n.lang, s.name));
		for (const [word, rate, langs] of built.plain ?? []) {
			if ((!langs || langs.includes(n.lang)) && rng.chance(rate)) n.say.push(rng.pick(PLAIN[word]));
		}
	}
	for (const n of notes) n.text = render(rng, n);
	const out = scopes.map((s) => {
		const re = mentionRe(s.name);
		const members = s.members.size;
		const outside = notes.filter((n) => !s.members.has(n) && re.test(n.text)).length;
		const ambiguity = round2(outside / members);
		if (ambiguity > 0.7 && ambiguity < 1.4) {
			throw new Error(`${shape}: ${s.name} has ambiguity ${ambiguity}, too close to the Auto threshold of 1`);
		}
		return {
			name: s.name,
			...(s.aliases ? { aliases: s.aliases } : {}),
			rules: s.rules.map((r) => ({ ...r, count: notes.filter((n) => ruleMatch(n, r)).length })),
			members,
			outside,
			ambiguity,
			auto: ambiguity <= 1,
		};
	});
	return {
		shape,
		notes: notes.length,
		preset: built.preset,
		scopes: out,
		notes_on_scopes: built.notesOnScopes,
		notes_on_auto: autoNote(out),
		...(built.hubs ? { hubs: built.hubs } : {}),
	};
};

// ---------- writing ----------

/** Empties dir only if it is a fixture vault from an earlier run (it has expected.json); never anything else. */
const prepare = (dir) => {
	if (existsSync(dir) && readdirSync(dir).length) {
		let ours = false;
		try {
			ours = typeof JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")).shape === "string";
		} catch {
			ours = false;
		}
		if (!ours)
			throw new Error(`${dir} is not empty and is not a fixture vault (no expected.json): not replacing it`);
		rmSync(dir, { recursive: true, force: true });
	}
	mkdirSync(join(dir, ".obsidian"), { recursive: true });
};

/** expected.json gets a fixed mtime too, so a whole vault directory is reproducible. */
const writeJson = (path, value) => {
	writeFileSync(path, `${JSON.stringify(value, null, "\t")}\n`);
	utimesSync(path, BASE + LAST_DAY * DAY, BASE + LAST_DAY * DAY);
};

const writeVault = (dir, shape, notes, expected) => {
	prepare(dir);
	writeJson(join(dir, "expected.json"), { shape, partial: true });
	let bytes = 0;
	for (const n of [...notes].sort((a, b) => (a.path < b.path ? -1 : 1))) {
		const p = join(dir, n.path);
		mkdirSync(dirname(p), { recursive: true });
		const buf = Buffer.from(n.text, "utf8");
		writeFileSync(p, buf);
		utimesSync(p, n.mtime, n.mtime);
		bytes += buf.length;
	}
	if (bytes > MAX_BYTES) throw new Error(`${shape}: ${bytes} bytes, over the ${MAX_BYTES} budget`);
	writeJson(join(dir, "expected.json"), expected);
	return bytes;
};

// ---------- x10: ten times a real corpus ----------

const LETTERS = /\p{L}+/gu;
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Markdown files under root, as Obsidian lists them (no dot-folders), sorted, with "/" separators. */
const listMarkdown = (root) => {
	const out = [];
	const walk = (rel) => {
		for (const e of readdirSync(join(root, rel), { withFileTypes: true }).sort(byName)) {
			if (e.name.startsWith(".")) continue;
			const r = rel ? `${rel}/${e.name}` : e.name;
			if (e.isDirectory()) walk(r);
			else if (e.isFile() && e.name.endsWith(".md")) out.push(r);
		}
	};
	walk("");
	return out;
};

/**
 * The source corpus plus nine copies under copy1/ … copy9/. In copy k, every word of six or more letters found in
 * at most two source notes (path and text) gets the suffix "k<k>" (quokka → quokkak3), in paths and text alike, so
 * links keep resolving and the vocabulary grows. Streams one note at a time; mtimes are the source's.
 */
const makeX10 = (dir, opts) => {
	if (!opts.source) throw new Error("x10 needs --source <corpus-dir>");
	const src = resolve(opts.source);
	const out = resolve(dir);
	const within = (a, b) => a === b || a.startsWith(`${b}${sep}`);
	if (within(out, src) || within(src, out)) throw new Error("x10: the output and the source must not overlap");
	const log = opts.log ?? ((m) => process.stderr.write(`${m}\n`));
	const files = listMarkdown(src);
	if (!files.length) throw new Error(`x10: no Markdown notes under ${src}`);
	const every = Math.max(1, Math.ceil(files.length / 10));
	const df = new Map();
	files.forEach((rel, i) => {
		const seen = new Set();
		for (const [w] of `${rel}\n${readFileSync(join(src, rel), "utf8")}`.matchAll(LETTERS)) {
			if (w.length >= 6 && [...w].length >= 6) seen.add(w.toLowerCase());
		}
		for (const w of seen) df.set(w, (df.get(w) ?? 0) + 1);
		if ((i + 1) % every === 0 || i + 1 === files.length)
			log(`x10: counted words in ${i + 1}/${files.length} notes`);
	});
	const rare = (w) => w.length >= 6 && [...w].length >= 6 && (df.get(w.toLowerCase()) ?? 0) <= 2;
	const grow = (s, k) => s.replace(LETTERS, (w) => (rare(w) ? `${w}k${k}` : w));
	prepare(out);
	writeJson(join(out, "expected.json"), { shape: "x10", partial: true });
	const used = new Set(files);
	let notes = 0;
	let bytes = 0;
	const put = (rel, data, mtime) => {
		const p = join(out, rel);
		mkdirSync(dirname(p), { recursive: true });
		writeFileSync(p, data);
		utimesSync(p, mtime, mtime);
		notes++;
		bytes += Buffer.byteLength(data);
	};
	files.forEach((rel, i) => {
		const from = join(src, rel);
		const buf = readFileSync(from);
		const mtime = statSync(from).mtimeMs / 1000;
		put(rel, buf, mtime);
		const text = buf.toString("utf8");
		for (let k = 1; k <= 9; k++) {
			let r = `copy${k}/${grow(rel, k)}`;
			if (used.has(r)) r = `copy${k}/${rel}`;
			if (used.has(r)) throw new Error(`x10: ${r} would be written twice`);
			used.add(r);
			put(r, grow(text, k), mtime);
		}
		if ((i + 1) % every === 0 || i + 1 === files.length) {
			log(`x10: copied ${i + 1}/${files.length} source notes (${notes} notes, ${(bytes / 1e6).toFixed(1)} MB)`);
		}
	});
	writeJson(join(out, "expected.json"), { shape: "x10", notes });
	return { shape: "x10", dir: out, notes, bytes, preset: null, scopes: 0 };
};

// ---------- entry points ----------

/**
 * Writes one vault into dir (the vault root). dir must be missing, empty, or a fixture vault from an earlier run.
 * opts: { source } for x10, { log } for x10 progress (default: stderr). Returns { shape, dir, notes, bytes, ... }.
 */
export const makeVault = (shape, dir, opts = {}) => {
	if (shape === "x10") return makeX10(dir, opts);
	const plan = PLANNERS[shape];
	if (!plan) throw new Error(`unknown shape "${shape}" (known: ${ALL_SHAPES.join(", ")})`);
	const rng = makeRng(hash(shape));
	const built = plan(rng);
	const expected = finish(shape, rng, built);
	const out = resolve(dir);
	const bytes = writeVault(out, shape, built.model.notes, expected);
	return { shape, dir: out, notes: expected.notes, bytes, preset: expected.preset, scopes: expected.scopes.length };
};

const main = (argv) => {
	const args = [...argv];
	const at = args.indexOf("--source");
	const source = at >= 0 ? args.splice(at, 2)[1] : undefined;
	const [outDir, ...asked] = args;
	if (!outDir || outDir.startsWith("-") || (at >= 0 && !source)) {
		console.error("usage: node bench/fixtures/make-vaults.mjs <out-dir> [shape ...] [--source <corpus-dir>]");
		console.error(`shapes: ${ALL_SHAPES.join(" ")} (default: all but x10)`);
		process.exit(2);
	}
	const shapes = asked.length ? asked : SHAPES;
	const unknown = shapes.filter((s) => !ALL_SHAPES.includes(s));
	if (unknown.length) {
		console.error(`unknown shape: ${unknown.join(", ")} (known: ${ALL_SHAPES.join(", ")})`);
		process.exit(2);
	}
	if (shapes.includes("x10") && !source) {
		console.error("x10 needs --source <corpus-dir>");
		process.exit(2);
	}
	for (const shape of shapes) {
		const r = makeVault(shape, join(resolve(outDir), shape), { source, log: (m) => console.error(m) });
		const extra = r.preset === null ? "" : `, preset ${r.preset}, ${r.scopes} scopes`;
		console.log(`${shape}: ${r.notes} notes, ${(r.bytes / 1e6).toFixed(2)} MB${extra}`);
	}
};

// Run as a script (also through a symlinked path), not when imported by the tests.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
	main(process.argv.slice(2));
}
