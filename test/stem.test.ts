import { describe, expect, it } from "vitest";
import { normalize } from "../src/engine/analyzer";
import { STEM_LANGUAGES, STEMMERS, stemmable, type StemLanguage } from "../src/engine/stem";

/** A seeded random generator (mulberry32), so failures repeat. */
const rng = (seed: number) => () => {
	seed |= 0;
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** The stem of a word as it reaches the stemmer: normalized by the analyzer first (accents removed). */
const stem = (lang: StemLanguage, word: string): string => STEMMERS[lang](normalize(word));
const stems = (lang: StemLanguage, words: readonly string[]): string[] => words.map((w) => stem(lang, w));

/** Asserts that all `words` share one stem in `lang`. */
const sameStem = (lang: StemLanguage, words: readonly string[]): void => {
	const got = stems(lang, words);
	expect(new Set(got).size, `${words.join(", ")} → ${got.join(", ")}`).toBe(1);
};

/** Asserts that `a` and `b` get different stems in `lang`. */
const differentStems = (lang: StemLanguage, a: string, b: string): void => {
	expect(stem(lang, a), `${a} vs ${b}`).not.toBe(stem(lang, b));
};

/**
 * Input → stem pairs from the published Snowball sample vocabularies and descriptions, written as
 * the words reach the stemmer (unaccented); each matches Snowball's own output for the word with its
 * accents, accents removed.
 */
const SNOWBALL: Record<Exclude<StemLanguage, "ar">, readonly (readonly [string, string])[]> = {
	en: [
		["consign", "consign"],
		["consigned", "consign"],
		["consigning", "consign"],
		["consignment", "consign"],
		["consistency", "consist"],
		["consistently", "consist"],
		["consolation", "consol"],
		["consolatory", "consolatori"],
		["knackeries", "knackeri"],
		["knavery", "knaveri"],
		["kneeling", "kneel"],
		["generate", "generat"],
		["generously", "generous"],
		["communication", "communic"],
		["university", "universiti"],
		["pasted", "paste"],
		["skis", "ski"],
		["skies", "sky"],
		["news", "news"],
		["atlas", "atlas"],
		["dying", "die"],
		["herring", "herring"],
		["evening", "evening"],
		["proceed", "proceed"],
		["early", "earli"],
		["hopping", "hop"],
		["cries", "cri"],
		["ties", "tie"],
		["gas", "gas"],
		["gaps", "gap"],
	],
	fr: [
		["continuellement", "continuel"],
		["continuelle", "continuel"],
		["chevaux", "cheval"],
		["activite", "activ"],
		["nationalite", "national"],
		["importance", "import"],
		["parlaient", "parl"],
		["finissons", "fin"],
		["heureusement", "heureux"],
		["rapidement", "rapid"],
		["journaux", "journal"],
		["mangeaient", "mang"],
		["premiere", "premi"],
		["societe", "societ"],
		["jouer", "jou"],
		["croyiez", "croi"],
		["abondamment", "abond"],
		["evidemment", "evident"],
		["profondement", "profond"],
		["qualites", "qualit"],
		["logique", "logiqu"],
		["employe", "emploi"],
		["tapis", "tapis"],
		["gratuitement", "gratuit"],
	],
	de: [
		["aufeinanderfolgende", "aufeinanderfolg"],
		["aufeinanderfolgenden", "aufeinanderfolg"],
		["kategorien", "kategori"],
		["hauser", "haus"],
		["bedurfnissen", "bedurfnis"],
		["ackern", "ack"],
		["ackers", "ack"],
		["armes", "arm"],
		["derbsten", "derb"],
		["kindern", "kind"],
		["moglichkeiten", "moglich"],
		["freundlichkeit", "freundlich"],
		["lehrerin", "lehr"],
		["zeitungen", "zeitung"],
		["planeten", "planet"],
		["internet", "internet"],
		["systemen", "system"],
		["ergebnisse", "ergebnis"],
		["quelle", "quell"],
		["strasse", "strass"],
		["vertreter", "vertret"],
		["vertretung", "vertret"],
	],
	es: [
		["canciones", "cancion"],
		["naciones", "nacion"],
		["chicos", "chic"],
		["casas", "cas"],
		["hablando", "habl"],
		["hablaba", "habl"],
		["hablamos", "habl"],
		["hablo", "habl"],
		["comemos", "com"],
		["comida", "com"],
		["rapidamente", "rapid"],
		["necesarios", "necesari"],
		["propia", "propi"],
		["servicios", "servici"],
		["haciendola", "hac"],
		["informaciones", "inform"],
		["posibilidades", "posibil"],
		["organizacion", "organiz"],
		["turistas", "turist"],
		["felicidad", "felic"],
	],
	it: [
		["abbandonata", "abbandon"],
		["abbandonate", "abbandon"],
		["abbandonati", "abbandon"],
		["abbandonare", "abbandon"],
		["abbandono", "abband"],
		["citta", "citt"],
		["universita", "univers"],
		["attivita", "attiv"],
		["possibilita", "possibil"],
		["parlavano", "parl"],
		["crocchi", "crocc"],
		["crocchio", "crocc"],
		["guardandogli", "guard"],
		["divano", "divan"],
		["diva", "div"],
		["amiche", "amic"],
		["nazioni", "nazion"],
		["felicemente", "felic"],
	],
	pt: [
		["informacao", "inform"],
		["informacoes", "inform"],
		["livros", "livr"],
		["falando", "fal"],
		["falava", "fal"],
		["falou", "fal"],
		["brasileira", "brasileir"],
		["brasileiros", "brasileir"],
		["responsavel", "respons"],
		["responsaveis", "respons"],
		["cidades", "cidad"],
		["felicidade", "felic"],
		["rapidamente", "rapid"],
		["gatos", "gat"],
		["organizacao", "organiz"],
		["problemas", "problem"],
	],
	nl: [
		["lichamelijk", "licham"],
		["lichamelijke", "licham"],
		["lichamelijkheden", "licham"],
		["lichamen", "licham"],
		["lichtjes", "lichtjes"],
		["opglanzing", "opglanz"],
		["opglanzingen", "opglanz"],
		["opgroeiplaats", "opgroeiplat"],
		["ophaal", "ophal"],
		["ophalers", "ophaler"],
		["brood", "brod"],
		["huizen", "huiz"],
		["gelukkige", "gelukk"],
		["mogelijkheden", "mogelijk"],
		["kinderen", "kinder"],
		["vergaderingen", "vergader"],
	],
	sv: [
		["jakten", "jakt"],
		["jaktkarlar", "jaktkarl"],
		["jaktkarlarne", "jaktkarl"],
		["jaktkarlens", "jaktkarl"],
		["jalusierna", "jalusi"],
		["japanska", "japansk"],
		["jasminer", "jasmin"],
		["jemforelser", "jemfor"],
		["klockornas", "klock"],
		["klockarens", "klock"],
		["husen", "hus"],
		["valet", "val"],
		["flickan", "flickan"],
		["friskt", "frisk"],
		["universitetet", "universitet"],
	],
};

describe("Snowball sample vocabularies, unaccented", () => {
	for (const [lang, pairs] of Object.entries(SNOWBALL) as [StemLanguage, readonly (readonly [string, string])[]][])
		it(`${lang}: ${pairs.length} known stems`, () => {
			expect(pairs.map(([w]) => [w, STEMMERS[lang](w)])).toEqual(pairs.map(([w, s]) => [w, s]));
		});
});

describe("English (Porter2)", () => {
	it("joins plurals and verb forms", () => {
		sameStem("en", ["running", "runs", "run"]);
		sameStem("en", ["meetings", "meeting", "meet"]);
		sameStem("en", ["batteries", "battery"]);
		sameStem("en", ["connect", "connected", "connecting", "connection", "connections"]);
		sameStem("en", ["generate", "generates", "generated", "generating"]);
		sameStem("en", ["hopeful", "hopefulness", "hope"]);
	});

	it("keeps what Porter2 keeps apart", () => {
		// Porter2 does not join these (analyses → analys, analysis → analysi; runner keeps -er).
		expect(stems("en", ["analyses", "analysis", "analysed"])).toEqual(["analys", "analysi", "analys"]);
		expect(stems("en", ["runner", "run"])).toEqual(["runner", "run"]);
		// The R1 prefixes and exceptions: gener-, univers-, past, news, -ing words.
		expect(stems("en", ["general", "generic", "generous"])).toEqual(["general", "generic", "generous"]);
		expect(stems("en", ["universe", "universal", "university"])).toEqual(["univers", "universal", "universiti"]);
		differentStems("en", "past", "paste");
		differentStems("en", "news", "new");
		differentStems("en", "herring", "her");
	});
});

describe("French", () => {
	it("joins plural and feminine forms, -aux and adverbs", () => {
		sameStem("fr", ["bocaux", "bocal"]);
		sameStem("fr", ["chevaux", "cheval"]);
		sameStem("fr", ["continuellement", "continuel", "continuelle", "continuels"]);
		sameStem("fr", ["important", "importante", "importants", "importance"]);
		sameStem("fr", ["heureux", "heureuse", "heureuses", "heureusement"]);
	});

	it("matches accented suffixes without their accents", () => {
		sameStem("fr", ["activité", "activités", "active", "actives"]);
		sameStem("fr", ["parler", "parlé", "parlée", "parlées", "parlés", "parlait"]);
		sameStem("fr", ["première", "premières", "premier", "premiers"]);
		sameStem("fr", ["lumière", "lumières"]);
		sameStem("fr", ["idée", "idées"]);
		sameStem("fr", ["employé", "employés", "employer"]);
	});

	it("does not cut endings that only look like accented suffixes", () => {
		sameStem("fr", ["différent", "différente", "différents", "différence"]);
		expect(stem("fr", "différent")).toBe("different");
		sameStem("fr", ["résultat", "résultats"]);
		sameStem("fr", ["régime", "régimes"]);
		sameStem("fr", ["limite", "limites"]);
	});
});

describe("German", () => {
	it("joins plural and case forms", () => {
		sameStem("de", ["Häuser", "Häusern", "Haus", "Hause"]);
		sameStem("de", ["Kinder", "Kindern", "Kind"]);
		sameStem("de", ["Datenbank", "Datenbanken"]);
		sameStem("de", ["Lehrer", "Lehrerin", "Lehrerinnen"]);
		sameStem("de", ["Möglichkeit", "Möglichkeiten", "möglich"]);
	});

	it("reads ae, oe, ue as umlauts, but keeps a final ä + e ending", () => {
		sameStem("de", ["Haeuser", "Häuser", "Haus"]);
		sameStem("de", ["fuer", "für"]);
		sameStem("de", ["schoen", "schön"]);
		sameStem("de", ["Muenchen", "München"]);
		sameStem("de", ["Europäer", "Europäern", "Europaeer"]);
		expect(stem("de", "Quelle")).toBe("quell");
	});

	it("keeps the -et exceptions apart", () => {
		differentStems("de", "Internet", "interne");
		differentStems("de", "Planet", "Plan");
	});
});

describe("Spanish", () => {
	it("joins plural, gender and -ción forms", () => {
		sameStem("es", ["limones", "limón"]);
		sameStem("es", ["canciones", "canción"]);
		sameStem("es", ["chica", "chicas", "chico", "chicos"]);
		sameStem("es", ["necesaria", "necesarias", "necesario", "necesarios"]);
		sameStem("es", ["propia", "propio"]);
		sameStem("es", ["servicio", "servicios"]);
		sameStem("es", ["hablar", "hablando", "hablaba", "hablamos", "habló"]);
	});

	it("gives an unaccented imperfect one stem across persons", () => {
		sameStem("es", ["tenía", "tenías", "tenían", "teníamos"]);
		differentStems("es", "dosis", "dos");
	});
});

describe("Italian", () => {
	it("joins gender, number and verb forms", () => {
		sameStem("it", ["amico", "amici", "amica", "amiche"]);
		sameStem("it", ["gatto", "gatti", "gatta"]);
		sameStem("it", ["abbandonata", "abbandonate", "abbandonati", "abbandonato", "abbandonare"]);
		sameStem("it", ["attività", "attivo", "attiva"]);
	});

	it("does not read -ero, -era as accented futures", () => {
		sameStem("it", ["numero", "numeri"]);
		sameStem("it", ["sincera", "sincero", "sinceri"]);
		differentStems("it", "divano", "diva");
	});
});

describe("Portuguese", () => {
	it("joins plural, gender and -ção forms", () => {
		sameStem("pt", ["informação", "informações"]);
		sameStem("pt", ["brasileira", "brasileiro", "brasileiros"]);
		sameStem("pt", ["gato", "gatos", "gata", "gatas"]);
		sameStem("pt", ["responsável", "responsáveis"]);
		sameStem("pt", ["falar", "falando", "falava", "falou", "falamos"]);
	});

	it("does not read the present tense as an accented past", () => {
		sameStem("pt", ["preparamos", "preparar"]);
		sameStem("pt", ["consideramos", "considerar"]);
		differentStems("pt", "dezesseis", "dez");
	});
});

describe("Dutch", () => {
	it("joins plural and derived forms", () => {
		sameStem("nl", ["vergadering", "vergaderingen"]);
		sameStem("nl", ["boek", "boeken"]);
		sameStem("nl", ["maan", "manen"]);
		sameStem("nl", ["mogelijkheid", "mogelijkheden"]);
		sameStem("nl", ["lichamelijk", "lichamelijke", "lichamen"]);
	});
});

describe("Swedish", () => {
	it("joins plural and definite forms", () => {
		sameStem("sv", ["bil", "bilar", "bilen", "bilarna"]);
		sameStem("sv", ["dag", "dagar", "dagen", "dagarna"]);
		sameStem("sv", ["flickor", "flickorna"]);
	});

	it("reads -os and -ost after an öst-ending letter as -ös and -öst", () => {
		sameStem("sv", ["hopplös", "hopplöst", "hopplösa"]);
		sameStem("sv", ["nervös", "nervöst", "nervösa"]);
	});
});

describe("Arabic (light stemmer)", () => {
	it("joins a word with its article, conjunction and suffix forms", () => {
		sameStem("ar", ["مكتبة", "مكتب", "مكتبات", "المكتبة"]);
		sameStem("ar", ["كتاب", "والكتاب", "بالكتاب", "كالكتاب", "فالكتاب", "للكتاب", "كتابها"]);
		sameStem("ar", ["معلم", "معلمون", "معلمين", "معلمان", "معلمات"]);
		sameStem("ar", ["سيارة", "سيارات", "السيارات"]);
	});

	it("keeps at least two letters, three after wa-", () => {
		expect(stem("ar", "مكتبة")).toBe("مكتب");
		expect(stem("ar", "وكتب")).toBe("كتب");
		expect(stem("ar", "ولد")).toBe("ولد");
		expect(stem("ar", "هو")).toBe("هو");
	});
});

describe("stemmable", () => {
	it("applies Latin-script stemmers to Latin words and the Arabic one to Arabic words", () => {
		expect(stemmable("en", "running")).toBe(true);
		expect(stemmable("de", "strasse")).toBe(true);
		expect(stemmable("sv", "søren")).toBe(true);
		expect(stemmable("ar", "مكتبه")).toBe(true);
		expect(stemmable("en", "مكتبه")).toBe(false);
		expect(stemmable("ar", "running")).toBe(false);
		expect(stemmable("fr", "привет")).toBe(false);
	});

	it("never applies to words with digits, CJK pairs or words under 3 characters", () => {
		expect(stemmable("en", "v2")).toBe(false);
		expect(stemmable("en", "release2026")).toBe(false);
		expect(stemmable("ar", "مكتب٣")).toBe(false);
		expect(stemmable("en", "语音")).toBe(false);
		expect(stemmable("en", "语音模")).toBe(false);
		expect(stemmable("en", "an")).toBe(false);
		expect(stemmable("ar", "هو")).toBe(false);
		expect(stemmable("en", "run")).toBe(true);
	});
});

/** Generated words: random letters plus one of each language's common endings. */
const ENDINGS: Record<StemLanguage, readonly string[]> = {
	en: ["", "s", "es", "ed", "ing", "ingly", "ly", "ness", "ational", "ement", "ies", "izer", "fulness", "ive"],
	fr: ["", "s", "es", "e", "ement", "ation", "ites", "euse", "aux", "issant", "erions", "aient", "ier"],
	de: ["", "e", "en", "ern", "es", "s", "est", "et", "ung", "heit", "lichkeit", "isch", "erinnen", "ln"],
	es: ["", "s", "os", "as", "es", "aciones", "amente", "idades", "ando", "ieron", "abais", "selos", "iendo"],
	it: ["", "i", "e", "o", "a", "azione", "amente", "ita", "ando", "erebbero", "iamo", "gliela", "ichi"],
	pt: ["", "s", "os", "as", "acao", "acoes", "amente", "idades", "ando", "ariamos", "issem", "eira", "ci"],
	nl: ["", "en", "e", "s", "heden", "heid", "ing", "ingen", "lijk", "baar", "ig", "tje", "se"],
	sv: ["", "a", "ar", "arna", "en", "et", "ets", "heterna", "lig", "els", "ost", "fullt", "ande"],
	ar: ["", "ها", "ان", "ات", "ون", "ين", "يه", "ه", "ي"],
};
const LATIN_LETTERS = "aeiouybcdfghjklmnprstvwxz";
const ARABIC_LETTERS = "ابتثجحخدذرزسشصضطظعغفقكلمنهوي";
const ARABIC_PREFIXES = ["", "", "ال", "وال", "بال", "و", "لل"];

const generate = (lang: StemLanguage, count: number): string[] => {
	const r = rng(lang.charCodeAt(0) * 31 + lang.charCodeAt(1));
	const letters = lang === "ar" ? ARABIC_LETTERS : LATIN_LETTERS;
	const endings = ENDINGS[lang];
	const out: string[] = [];
	for (let i = 0; i < count; i++) {
		let w = lang === "ar" ? (ARABIC_PREFIXES[Math.floor(r() * ARABIC_PREFIXES.length)] ?? "") : "";
		const n = 2 + Math.floor(r() * 8);
		for (let j = 0; j < n; j++) w += letters[Math.floor(r() * letters.length)] ?? "";
		out.push(w + (endings[Math.floor(r() * endings.length)] ?? ""));
	}
	return out;
};

describe("performance and totality", () => {
	for (const lang of STEM_LANGUAGES)
		it(`${lang}: stems 50,000 generated words in under 0.5 s, each to a non-empty stem`, () => {
			const words = generate(lang, 50_000);
			const stemmer = STEMMERS[lang];
			const out: string[] = Array.from({ length: words.length });
			const start = performance.now();
			for (let i = 0; i < words.length; i++) out[i] = stemmer(words[i] as string);
			const ms = performance.now() - start;
			expect(ms).toBeLessThan(500);
			expect(out.every((s) => s.length > 0)).toBe(true);
		});
});
