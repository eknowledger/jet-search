import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const build = (env: Record<string, string> = {}): string => {
	execFileSync(process.execPath, ["esbuild.config.mjs", "production"], {
		env: { ...process.env, ...env },
		stdio: "ignore",
	});
	return createHash("sha256").update(readFileSync("main.js")).digest("hex");
};

describe("production build", () => {
	it("gives the same main.js every time, so a release can be rebuilt and compared", () => {
		const first = build();
		const second = build();
		expect(second).toBe(first);
	}, 120_000);

	it("lets a lab build name itself, so a running build can be told from an older one", () => {
		const plain = build();
		const named = build({ JET_BUILD_ID: "jetbuild-lab-test" });
		expect(named).not.toBe(plain);
		expect(readFileSync("main.js", "utf8")).toContain("jetbuild-lab-test");
	}, 120_000);
});
