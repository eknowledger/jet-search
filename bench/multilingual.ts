/**
 * The multilingual query set: 5 queries in each of English, French, German, Spanish, Arabic,
 * Chinese and Japanese, run against bench/fixtures/multilingual/ at the quality gate (rank-1 ≥ 90%,
 * MRR ≥ 0.95). The 56 notes there (8 per language) were written for this test on 2026-10-07; no copied text.
 * Each language covers a body word, a title, accents or diacritics typed bare, an inflection or a compound,
 * and a frontmatter tag that is not in any note's body. Targets are paths relative to the fixture folder.
 *
 * The set is written for the target tokenizer, not for today's engine. Markers on
 * the cases that need more than lower-casing and accent folding:
 *   needs stemming           another form of the word is in the note, 2+ edits away (typo tolerance can't cover it)
 *   needs compound splitting the word is only inside a longer German compound, and not at its start
 *   needs segmentation       Chinese/Japanese inside an unspaced sentence (Intl.Segmenter or two-character pairs)
 * The Arabic tashkeel case also needs Arabic marks (U+064B–U+065F) removed; NFKD alone keeps them.
 */
export type MultilingualCase = { q: string; kind: string; targets: string[] };

export const MULTILINGUAL: MultilingualCase[] = [
	// English
	{ q: "leverage points", kind: "en", targets: ["en/Reading Notes — Thinking in Systems.md"] },
	{ q: "sourdough bread", kind: "en", targets: ["en/Sourdough Bread.md"] },
	{ q: "batteries", kind: "en", targets: ["en/Errands and To-Dos.md"] }, // needs stemming
	{ q: "resume", kind: "en", targets: ["en/Journal — Rainy Sunday.md"] },
	{ q: "portugal", kind: "en", targets: ["en/Lisbon Trip Log.md"] },

	// French
	{ q: "plombier", kind: "fr", targets: ["fr/À faire cette semaine.md"] },
	{ q: "réunion d'équipe", kind: "fr", targets: ["fr/Réunion d'équipe.md"] },
	{ q: "fete des lumieres", kind: "fr", targets: ["fr/Carnet de voyage — Lyon.md"] },
	{ q: "bocaux", kind: "fr", targets: ["fr/Confiture d'abricots.md"] }, // needs stemming
	{ q: "classiques", kind: "fr", targets: ["fr/Notes de lecture — Le Comte de Monte-Cristo.md"] },

	// German
	{ q: "reifenwechsel werkstatt", kind: "de", targets: ["de/Erledigen bis Freitag.md"] },
	{ q: "teambesprechung", kind: "de", targets: ["de/Teambesprechung KW 41.md"] },
	{ q: "buro", kind: "de", targets: ["de/Projektplan Umzug ins neue Büro.md"] },
	{ q: "migration", kind: "de", targets: ["de/Technisches Konzept — Speicherschicht.md"] }, // needs compound splitting
	{ q: "klassiker", kind: "de", targets: ["de/Lesenotizen — Der Zauberberg.md"] },

	// Spanish
	{ q: "cola reintentos", kind: "es", targets: ["es/Diseño técnico — notificaciones push.md"] },
	{ q: "reunión semanal", kind: "es", targets: ["es/Reunión semanal del equipo.md"] },
	{ q: "artesanias", kind: "es", targets: ["es/Diario de viaje — Oaxaca.md"] },
	{ q: "limones", kind: "es", targets: ["es/Pollo al limón.md"] }, // needs stemming
	{ q: "imprescindibles", kind: "es", targets: ["es/Notas de lectura — Cien años de soledad.md"] },

	// Arabic
	{ q: "فاتورة الكهرباء", kind: "ar", targets: ["ar/قائمة المهام.md"] },
	{ q: "خطة المشروع", kind: "ar", targets: ["ar/خطة المشروع.md"] },
	// Tashkeel: the note has only "العَصَبِيَّة".
	{ q: "العصبية", kind: "ar", targets: ["ar/ملخص كتاب — المقدمة لابن خلدون.md"] },
	// Definite article: the note has only "المكتبة".
	{ q: "مكتبة", kind: "ar", targets: ["ar/يومياتي — مساء الجمعة.md"] }, // needs stemming
	{ q: "طبخ", kind: "ar", targets: ["ar/وصفة الكبسة.md"] },

	// Chinese
	{ q: "火锅", kind: "zh", targets: ["zh/成都旅行记.md"] }, // needs segmentation
	{ q: "缓存穿透", kind: "zh", targets: ["zh/缓存层技术方案.md"] }, // needs segmentation
	{ q: "体检 报告", kind: "zh", targets: ["zh/本周待办.md"] }, // needs segmentation
	{ q: "人类简史", kind: "zh", targets: ["zh/《人类简史》读书笔记.md"] },
	{ q: "家常菜", kind: "zh", targets: ["zh/红烧肉做法.md"] },

	// Japanese
	{ q: "紅葉", kind: "ja", targets: ["ja/京都旅行記.md"] }, // needs segmentation
	// Passes today by accident: NFKD splits デ and ベ into kana + voiced mark, which cuts the run into pieces.
	{ q: "データベース", kind: "ja", targets: ["ja/設計メモ — 同期処理.md"] }, // needs segmentation
	{ q: "引っ越し", kind: "ja", targets: ["ja/やることリスト.md"] }, // needs segmentation
	{ q: "肉じゃが", kind: "ja", targets: ["ja/肉じゃがのレシピ.md"] },
	{ q: "童話", kind: "ja", targets: ["ja/読書メモ — 銀河鉄道の夜.md"] },
];
