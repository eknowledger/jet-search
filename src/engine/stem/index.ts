/**
 * Word forms: one stemmer per language, applied to index words and
 * typed words alike. Words reach a stemmer already normalized by the analyzer (lower case, accents and
 * marks removed, Arabic letters folded), and only the equality of two stems matters, never their spelling.
 */

import { stemArabic } from "./arabic";
import { stemDutch } from "./dutch";
import { stemEnglish } from "./english";
import { stemFrench } from "./french";
import { stemGerman } from "./german";
import { stemItalian } from "./italian";
import { stemPortuguese } from "./portuguese";
import { stemSpanish } from "./spanish";
import { stemSwedish } from "./swedish";

/** A pure function from a normalized word to its stem; words sharing a stem form a root group. */
export type Stemmer = (word: string) => string;

/** Languages with a stemmer (ISO 639-1 codes). */
export type StemLanguage = "en" | "fr" | "de" | "es" | "it" | "pt" | "nl" | "sv" | "ar";

/**
 * The stemmer of each language: Snowball (adapted to unaccented input) for the Latin-script languages,
 * a light stemmer for Arabic.
 */
export const STEMMERS: Record<StemLanguage, Stemmer> = {
	en: stemEnglish,
	fr: stemFrench,
	de: stemGerman,
	es: stemSpanish,
	it: stemItalian,
	pt: stemPortuguese,
	nl: stemDutch,
	sv: stemSwedish,
	ar: stemArabic,
};

/** Every language with a stemmer, English first (the default). */
export const STEM_LANGUAGES: readonly StemLanguage[] = ["en", "fr", "de", "es", "it", "pt", "nl", "sv", "ar"];

const LATIN_WORD = /^\p{Script=Latin}+$/u;
const ARABIC_WORD = /^\p{Script=Arabic}+$/u;
const DIGIT = /\p{N}/u;

/** Whether every character of `word` is a Latin letter (ASCII letters checked without a regular expression). */
const latinWord = (word: string): boolean => {
	for (let i = 0; i < word.length; i++) {
		const c = word.charCodeAt(i) | 0x20;
		if (c >= 97 && c <= 122) continue;
		if (word.charCodeAt(i) < 128) return false;
		return LATIN_WORD.test(word);
	}
	return true;
};

/**
 * Whether a stemmer applies to a word: Latin-script languages to Latin-letter words, Arabic to
 * Arabic-script words; never to words with digits, CJK pairs or words under 3 characters.
 */
export const stemmable = (lang: StemLanguage, word: string): boolean => {
	if (word.length < 3) return false;
	if (lang === "ar") return ARABIC_WORD.test(word) && !DIGIT.test(word);
	return latinWord(word);
};
