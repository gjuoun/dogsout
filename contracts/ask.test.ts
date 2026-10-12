import { describe, expect, test } from "bun:test";
import { AskRequestSchema, parseDecision, TtlTierSchema } from "./ask.ts";

// Reference fixtures: the mockup --selftest decision literals (mockups/jtk-approve.swift).
describe("decision contract (mockup selftest literals)", () => {
	test("approve with per-key map parses", () => {
		const raw = {
			decision: "approve",
			ttl: "10m",
			renew_existing: false,
			keys: { gh: "ttl", openai: "once", aws: "deny" },
		};
		const r = parseDecision(raw);
		expect(r.ok).toBe(true);
	});

	test("bare deny parses and carries no key map", () => {
		const r = parseDecision({ decision: "deny" });
		expect(r.ok).toBe(true);
		if (r.ok && r.decision.decision === "deny") {
			expect("keys" in r.decision).toBe(false);
		}
	});

	test("session tier is valid for manifest grants; seven enum values total", () => {
		expect(TtlTierSchema.safeParse("session").success).toBe(true);
		expect(TtlTierSchema.options.length).toBe(7);
	});

	test("F3 reservation 'keep' is not a valid KeyChoice", () => {
		const r = parseDecision({ decision: "approve", ttl: "10m", renew_existing: false, keys: { a: "keep" } });
		expect(r.ok).toBe(false);
	});
});

describe("ask request contract", () => {
	test("mockup-shaped request parses, granted defaults to empty", () => {
		const raw = {
			principal: "claude-code@laptop",
			session: "sess_9f2ac31e",
			at: "2026-10-09 21:14 EDT",
			keys: [
				{ alias: "gh", address: "jtk://dev/gh/pat", note: "github.com PAT · repo read", value_hash: "sha256:ab12cd34" },
				{ alias: "openai", address: "jtk://dev/openai/api_key", note: "api.openai.com · env", value_hash: "" },
			],
		};
		const r = AskRequestSchema.safeParse(raw);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data.granted).toEqual([]);
	});

	test("empty keys array is rejected — an ask must ask for something", () => {
		const r = AskRequestSchema.safeParse({ principal: "p", session: "s", at: "t", keys: [] });
		expect(r.success).toBe(false);
	});

	test("garbage decision fails with a plain message", () => {
		const r = parseDecision({ decision: "maybe" });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(typeof r.error).toBe("string");
	});
});
