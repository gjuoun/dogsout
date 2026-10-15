import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok } from "neverthrow";
import { parseAddress } from "../address.ts";
import { loadGrants } from "../session/grants.ts";
import { initFiles, loadConfig, nowIso, openData, saveData, writeConfig } from "../store.ts";
import { SE_HELPER_ENV } from "../vault/se.ts";
import type { Channel } from "./channel.ts";
import { prepareRun } from "./flow.ts";
import { HELPER_ENV, swiftuiChannel } from "./swiftui.ts";

const ADDRESS = "jtk://dev/zai/api_key";
const ALIAS = "ZAI_API_KEY";
let home = "";
let fakeHelper = "";

/** Seed a field the way `jtk set` does, minus the CLI layer (store primitives only). */
async function seedValue(value: string): Promise<void> {
	const parsed = parseAddress(ADDRESS);
	if (parsed.isErr()) throw new Error(parsed.error);
	const ctx = { home };
	const opened = await openData(ctx);
	if (opened.isErr()) throw new Error(opened.error);
	const { envelope, data } = opened.value;
	const { vault, item, field } = parsed.value;
	data.vaults[vault] ??= {};
	const items = data.vaults[vault];
	if (!items[item]) items[item] = { fields: {}, updated_at: nowIso() };
	items[item].fields[field] = value;
	items[item].updated_at = nowIso();
	const saved = await saveData(ctx, envelope, data);
	if (saved.isErr()) throw new Error(saved.error);
}

/** Register an alias the way `jtk alias` does, and drop the default rules for this home. */
async function seedAlias(): Promise<void> {
	const cfg = await loadConfig(home);
	if (cfg.isErr()) throw new Error(cfg.error);
	cfg.value.aliases[ALIAS] = ADDRESS;
	cfg.value.rules = [];
	const w = await writeConfig(home, cfg.value);
	if (w.isErr()) throw new Error(w.error);
}

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
	process.env[SE_HELPER_ENV] = join(import.meta.dir, "..", "vault", "helper", "fake-se.ts");
	const init = await initFiles(home);
	if (init.isErr()) throw new Error(init.error);
	await seedValue("sk-ask-me");
	await seedAlias();

	fakeHelper = join(home, "fake-approve.ts");
	await Bun.write(fakeHelper, await Bun.file(join(import.meta.dir, "helper", "fake-approve.ts")).text());
	const { chmodSync } = await import("node:fs");
	chmodSync(fakeHelper, 0o755);
});

afterAll(() => {
	delete process.env.JTK_HOME;
	delete process.env[SE_HELPER_ENV];
	delete process.env[HELPER_ENV];
	delete process.env.FAKE_APPROVE_MODE;
	rmSync(home, { recursive: true, force: true });
});

async function open() {
	const opened = await openData({ home });
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
			names: [ALIAS],
			channels: [approveAll],
			askBudgetMs: 5000,
		});
		expect(first.isOk()).toBe(true);
		if (first.isOk()) {
			expect(first.value.inject[ALIAS]).toBe("sk-ask-me");
			expect(first.value.asked).toEqual([ALIAS]);
		}
		const grants = await loadGrants(home);
		expect(grants.isOk() && grants.value.grants.some((g) => g.alias === ALIAS)).toBe(true);

		const second = await prepareRun({
			home,
			cfg: await cfg(),
			data: await open(),
			principal: "tester@unit",
			groups: [],
			names: [ALIAS],
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
			names: [ALIAS],
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
			names: [ALIAS],
			channels: [broken],
			askBudgetMs: 100,
		});
		expect(r.isErr()).toBe(true);
		if (r.isErr()) expect(r.error).toContain("fail-closed");
	});

	test("value rotation invalidates the grant and re-asks", async () => {
		await seedValue("sk-rotated");
		const r = await prepareRun({
			home,
			cfg: await cfg(),
			data: await open(),
			principal: "tester@unit",
			groups: [],
			names: [ALIAS],
			channels: [approveAll],
			askBudgetMs: 5000,
		});
		expect(r.isOk()).toBe(true);
		if (r.isOk()) expect(r.value.inject[ALIAS]).toBe("sk-rotated");
	});

	test("swiftui channel end-to-end with the fake helper binary", async () => {
		process.env[HELPER_ENV] = fakeHelper;
		const r = await prepareRun({
			home,
			cfg: await cfg(),
			data: await open(),
			principal: "tester@unit",
			groups: [],
			names: [ALIAS],
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
			names: [ALIAS],
			channels: [swiftuiChannel],
			askBudgetMs: 10_000,
		});
		delete process.env[HELPER_ENV];
		delete process.env.FAKE_APPROVE_MODE;
		expect(r.isErr()).toBe(true);
	});
});
