import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok } from "neverthrow";
import { type Io, runAlias, runInit, runSet } from "../cli/cmd-crud.ts";
import { loadConfig, writeConfig } from "../cli/store.ts";
import { loadGrants } from "../session/grants.ts";
import type { Channel } from "./channel.ts";
import { prepareRun } from "./flow.ts";
import { HELPER_ENV, swiftuiChannel } from "./swiftui.ts";

const MASTER = "ask-flow-master";
const stdinOf = (v: string): Io => ({ stdin: async () => v, stdout: () => {} });
let home = "";
let fakeHelper = "";

const approveAll: Channel = {
	name: "fake",
	async available() {
		return true;
	},
	async ask(request) {
		const keys: Record<string, "ttl"> = {};
		for (const k of request.keys) keys[k.alias] = "ttl";
		return ok({ decision: "approve", ttl: "10m", renew_existing: false, keys });
	},
};

const denyAll: Channel = {
	name: "fake-deny",
	async available() {
		return true;
	},
	async ask() {
		return ok({ decision: "deny" });
	},
};

const broken: Channel = {
	name: "fake-broken",
	async available() {
		return true;
	},
	async ask() {
		return err("no human at the wheel");
	},
};

beforeAll(async () => {
	home = mkdtempSync(join(tmpdir(), "jtk-ask-"));
	process.env.JTK_HOME = home;
	process.env.JTK_MASTER = MASTER;
	await runInit([], stdinOf(""));
	await runSet(["jtk://dev/zai/api_key", "--stdin"], stdinOf("sk-ask-me"));
	await runAlias(["ZAI_API_KEY", "jtk://dev/zai/api_key"]);
	const cfg = await loadConfig(home);
	if (cfg.isErr()) throw new Error(cfg.error);
	cfg.value.rules = [];
	const w = await writeConfig(home, cfg.value);
	if (w.isErr()) throw new Error(w.error);

	fakeHelper = join(home, "fake-approve.ts");
	await Bun.write(fakeHelper, await Bun.file("src/ask/helper/fake-approve.ts").text());
	const { chmodSync } = await import("node:fs");
	chmodSync(fakeHelper, 0o755);
});

afterAll(() => {
	delete process.env.JTK_HOME;
	delete process.env.JTK_MASTER;
	delete process.env[HELPER_ENV];
	delete process.env.FAKE_APPROVE_MODE;
	rmSync(home, { recursive: true, force: true });
});

async function open() {
	const { openDataOnce, ctxFromEnv } = await import("../cli/cmd-crud.ts");
	const ctx = ctxFromEnv();
	if (ctx.isErr()) throw new Error(ctx.error);
	const opened = await openDataOnce(ctx.value);
	if (opened.isErr()) throw new Error(opened.error);
	return opened.value.data;
}

async function cfg() {
	const c = await loadConfig(home);
	if (c.isErr()) throw new Error(c.error);
	return c.value;
}

describe("ask flow (policy -> channel -> grant)", () => {
	test("default ask goes to the channel, approval records a grant, second run is silent", async () => {
		const first = await prepareRun({
			home,
			cfg: await cfg(),
			data: await open(),
			principal: "tester@unit",
			groups: [],
			names: ["ZAI_API_KEY"],
			channels: [approveAll],
			askBudgetMs: 5000,
		});
		expect(first.isOk()).toBe(true);
		if (first.isOk()) {
			expect(first.value.inject.ZAI_API_KEY).toBe("sk-ask-me");
			expect(first.value.asked).toEqual(["ZAI_API_KEY"]);
		}
		const grants = await loadGrants(home);
		expect(grants.isOk() && grants.value.grants.some((g) => g.alias === "ZAI_API_KEY")).toBe(true);

		const second = await prepareRun({
			home,
			cfg: await cfg(),
			data: await open(),
			principal: "tester@unit",
			groups: [],
			names: ["ZAI_API_KEY"],
			channels: [broken], // would fail loudly if asked again
			askBudgetMs: 5000,
		});
		expect(second.isOk()).toBe(true);
		if (second.isOk()) expect(second.value.asked).toEqual([]);
	});

	test("approver deny is fail-closed for the whole run", async () => {
		const r = await prepareRun({
			home,
			cfg: await cfg(),
			data: await open(),
			principal: "tester-deny@unit",
			groups: [],
			names: ["ZAI_API_KEY"],
			channels: [denyAll],
			askBudgetMs: 5000,
		});
		expect(r.isErr()).toBe(true);
		if (r.isErr()) expect(r.error).toContain("denied");
	});

	test("no channel deciding is fail-closed", async () => {
		const r = await prepareRun({
			home,
			cfg: await cfg(),
			data: await open(),
			principal: "tester-broken@unit",
			groups: [],
			names: ["ZAI_API_KEY"],
			channels: [broken],
			askBudgetMs: 100,
		});
		expect(r.isErr()).toBe(true);
		if (r.isErr()) expect(r.error).toContain("fail-closed");
	});

	test("value rotation invalidates the grant and re-asks", async () => {
		await runSet(["jtk://dev/zai/api_key", "--stdin"], stdinOf("sk-rotated"));
		const r = await prepareRun({
			home,
			cfg: await cfg(),
			data: await open(),
			principal: "tester@unit",
			groups: [],
			names: ["ZAI_API_KEY"],
			channels: [approveAll],
			askBudgetMs: 5000,
		});
		expect(r.isOk()).toBe(true);
		if (r.isOk()) expect(r.value.inject.ZAI_API_KEY).toBe("sk-rotated");
	});

	test("swiftui channel end-to-end with the fake helper binary", async () => {
		process.env[HELPER_ENV] = fakeHelper;
		const r = await prepareRun({
			home,
			cfg: await cfg(),
			data: await open(),
			principal: "tester@unit",
			groups: [],
			names: ["ZAI_API_KEY"],
			channels: [swiftuiChannel],
			askBudgetMs: 10_000,
		});
		delete process.env[HELPER_ENV];
		expect(r.isOk()).toBe(true);
	});

	test("helper crash degrades fail-closed", async () => {
		process.env[HELPER_ENV] = fakeHelper;
		process.env.FAKE_APPROVE_MODE = "crash";
		const r = await prepareRun({
			home,
			cfg: await cfg(),
			data: await open(),
			principal: "tester-crash@unit",
			groups: [],
			names: ["ZAI_API_KEY"],
			channels: [swiftuiChannel],
			askBudgetMs: 10_000,
		});
		delete process.env[HELPER_ENV];
		delete process.env.FAKE_APPROVE_MODE;
		expect(r.isErr()).toBe(true);
	});
});
