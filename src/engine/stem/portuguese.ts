/**
 * Portuguese: the Snowball "portuguese" algorithm (snowballstem.org, version 3.x), our own code from
 * the published description, adapted to unaccented input.
 *
 * Words arrive without accents (á, â, ã → a; é, ê → e; í → i; ó, ô, õ → o; ú → u; ç → c); accented
 * vowels are vowels as their plain letters are. Adaptations:
 * - The algorithm reads ã and õ as a vowel plus a consonant mark (a~, o~); here they are plain a and o,
 *   so -ação, -ações, -ução, -uções, -arão, -erão, -irão are matched as -acao, -acoes, -ucao, -ucoes,
 *   -arao, -erao, -irao (`informacao`, `informacoes` → `inform`).
 * - Other suffixes written with an accent are matched without it (-ável → -avel, -ência → -encia,
 *   -áveis → -aveis…); those that become duplicates of plain ones (-ará → -ara) change nothing.
 * - -íamos, -áramos, -éramos, -íramos are dropped: unaccented, they would cut the present tense of
 *   -iar, -arar, -erar, -irar verbs (`enviamos`, `preparamos`, `consideramos`, `retiramos`), which
 *   keep the original -amos; so is -ésseis (`dezesseis` would become `dez`).
 */

import { letterSet, regionAfter, romanceRV, suffixMatcher } from "./snowball";

const V = letterSet("aeiou");

const STANDARD = suffixMatcher([
	[
		"eza",
		"ezas",
		"ico",
		"ica",
		"icos",
		"icas",
		"ismo",
		"ismos",
		"avel",
		"ivel",
		"ista",
		"istas",
		"oso",
		"osa",
		"osos",
		"osas",
		"amento",
		"amentos",
		"imento",
		"imentos",
		"adora",
		"ador",
		"acao",
		"adoras",
		"adores",
		"acoes",
		"ante",
		"antes",
		"ancia",
	],
	["logia", "logias"],
	["ucao", "ucoes"],
	["encia", "encias"],
	["amente"],
	["mente"],
	["idade", "idades"],
	["iva", "ivo", "ivas", "ivos"],
	["ira", "iras"],
]);
const AFTER_AMENTE = suffixMatcher([["iv"], ["os", "ic", "ad"]]);
const AFTER_MENTE = suffixMatcher([["ante", "avel", "ivel"]]);
const AFTER_IDADE = suffixMatcher([["abil", "ic", "iv"]]);

const VERB = suffixMatcher([
	[
		"ada",
		"ida",
		"ia",
		"aria",
		"eria",
		"iria",
		"ara",
		"era",
		"ira",
		"ava",
		"asse",
		"esse",
		"isse",
		"aste",
		"este",
		"iste",
		"ei",
		"arei",
		"erei",
		"irei",
		"am",
		"iam",
		"ariam",
		"eriam",
		"iriam",
		"aram",
		"eram",
		"iram",
		"avam",
		"em",
		"arem",
		"erem",
		"irem",
		"assem",
		"essem",
		"issem",
		"ado",
		"ido",
		"ando",
		"endo",
		"indo",
		"arao",
		"erao",
		"irao",
		"ar",
		"er",
		"ir",
		"as",
		"adas",
		"idas",
		"ias",
		"arias",
		"erias",
		"irias",
		"aras",
		"eras",
		"iras",
		"avas",
		"es",
		"ardes",
		"erdes",
		"irdes",
		"ares",
		"eres",
		"ires",
		"asses",
		"esses",
		"isses",
		"astes",
		"estes",
		"istes",
		"is",
		"ais",
		"eis",
		"ieis",
		"arieis",
		"erieis",
		"irieis",
		"areis",
		"ereis",
		"ireis",
		"asseis",
		"isseis",
		"aveis",
		"ados",
		"idos",
		"amos",
		"ariamos",
		"eriamos",
		"iriamos",
		"avamos",
		"emos",
		"aremos",
		"eremos",
		"iremos",
		"assemos",
		"essemos",
		"issemos",
		"imos",
		"armos",
		"ermos",
		"irmos",
		"eu",
		"iu",
		"ou",
	],
]);

const RESIDUAL = suffixMatcher([["os", "a", "i", "o"]]);

/** Portuguese stem of a lower-case, unaccented word. */
export const stemPortuguese = (word: string): string => {
	let w = word;
	const pV = romanceRV(w, V);
	const p1 = regionAfter(w, 0, V);
	const p2 = regionAfter(w, p1, V);

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
				if (k >= p2) [w, done] = [`${head}log`, true];
				break;
			case 2:
				if (k >= p2) [w, done] = [`${head}u`, true];
				break;
			case 3:
				if (k >= p2) [w, done] = [`${head}ente`, true];
				break;
			case 4:
				if (k >= p1) {
					[w, done] = [head, true];
					const a = AFTER_AMENTE(w);
					if (a !== undefined && k - 2 >= p2) {
						w = w.slice(0, k - 2);
						if (a.group === 0 && w.endsWith("at") && k - 4 >= p2) w = w.slice(0, -2);
					}
				}
				break;
			case 5:
				if (k >= p2) {
					[w, done] = [head, true];
					const a = AFTER_MENTE(w);
					if (a !== undefined && k - 4 >= p2) w = w.slice(0, k - 4);
				}
				break;
			case 6:
				if (k >= p2) {
					[w, done] = [head, true];
					const a = AFTER_IDADE(w);
					if (a !== undefined && k - a.word.length >= p2) w = w.slice(0, k - a.word.length);
				}
				break;
			case 7:
				if (k >= p2) {
					[w, done] = [head, true];
					if (w.endsWith("at") && k - 2 >= p2) w = w.slice(0, -2);
				}
				break;
			default:
				// -eira, -eiras → -eir (usually not verbal).
				if (k >= pV && w.charCodeAt(k - 1) === 101) [w, done] = [`${head}ir`, true];
		}
	}

	// Step 2: verb suffixes in RV.
	if (!done) {
		const v = VERB(w, pV);
		if (v !== undefined) [w, done] = [w.slice(0, w.length - v.word.length), true];
	}

	let n = w.length;
	if (done) {
		// Step 3: -ci → -c, the i in RV.
		if (w.charCodeAt(n - 1) === 105 && w.charCodeAt(n - 2) === 99 && n - 1 >= pV) w = w.slice(0, -1);
	} else {
		// Step 4: residual suffix in RV.
		const r = RESIDUAL(w);
		if (r !== undefined && n - r.word.length >= pV) w = w.slice(0, n - r.word.length);
	}

	// Step 5: final e in RV, then the u of gu or the i of ci in RV.
	n = w.length;
	if (w.charCodeAt(n - 1) === 101 && n - 1 >= pV) {
		w = w.slice(0, -1);
		n--;
		const c = w.charCodeAt(n - 1);
		const b = w.charCodeAt(n - 2);
		if (((c === 117 && b === 103) || (c === 105 && b === 99)) && n - 1 >= pV) w = w.slice(0, -1);
	}
	return w;
};
