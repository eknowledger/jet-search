/**
 * Spanish: the Snowball "spanish" algorithm (snowballstem.org, version 3.x), our own code from the
 * published description, adapted to unaccented input.
 *
 * Words arrive without accents (á → a, é → e, ñ → n, ü → u…); accented vowels are vowels as their
 * plain letters are, so regions do not move. Adaptations:
 * - Suffixes written with an accent are matched without it (-ación → -acion, -logía → -logia, -áis →
 *   -ais, -éis → -eis, -aréis → -areis…), so `nacion` and `naciones` still share a stem.
 * - Unaccented forms that would collide with common noun, adjective or other verb endings are dropped:
 *   the imperfect -ía, -ías, -ían, -íais, -íamos (`propia`/`propio`, `cambian`/`cambiar`), the
 *   conditional -ría family (`necesaria`, `materia`), the futures -aré, -erá, -erás, -erán, -eré, -irá,
 *   -irás, -irán, -iré (`software`, `primera`/`primero`, `esperan`/`esperar`), -ió (`servicio`/`servicios`),
 *   -ís (`dosis`), -ábamos, -áramos, -ásemos (`acabamos`, `preparamos`) and step 3's -í (`taxi`). Those
 *   verb forms keep a longer stem, still shared by the other persons of the same tense (`tenia`,
 *   `tenias`, `tenian` → `teni`; `hablaria`, `hablariamos` → `hablari`).
 */

import { letterSet, regionAfter, romanceRV, suffixMatcher } from "./snowball";

const V = letterSet("aeiou");

const PRONOUN = suffixMatcher([
	["me", "se", "sela", "selo", "selas", "selos", "la", "le", "lo", "las", "les", "los", "nos"],
]);
const PRONOUN_AFTER = suffixMatcher([["iendo", "ando", "ar", "er", "ir"], ["yendo"]]);

const STANDARD = suffixMatcher([
	[
		"anza",
		"anzas",
		"ico",
		"ica",
		"icos",
		"icas",
		"ismo",
		"ismos",
		"able",
		"ables",
		"ible",
		"ibles",
		"ista",
		"istas",
		"oso",
		"osa",
		"osos",
		"osas",
		"amiento",
		"amientos",
		"imiento",
		"imientos",
	],
	["adora", "ador", "acion", "adoras", "adores", "aciones", "ante", "antes", "ancia", "ancias"],
	["logia", "logias"],
	["ucion", "uciones"],
	["encia", "encias"],
	["amente"],
	["mente"],
	["idad", "idades"],
	["iva", "ivo", "ivas", "ivos"],
]);
const AFTER_AMENTE = suffixMatcher([["iv"], ["os", "ic", "ad"]]);
const AFTER_MENTE = suffixMatcher([["ante", "able", "ible"]]);
const AFTER_IDAD = suffixMatcher([["abil", "ic", "iv"]]);

const Y_VERB = suffixMatcher([["ya", "ye", "yan", "yen", "yeron", "yendo", "yo", "yas", "yes", "yais", "yamos"]]);

const VERB = suffixMatcher([
	["en", "es", "eis", "emos"],
	[
		"aba",
		"ada",
		"ida",
		"ara",
		"iera",
		"ad",
		"ed",
		"id",
		"ase",
		"iese",
		"aste",
		"iste",
		"an",
		"aban",
		"aran",
		"ieran",
		"asen",
		"iesen",
		"aron",
		"ieron",
		"ado",
		"ido",
		"ando",
		"iendo",
		"ar",
		"er",
		"ir",
		"as",
		"abas",
		"adas",
		"idas",
		"aras",
		"ieras",
		"ases",
		"ieses",
		"ais",
		"abais",
		"arais",
		"ierais",
		"aseis",
		"ieseis",
		"asteis",
		"isteis",
		"ados",
		"idos",
		"amos",
		"imos",
		"ieramos",
		"iesemos",
		"aremos",
		"eremos",
		"iremos",
		"areis",
		"ereis",
		"ireis",
	],
]);

const RESIDUAL = suffixMatcher([["os", "a", "o"], ["e"]]);

/** Spanish stem of a lower-case, unaccented word. */
export const stemSpanish = (word: string): string => {
	let w = word;
	const pV = romanceRV(w, V);
	const p1 = regionAfter(w, 0, V);
	const p2 = regionAfter(w, p1, V);

	// Step 0: attached pronoun after a gerund or infinitive in RV (`haciendola` → `haciendo`).
	const pr = PRONOUN(w);
	if (pr !== undefined) {
		const k = w.length - pr.word.length;
		const verb = PRONOUN_AFTER(w, 0, k);
		if (verb !== undefined && k - verb.word.length >= pV && (verb.group === 0 || w.charCodeAt(k - 6) === 117))
			w = w.slice(0, k);
	}

	// Step 1: standard suffixes.
	let done = false;
	const m = STANDARD(w);
	if (m !== undefined) {
		const k = w.length - m.word.length;
		const head = w.slice(0, k);
		switch (m.group) {
			case 0:
				if (k >= p2) [w, done] = [head, true];
				break;
			case 1:
				if (k >= p2) {
					[w, done] = [head, true];
					if (w.endsWith("ic") && k - 2 >= p2) w = w.slice(0, -2);
				}
				break;
			case 2:
				if (k >= p2) [w, done] = [`${head}log`, true];
				break;
			case 3:
				if (k >= p2) [w, done] = [`${head}u`, true];
				break;
			case 4:
				if (k >= p2) [w, done] = [`${head}ente`, true];
				break;
			case 5:
				if (k >= p1) {
					[w, done] = [head, true];
					const a = AFTER_AMENTE(w);
					if (a !== undefined && k - 2 >= p2) {
						w = w.slice(0, k - 2);
						if (a.group === 0 && w.endsWith("at") && k - 4 >= p2) w = w.slice(0, -2);
					}
				}
				break;
			case 6:
				if (k >= p2) {
					[w, done] = [head, true];
					const a = AFTER_MENTE(w);
					if (a !== undefined && k - 4 >= p2) w = w.slice(0, k - 4);
				}
				break;
			case 7:
				if (k >= p2) {
					[w, done] = [head, true];
					const a = AFTER_IDAD(w);
					if (a !== undefined && k - a.word.length >= p2) w = w.slice(0, k - a.word.length);
				}
				break;
			default:
				if (k >= p2) {
					[w, done] = [head, true];
					if (w.endsWith("at") && k - 2 >= p2) w = w.slice(0, -2);
				}
		}
	}

	// Step 2a: verb suffixes beginning with y, in RV, after u.
	if (!done) {
		const y = Y_VERB(w, pV);
		if (y !== undefined) {
			const k = w.length - y.word.length;
			if (w.charCodeAt(k - 1) === 117) [w, done] = [w.slice(0, k), true];
		}
	}

	// Step 2b: other verb suffixes, in RV (gu-en → g).
	if (!done) {
		const v = VERB(w, pV);
		if (v !== undefined) {
			const k = w.length - v.word.length;
			const gu = v.group === 0 && w.charCodeAt(k - 1) === 117 && w.charCodeAt(k - 2) === 103;
			w = w.slice(0, gu ? k - 1 : k);
		}
	}

	// Step 3: residual suffix in RV.
	const r = RESIDUAL(w);
	if (r !== undefined) {
		const k = w.length - r.word.length;
		if (k >= pV) {
			w = w.slice(0, k);
			if (r.group === 1 && w.endsWith("gu") && k - 1 >= pV) w = w.slice(0, -1);
		}
	}
	return w;
};
