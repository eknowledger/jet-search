import { describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";
import type { Scope } from "../src/scopes/model";
import { ScopeKeeper } from "../src/scopes/keeper";
import type { Request } from "../src/worker/protocol";

const scope = (id: string, rules: Scope["rules"]): Scope => ({
	id,
	name: id,
	aliases: [],
	kind: "",
	rules,
	combine: "any",
	mode: "suggest",
	source: "manual",
});

const setup = () => {
	const app = new App();
	const files = (app.vault as unknown as { files: Map<string, TFile> }).files;
	const caches = (app.metadataCache as unknown as { caches: Map<string, unknown> }).caches;
	const add = (path: string, cache: unknown = {}) => {
		files.set(path, new TFile(path));
		caches.set(path, cache);
	};
	add("Projects/Garden/Plan.md");
	add("Daily/a.md", { tags: [{ tag: "#garden" }] });
	add("Other.md");
	const sent: Request[] = [];
	const client = { running: true, call: (r: Request) => (sent.push(r), Promise.resolve({ notes: 0 })) };
	const scopes = [
		scope("folder", [{ kind: "folder", path: "Projects/Garden" }]),
		scope("tag", [{ kind: "tag", tag: "#garden" }]),
	];
	const keeper = new ScopeKeeper(app as never, client as never, () => scopes);
	return { app, files, caches, add, sent, keeper, scopes };
};

describe("keeping scope members", () => {
	it("counts members in one pass and sends each set to the worker", () => {
		const { keeper, sent } = setup();
		keeper.ensure();
		expect(keeper.count("folder")).toBe(1);
		expect(keeper.count("tag")).toBe(1);
		expect(sent.filter((r) => r.op === "scope:set").map((r) => (r as { id: string }).id)).toEqual([
			"folder",
			"tag",
		]);
	});

	it("rechecks one note when it changes and sends only the difference", () => {
		const { keeper, sent, caches } = setup();
		keeper.ensure();
		sent.length = 0;
		caches.set("Other.md", { tags: [{ tag: "#garden/beds" }] });
		keeper.changed(new TFile("Other.md") as never);
		expect(keeper.count("tag")).toBe(2);
		expect(sent).toEqual([{ op: "scope:delta", id: "tag", add: ["Other.md"], remove: [] }]);
		keeper.changed(new TFile("Other.md") as never);
		expect(sent).toHaveLength(1);
	});

	it("moves members on rename (a folder rule may stop matching) and drops them on delete", () => {
		const { keeper, sent, files } = setup();
		keeper.ensure();
		sent.length = 0;
		files.delete("Projects/Garden/Plan.md");
		files.set("Archive/Plan.md", new TFile("Archive/Plan.md"));
		keeper.renamed(new TFile("Archive/Plan.md") as never, "Projects/Garden/Plan.md");
		expect(keeper.count("folder")).toBe(0);
		// The worker renames its own sets; the keeper sends what the new path changed.
		expect(sent).toEqual([{ op: "scope:delta", id: "folder", add: [], remove: ["Archive/Plan.md"] }]);
		keeper.deleted("Daily/a.md");
		expect(keeper.count("tag")).toBe(0);
	});

	it("sends every set again after the worker restarts, and starts over when the scopes change", () => {
		const { keeper, sent, scopes } = setup();
		keeper.ensure();
		sent.length = 0;
		keeper.resend();
		expect(sent.map((r) => r.op)).toEqual(["scope:clear", "scope:set", "scope:set"]);
		sent.length = 0;
		scopes.pop();
		keeper.reset();
		keeper.ensure();
		expect(keeper.count("tag")).toBe(0);
		expect(sent.map((r) => r.op)).toEqual(["scope:clear", "scope:set"]);
	});

	it("does nothing before the first pass, and nothing with the worker asleep", () => {
		const { keeper, sent } = setup();
		keeper.changed(new TFile("Other.md") as never);
		expect(sent).toEqual([]);
		expect(keeper.count("folder")).toBe(0);
	});
});
