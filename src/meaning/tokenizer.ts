/**
 * BERT's uncased WordPiece tokenizer, pure: what potion-base-8M's tokenizer.json describes
 * (BertNormalizer with lowercase and accents stripped, BertPreTokenizer, WordPiece with "##" and 100
 * characters a word at most). Checked against Hugging Face's own tokenizer on a fixture.
 */

const isControl = (c: string): boolean => {
	if (c === "\t" || c === "\n" || c === "\r") return false;
	return /\p{Cc}|\p{Cf}/u.test(c);
};
const isWhite = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\r" || /\p{Zs}/u.test(c);
const isCjk = (cp: number): boolean =>
	(cp >= 0x4e00 && cp <= 0x9fff) ||
	(cp >= 0x3400 && cp <= 0x4dbf) ||
	(cp >= 0x20000 && cp <= 0x2a6df) ||
	(cp >= 0x2a700 && cp <= 0x2b73f) ||
	(cp >= 0x2b740 && cp <= 0x2b81f) ||
	(cp >= 0x2b820 && cp <= 0x2ceaf) ||
	(cp >= 0xf900 && cp <= 0xfaff) ||
	(cp >= 0x2f800 && cp <= 0x2fa1f);
const isPunct = (c: string): boolean => {
	const cp = c.codePointAt(0) ?? 0;
	if ((cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126))
		return true;
	return /\p{P}/u.test(c);
};

/** Normalized and split into words and single punctuation marks, as BERT's pre-tokenizer does. */
export const basicTokens = (text: string): string[] => {
	let s = "";
	for (const c of text) {
		const cp = c.codePointAt(0) ?? 0;
		if (cp === 0 || cp === 0xfffd || isControl(c)) continue;
		if (isWhite(c)) s += " ";
		else if (isCjk(cp)) s += ` ${c} `;
		else s += c;
	}
	// Accents stripped (decomposed, combining marks dropped), then lower case.
	s = s
		.normalize("NFD")
		.replace(/\p{Mn}/gu, "")
		.toLowerCase();
	const out: string[] = [];
	for (const word of s.split(" ")) {
		if (!word) continue;
		let cur = "";
		for (const c of word) {
			if (isPunct(c)) {
				if (cur) out.push(cur);
				out.push(c);
				cur = "";
			} else cur += c;
		}
		if (cur) out.push(cur);
	}
	return out;
};

/** A word's pieces, longest first ("##" inside a word); the whole word is unknown if any part is. */
export const wordPiece = (word: string, vocab: ReadonlyMap<string, number>, unk: number, maxChars = 100): number[] => {
	const chars = [...word];
	if (chars.length > maxChars) return [unk];
	const out: number[] = [];
	let start = 0;
	while (start < chars.length) {
		let end = chars.length;
		let id: number | undefined;
		while (start < end) {
			const piece = (start > 0 ? "##" : "") + chars.slice(start, end).join("");
			id = vocab.get(piece);
			if (id !== undefined) break;
			end--;
		}
		if (id === undefined) return [unk];
		out.push(id);
		start = end;
	}
	return out;
};

/** The text's token ids (no special tokens), at most `limit`. */
export const tokenize = (text: string, vocab: ReadonlyMap<string, number>, unk: number, limit = Infinity): number[] => {
	const out: number[] = [];
	for (const w of basicTokens(text)) {
		for (const id of wordPiece(w, vocab, unk)) {
			out.push(id);
			if (out.length >= limit) return out;
		}
	}
	return out;
};
