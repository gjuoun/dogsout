import { describe, expect, test } from "bun:test";
import type { GrantMeta } from "../../contracts/grant.ts";
import type { Rule } from "../../contracts/index.ts";
import { evaluate, grantUsable, lastMatchingRule } from "./evaluate.ts";

const NOW = new Date("2026-10-10T12:00:00.000Z");
const base = {
	principal: "claude-code@laptop",
	groups: [] as string[],
	alias: "gh",
	address: "jtk://dev/gh/pat",
	valueHash: "aa11",
	defaultDecision: "ask" as const,
	now: NOW,
};

const rule = (over: Partial<Rule> & { id: string }): Rule => ({
	principal: "*",
	resource: "*",
	decide: "ask",
	...over,
});

const grant = (over: Partial<GrantMeta>): GrantMeta => ({
	id: "g1",
	principal: "claude-code@laptop",
	alias: "gh",
	address: "jtk://dev/gh/pat",
	value_hash: "aa11",
	ttl: "1h",
	approved_via: "swiftui",
	approved_at: "2026-10-10T11:00:00.000Z",
	expires_at: "2026-10-10T13:00:00.000Z",
	consumed: false,
	...over,
});

describe("rule matching (last-match-wins)", () => {
	test("a later specific rule overrides an earlier general match", () => {
		const rules = [
			rule({ id: "r1", resource: "gh", decide: "allow" }),
			rule({ id: "r2", principal: "claude-code@laptop", resource: "gh", decide: "deny" }),
		];
		expect(lastMatchingRule(rules, base)?.id).toBe("r2");
		const v = evaluate({ ...base, rules, grants: [] });
		expect(v.kind).toBe("deny");
		expect(v.via).toBe("rule:r2");
	});

	test("no match falls to default_decision (ask)", () => {
		const v = evaluate({ ...base, rules: [rule({ id: "only", resource: "aws", decide: "allow" })], grants: [] });
		expect(v.kind).toBe("ask");
		expect(v.via).toBe("default");
	});

	test("principal glob matches name or group", () => {
		const rules = [rule({ id: "grp", principal: "cron-*" })];
		expect(lastMatchingRule(rules, { ...base, principal: "cron-nightly@host" })?.id).toBe("grp");
		expect(lastMatchingRule(rules, { ...base, groups: ["cron-jobs"] })?.id).toBe("grp");
		expect(lastMatchingRule(rules, base)).toBeUndefined();
	});

	test("resource glob hits alias or full address", () => {
		const rules = [rule({ id: "vault", resource: "jtk://dev/gh/*" })];
		expect(lastMatchingRule(rules, base)?.id).toBe("vault");
	});
});

describe("precedence", () => {
	test("deny rule beats a usable grant and an allow rule", () => {
		const v = evaluate({
			...base,
			rules: [rule({ id: "allow-all", decide: "allow" }), rule({ id: "no-gh", resource: "gh", decide: "deny" })],
			grants: [grant({})],
		});
		expect(v.kind).toBe("deny");
	});

	test("usable grant allows without re-asking (allow key never pops a window)", () => {
		const v = evaluate({ ...base, rules: [], grants: [grant({})] });
		expect(v.kind).toBe("allow");
		expect(v.via.startsWith("grant:")).toBe(true);
	});

	test("expired or rotated grants fall through to rules/default", () => {
		expect(grantUsable(grant({ expires_at: "2026-10-10T11:59:00.000Z" }), "aa11", [], NOW).ok).toBe(false);
		expect(grantUsable(grant({ value_hash: "bb22" }), "aa11", [], NOW).ok).toBe(false);
		const v = evaluate({ ...base, rules: [], grants: [grant({ value_hash: "bb22" })] });
		expect(v.kind).toBe("ask");
	});

	test("session grant dies when its session is not active", () => {
		const g = grant({ ttl: "session", expires_at: null, session: "sess_1" });
		expect(grantUsable(g, "aa11", ["sess_1"], NOW).ok).toBe(true);
		expect(grantUsable(g, "aa11", [], NOW).ok).toBe(false);
	});

	test("identical input produces an identical verdict (live == simulated)", () => {
		const input = { ...base, rules: [rule({ id: "r", decide: "allow" })], grants: [grant({})] };
		expect(evaluate(input)).toEqual(evaluate(input));
	});
});
