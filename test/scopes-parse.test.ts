import { describe, expect, it } from "vitest";
import type { Mode, Scope } from "../src/scopes/model";
import { parseScope } from "../src/scopes/parse";

const scope = (id: string, name: string, aliases: string[] = [], mode: Mode = "suggest", kind = ""): Scope => ({
	id,
	name,
	aliases,
	kind,
	rules: [{ kind: "folder", path: name }],
	combine: "any",
	mode,
	source: "manual",
});

const SCOPES = [
	scope("cobalt", "Cobalt", ["cob"]),
	scope("amb", "AMB"),
	scope("amber-studio-p", "Amber Studio", [], "suggest", "Projects"),
	scope("amber-studio-a", "Amber Studio", [], "suggest", "Areas"),
	scope("team", "Team", [], "in-only"),
	scope("auto", "Hazel", [], "auto"),
	scope("cafe", "Café Crème"),
];

const ids = (xs?: readonly Scope[]): string[] => (xs ?? []).map((s) => s.id);

describe("typing a scope", () => {
	it("a name at the start, a space and more text: a suggestion, the results unscoped", () => {
		const p = parseScope("Cobalt garden plan", SCOPES);
		expect(ids(p.suggest?.scopes)).toEqual(["cobalt"]);
		expect(p.suggest?.name).toBe("Cobalt");
		expect(p.suggest?.rest).toBe("garden plan");
		expect(p.suggest?.at).toBe(0);
		expect(p.applied).toBeUndefined();
		expect(p.text).toBe("Cobalt garden plan");
	});

	it("matches case, accents and aliases loosely", () => {
		expect(ids(parseScope("cobalt world", SCOPES).suggest?.scopes)).toEqual(["cobalt"]);
		expect(ids(parseScope("cob world", SCOPES).suggest?.scopes)).toEqual(["cobalt"]);
		expect(ids(parseScope("cafe creme recipes", SCOPES).suggest?.scopes)).toEqual(["cafe"]);
	});

	it("multi-word names match longest first, and every scope of that name is listed", () => {
		const p = parseScope("Amber Studio plugin", SCOPES);
		expect(ids(p.suggest?.scopes)).toEqual(["amber-studio-p", "amber-studio-a"]);
		expect(p.suggest?.rest).toBe("plugin");
		expect(ids(parseScope("AMB plugin", SCOPES).suggest?.scopes)).toEqual(["amb"]);
	});

	it("a name alone is a normal search with a hint; so is a name and a space", () => {
		for (const t of ["Cobalt", "Cobalt ", " cobalt"]) {
			const p = parseScope(t, SCOPES);
			expect(p.suggest).toBeUndefined();
			expect(p.hint?.id).toBe("cobalt");
		}
	});

	it("a quoted word is never a scope; nor is a name inside a longer word", () => {
		expect(parseScope('"Cobalt" world', SCOPES).suggest).toBeUndefined();
		expect(parseScope('world "two Cobalt" state', SCOPES).suggest).toBeUndefined();
		expect(parseScope("Cobalts world", SCOPES).suggest).toBeUndefined();
	});

	it("a name anywhere in the text: in the middle or at the end, the rest without it", () => {
		const mid = parseScope("sandbox cobalt mustard", SCOPES);
		expect(ids(mid.suggest?.scopes)).toEqual(["cobalt"]);
		expect(mid.suggest).toMatchObject({ name: "cobalt", rest: "sandbox mustard", at: 8 });
		const end = parseScope("sandbox mustard Cobalt", SCOPES);
		expect(end.suggest).toMatchObject({ name: "Cobalt", rest: "sandbox mustard", at: 16 });
		expect(parseScope("plugin for Amber Studio", SCOPES).suggest).toMatchObject({
			name: "Amber Studio",
			rest: "plugin for",
		});
	});

	it("the longest name in the text wins, then the first", () => {
		expect(parseScope("cobalt notes Amber Studio", SCOPES).suggest?.name).toBe("Amber Studio");
		expect(parseScope("cobalt notes amb", SCOPES).suggest?.name).toBe("cobalt");
	});

	it("in: only scopes are never suggested; Auto behaves as Suggest in the parser", () => {
		expect(parseScope("Team offsite", SCOPES).suggest).toBeUndefined();
		expect(parseScope("Team", SCOPES).hint).toBeUndefined();
		expect(ids(parseScope("Hazel launch", SCOPES).suggest?.scopes)).toEqual(["auto"]);
	});

	it("in:name and @name apply anywhere, whatever the mode, and leave the rest as the text", () => {
		const a = parseScope("offsite in:team agenda", SCOPES);
		expect(a.applied?.id).toBe("team");
		expect(a.text).toBe("offsite agenda");
		const b = parseScope("@cobalt garden plan", SCOPES);
		expect(b.applied?.id).toBe("cobalt");
		expect(b.text).toBe("garden plan");
		expect(b.suggest).toBeUndefined();
		expect(b.complete).toBe(true);
	});

	it("an explicit form still being typed is not complete (the modal waits for the space)", () => {
		expect(parseScope("@cob", SCOPES)).toMatchObject({ complete: false, text: "" });
		expect(parseScope("world @cob", SCOPES).complete).toBe(false);
		expect(parseScope('in:"Amber Studio"', SCOPES).complete).toBe(true);
	});

	it("explicit forms take a quoted or joined multi-word name", () => {
		expect(parseScope('in:"Amber Studio" plugin', SCOPES).applied?.id).toBe("amber-studio-p");
		expect(parseScope("@amber-studio plugin", SCOPES).applied?.id).toBe("amber-studio-p");
		expect(parseScope("@amberstudio plugin", SCOPES).text).toBe("plugin");
	});

	it("@ or in: with the start of one scope's name applies it once a space follows (@cob)", () => {
		const p = parseScope("@cobl world", SCOPES);
		expect(p.applied?.id).toBe("cobalt");
		expect(p).toMatchObject({ text: "world", complete: true });
		expect(parseScope("in:haz notes", SCOPES).applied?.id).toBe("auto");
		expect(parseScope("@caf menu", SCOPES).applied?.id).toBe("cafe");
		// Still being typed: not yet.
		expect(parseScope("@cobl", SCOPES).complete).toBe(false);
		// The start of several names (AMB, Amber Studio ×2): nothing applies.
		expect(parseScope("@am plugin", SCOPES).applied).toBeUndefined();
		// An exact name wins over longer names that start with it.
		expect(parseScope("@amb plugin", SCOPES).applied?.id).toBe("amb");
	});

	it("an unknown explicit name, an email or a mid-word @ stay text", () => {
		expect(parseScope("in:nowhere world", SCOPES)).toEqual({ text: "in:nowhere world" });
		expect(parseScope("mail ana@cobalt.example", SCOPES)).toEqual({ text: "mail ana@cobalt.example" });
	});

	it("no scopes, or empty text: nothing", () => {
		expect(parseScope("Cobalt world", [])).toEqual({ text: "Cobalt world" });
		expect(parseScope("", SCOPES)).toEqual({ text: "" });
	});

	it("a scope renamed in place (settings) is typed by its new name", () => {
		const list = [scope("x", "Garden")];
		expect(parseScope("Garden beds", list).suggest).toBeDefined();
		(list[0] as Scope).name = "Allotment";
		expect(parseScope("Garden beds", list).suggest).toBeUndefined();
		expect(parseScope("Allotment beds", list).suggest?.rest).toBe("beds");
	});
});
