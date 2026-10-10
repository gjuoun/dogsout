import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "../ask/flow.ts";
import { recordApproval } from "../session/grants.ts";
import { type Io, runAlias, runInit, runSet } from "./cmd-crud.ts";
import { runGrants, runPolicy } from "./cmd-policy.ts";

const MASTER = "policy-test-master";
const stdinOf = (v: string): Io => ({ stdin: async () => v, stdout: () => {} });
let home = "";

beforeAll(async () => {
	home = mkdtempSync(join(tmpdir(), "jtk-pol-"));
	process.env.JTK_HOME = home;
	process.env.JTK_MASTER = MASTER;
	await runInit([], stdinOf(""));
	await runSet(["jtk://dev/zai/api_key", "--stdin"], stdinOf("sk-pol"));
	await runAlias(["ZAI_API_KEY", "jtk://dev/zai/api_key"]);
});

afterAll(() => {
	delete process.env.JTK_HOME;
	delete process.env.JTK_MASTER;
	rmSync(home, { recursive: true, force: true });
});

describe("policy simulate/why/test", () => {
	test("simulate defaults to ask with no rules", async () => {
		const r = await runPolicy(["simulate", "--principal", "cron@x", "--alias", "ZAI_API_KEY"]);
		expect(r.isOk()).toBe(true);
		if (r.isOk()) expect(r.value).toContain("ask");
	});

	test("rule add flips simulate to allow; last rule wins", async () => {
		const add = await runPolicy([
			"config",
			"rule",
			"add",
			'{"id":"r1","principal":"cron@x","resource":"*","decide":"allow"}',
		]);
		expect(add.isOk()).toBe(true);
		const sim = await runPolicy(["simulate", "--principal", "cron@x", "--alias", "ZAI_API_KEY"]);
		expect(sim.isOk() && sim.value).toContain("allow");
		const add2 = await runPolicy([
			"config",
			"rule",
			"add",
			'{"id":"r2","principal":"cron@x","resource":"ZAI_*","decide":"deny"}',
		]);
		expect(add2.isOk()).toBe(true);
		const sim2 = await runPolicy(["simulate", "--principal", "cron@x", "--alias", "ZAI_API_KEY"]);
		expect(sim2.isOk() && sim2.value).toContain("deny");
	});

	test("duplicate rule id is rejected, config unchanged", async () => {
		const before = readFileSync(join(home, "config.json"), "utf8");
		const r = await runPolicy(["config", "rule", "add", '{"id":"r1","principal":"*","resource":"*","decide":"ask"}']);
		expect(r.isErr()).toBe(true);
		expect(readFileSync(join(home, "config.json"), "utf8")).toBe(before);
	});

	test("why shows the live grant with remaining ttl", async () => {
		await recordApproval(
			home,
			{
				principal: "cron@y",
				alias: "ZAI_API_KEY",
				address: "jtk://dev/zai/api_key",
				valueHash: await sha256Hex("sk-pol"),
				ttl: "1h",
				via: "cli",
			},
			{ always_decay: "720h" },
		);
		const r = await runPolicy(["why", "--alias", "ZAI_API_KEY", "--principal", "cron@y"]);
		expect(r.isOk()).toBe(true);
		if (r.isOk()) {
			expect(r.value).toContain("allow");
			expect(r.value).toContain("grant");
		}
	});

	test("policy test fixtures: pass and fail loudly", async () => {
		const cases = join(home, "cases.json");
		await Bun.write(
			cases,
			JSON.stringify({
				cases: [
					{ principal: "cron@x", alias: "ZAI_API_KEY", expect: "deny" },
					{ principal: "stranger@x", alias: "ZAI_API_KEY", expect: "ask" },
				],
			}),
		);
		const pass = await runPolicy(["test", cases]);
		expect(pass.isOk()).toBe(true);

		await Bun.write(cases, JSON.stringify({ cases: [{ principal: "cron@x", alias: "ZAI_API_KEY", expect: "allow" }] }));
		const fail = await runPolicy(["test", cases]);
		expect(fail.isErr()).toBe(true);
		if (fail.isErr()) expect(fail.error).toContain("expected allow, got deny");
	});
});

describe("policy config + grants", () => {
	test("set validates values; invalid leaves the file byte-identical", async () => {
		const before = readFileSync(join(home, "config.json"), "utf8");
		const bad = await runPolicy(["config", "set", "default_decision", "sometimes"]);
		expect(bad.isErr()).toBe(true);
		expect(readFileSync(join(home, "config.json"), "utf8")).toBe(before);
		const badTtl = await runPolicy(["config", "set", "always_decay", "forever"]);
		expect(badTtl.isErr()).toBe(true);

		const good = await runPolicy(["config", "set", "always_decay", "1440h"]);
		expect(good.isOk()).toBe(true);
	});

	test("principal add/rm round-trips", async () => {
		const add = await runPolicy(["config", "principal", "add", '{"name":"nightly","kind":"agent","group":"cron"}']);
		expect(add.isOk()).toBe(true);
		const dup = await runPolicy(["config", "principal", "add", '{"name":"nightly"}']);
		expect(dup.isErr()).toBe(true);
		const rm = await runPolicy(["config", "principal", "rm", "nightly"]);
		expect(rm.isOk()).toBe(true);
	});

	test("grants ls lists live metadata; rm revokes and re-asks", async () => {
		const ls = await runGrants(["ls", "--principal", "cron@y"]);
		expect(ls.isOk() && ls.value).toContain("ZAI_API_KEY");
		const rm = await runGrants(["rm", "ZAI_API_KEY", "--principal", "cron@y"]);
		expect(rm.isOk() && rm.value).toContain("revoked");
		const after = await runGrants(["ls", "--principal", "cron@y"]);
		expect(after.isOk() && after.value).toContain("(no live grants)");
	});
});
