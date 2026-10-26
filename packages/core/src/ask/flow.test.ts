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
import { prepareRun, sha256Hex } from "./flow.ts";
import { HELPER_ENV, mygoChannel } from "./mygo.ts";

const ADDRESS = "dogsout://dev/zai/api_key";
const ALIAS = "ZAI_API_KEY";
let home = "";
let fakeHelper = "";

/** Seed a field the way `dogsout set` does, minus the CLI layer (store primitives only). */
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

/** Register an alias the way `dogsout alias` does, and drop the default rules for this home. */
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
	home = mkdtempSync(join(tmpdir(), "dogsout-ask-"));
	process.env.DOGSOUT_HOME = home;
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
	delete process.env.DOGSOUT_HOME;
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

	test("mygo channel end-to-end with the fake helper binary", async () => {
		process.env[HELPER_ENV] = fakeHelper;
		const r = await prepareRun({
			home,
			cfg: await cfg(),
			data: await open(),
			principal: "tester@unit",
			groups: [],
			names: [ALIAS],
			channels: [mygoChannel],
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
			channels: [mygoChannel],
			askBudgetMs: 10_000,
		});
		delete process.env[HELPER_ENV];
		delete process.env.FAKE_APPROVE_MODE;
		expect(r.isErr()).toBe(true);
	});
});
describe("ask flow with 1password references", () => {
	const REF = "op://dev/api_key/refkey";
	const REF_ADDR = "dogsout://op/dev/ref_key";

	/** A resolver that records every batch, so "zero reads" is a count, not a claim. */
	function counting(values: Record<string, string>) {
		const batches: string[][] = [];
		return {
			batches,
			resolver: {
				async resolve(refs: readonly string[]) {
					batches.push([...refs]);
					const out = new Map<string, string>();
					for (const ref of refs) {
						const v = values[ref];
						if (v === undefined) return err({ kind: "resolve" as const, ref, message: "no value" });
						out.set(ref, v);
					}
					return ok(out);
				},
			},
		};
	}

	async function seedRefs(
		entries: Record<string, string>,
		rules: Array<{ id: string; decide: "allow" | "ask" | "deny" }> = [],
	) {
		const c = await cfg();
		c.refs = { ...c.refs, ...entries };
		c.rules = rules.map((r) => ({ principal: "*", resource: "*", ...r }));
		const w = await writeConfig(home, c);
		if (w.isErr()) throw new Error(w.error);
	}

	async function clearGrants() {
		const { rmSync } = await import("node:fs");
		rmSync(join(home, "grants.json"), { force: true });
	}

	test("a first-time ask costs zero 1Password reads, then records the resolved hash", async () => {
		await clearGrants();
		await seedRefs({ [REF_ADDR]: REF });
		const fake = counting({ [REF]: "resolved-secret-1" });
		const first = await prepareRun({
			home,
			cfg: await cfg(),
			data: undefined,
			resolver: fake.resolver,
			principal: "ref@unit",
			groups: [],
			names: [REF_ADDR],
			channels: [approveAll],
			askBudgetMs: 5000,
		});
		expect(first.isOk()).toBe(true);
		expect(fake.batches.length).toBe(1); // after approval only
		expect(fake.batches[0]).toEqual([REF]);
		if (first.isOk()) expect(first.value.inject[REF_ADDR]).toBe("resolved-secret-1");

		const grants = await loadGrants(home);
		const granted = grants.isOk()
			? grants.value.grants.find((g) => g.principal === "ref@unit" && g.alias === REF_ADDR)
			: undefined;
		expect(granted?.value_hash).toBe(await sha256Hex("resolved-secret-1"));
	});

	test("an allow rule reads a batch without a window, deduped across keys", async () => {
		await clearGrants();
		await seedRefs(
			{ [REF_ADDR]: REF, "dogsout://op/dev/ref_two": REF, "dogsout://op/dev/ref_three": "op://dev/api_key/other" },
			[{ id: "allow-refs", decide: "allow" }],
		);
		const fake = counting({ [REF]: "same", "op://dev/api_key/other": "other" });
		const r = await prepareRun({
			home,
			cfg: await cfg(),
			data: undefined,
			resolver: fake.resolver,
			principal: "ref@unit",
			groups: [],
			names: [REF_ADDR, "dogsout://op/dev/ref_two", "dogsout://op/dev/ref_three"],
			channels: [],
			askBudgetMs: 1000,
		});
		expect(r.isOk()).toBe(true);
		expect(fake.batches.length).toBe(1);
		expect(fake.batches[0]).toEqual([REF, "op://dev/api_key/other"]);
		if (r.isOk()) {
			expect(r.value.inject[REF_ADDR]).toBe("same");
			expect(r.value.inject["dogsout://op/dev/ref_three"]).toBe("other");
		}
	});

	test("a rotated upstream value invalidates the grant and re-asks", async () => {
		await clearGrants();
		await seedRefs({ [REF_ADDR]: REF });
		const stale = await prepareRun({
			home,
			cfg: await cfg(),
			data: undefined,
			resolver: counting({ [REF]: "old-value" }).resolver,
			principal: "ref@unit",
			groups: [],
			names: [REF_ADDR],
			channels: [approveAll],
			askBudgetMs: 5000,
		});
		expect(stale.isOk()).toBe(true);

		const fake = counting({ [REF]: "new-value" });
		const rotated = await prepareRun({
			home,
			cfg: await cfg(),
			data: undefined,
			resolver: fake.resolver,
			principal: "ref@unit",
			groups: [],
			names: [REF_ADDR],
			channels: [approveAll],
			askBudgetMs: 5000,
		});
		expect(rotated.isOk()).toBe(true);
		if (rotated.isOk()) expect(rotated.value.asked).toEqual([REF_ADDR]);
	});

	test("a missing token fails closed with 0 names injected", async () => {
		await clearGrants();
		await seedRefs({ [REF_ADDR]: REF });
		const denied = {
			async resolve() {
				return err({
					kind: "missing-token" as const,
					message: "no service account token (OP_SERVICE_ACCOUNT_TOKEN unset and ~/.config/op/sa-token unreadable)",
				});
			},
		};
		const r = await prepareRun({
			home,
			cfg: await cfg(),
			data: undefined,
			resolver: denied,
			principal: "ref@unit",
			groups: [],
			names: [REF_ADDR],
			channels: [approveAll],
			askBudgetMs: 5000,
		});
		expect(r.isErr()).toBe(true);
		if (r.isErr()) {
			expect(r.error).toContain("OP_SERVICE_ACCOUNT_TOKEN");
			expect(r.error).toContain("sa-token");
		}
	});

	test("a vault address without opened data is a typed error", async () => {
		const r = await prepareRun({
			home,
			cfg: await cfg(),
			data: undefined,
			resolver: counting({}).resolver,
			principal: "ref@unit",
			groups: [],
			names: [ALIAS],
			channels: [],
			askBudgetMs: 1000,
		});
		expect(r.isErr()).toBe(true);
		if (r.isErr()) expect(r.error).toContain("vault not opened");
	});

	test("a reference with no resolver is a typed error", async () => {
		await seedRefs({ "dogsout://op/dev/no_resolver": "op://dev/api_key/none" }, [{ id: "allow", decide: "allow" }]);
		const r = await prepareRun({
			home,
			cfg: await cfg(),
			data: undefined,
			principal: "ref@unit",
			groups: [],
			names: ["dogsout://op/dev/no_resolver"],
			channels: [],
			askBudgetMs: 1000,
		});
		expect(r.isErr()).toBe(true);
		if (r.isErr()) expect(r.error).toContain("no resolver configured");
	});
});
