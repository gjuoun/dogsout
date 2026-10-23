import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ApprovalPanel } from "./ApprovalPanel.tsx";
import { approvedCount, type Choice, DEFAULT_UI_TIER, decisionFor } from "./model.ts";

/** The reference decision: the mygo helper (apps/ask) --selftest prints exactly this. */
const REFERENCE =
	'{"decision":"approve","ttl":"10m","renew_existing":false,"keys":{"gh":"ttl","openai":"once","aws":"deny"}}';

const REQUEST = {
	principal: "claude-code@laptop",
	session: "sess_9f2ac31e",
	at: "2026-10-09T21:14:00Z",
	keys: [
		{ alias: "gh", address: "dogsout://dev/gh/pat", note: "github.com PAT · repo read", value_hash: "aa11" },
		{ alias: "openai", address: "dogsout://dev/openai/key", note: "api.openai.com · env", value_hash: "bb22" },
		{ alias: "aws", address: "dogsout://staging/aws/secret", note: "sts staging · env", value_hash: "cc33" },
	],
	granted: [
		{ alias: "hf", status: "剩 47m" },
		{ alias: "gemini", status: "长期·30d衰减" },
		{ alias: "speedtest", status: "本地规则放行·不询问" },
	],
};

function render(props: Partial<Parameters<typeof ApprovalPanel>[0]> = {}) {
	return renderToStaticMarkup(
		<ApprovalPanel
			request={REQUEST}
			choices={{ gh: "approve", openai: "approve", aws: "approve" }}
			tier={DEFAULT_UI_TIER}
			onChoice={() => undefined}
			onTier={() => undefined}
			onApprove={() => undefined}
			onDeny={() => undefined}
			{...props}
		/>,
	);
}

describe("approval decision area (mockup parity)", () => {
	test("defaults: every key 批准, tier 10m, 3 approved", () => {
		const choices = { gh: "approve", openai: "approve", aws: "approve" } as Record<string, Choice>;
		expect(DEFAULT_UI_TIER).toBe("10m");
		expect(approvedCount(REQUEST, choices)).toBe(3);
	});

	test("produces the native helper's selftest JSON byte for byte", () => {
		const choices = { gh: "approve", openai: "once", aws: "deny" } as Record<string, Choice>;
		expect(JSON.stringify(decisionFor(REQUEST, choices, "10m"))).toBe(REFERENCE);
	});

	test("the 本次 tier turns approvals into once (no grant recorded)", () => {
		const choices = { gh: "approve", openai: "approve", aws: "approve" } as Record<string, Choice>;
		const decision = decisionFor(REQUEST, choices, "once");
		expect(decision).toEqual({
			decision: "approve",
			ttl: "once",
			renew_existing: false,
			keys: { gh: "once", openai: "once", aws: "once" },
		});
	});

	test("everything denied is a bare deny — no key map, no ttl", () => {
		const choices = { gh: "deny", openai: "deny", aws: "deny" } as Record<string, Choice>;
		expect(decisionFor(REQUEST, choices, "10m")).toEqual({ decision: "deny" });
	});
});

describe("approval panel markup", () => {
	test("three per-key pickers plus one TTL picker, six tiers", () => {
		const html = render();
		expect(html.match(/role="radiogroup"/g)?.length).toBe(4);
		// 3 keys × 3 states + 6 TTL tiers
		expect(html.match(/role="radio"/g)?.length).toBe(15);
		for (const label of ["批准", "本次", "拒绝", "10m", "1h", "24h", "30d", "长期"]) {
			expect(html).toContain(label);
		}
	});

	test("the approve button counts what will be granted", () => {
		expect(render()).toContain("批准 3 个");
		expect(render({ choices: { gh: "approve", openai: "deny", aws: "deny" } as Record<string, Choice> })).toContain(
			"批准 1 个",
		);
	});

	test("the already-held section is read-only and never a control", () => {
		const html = render();
		const granted = html.slice(html.indexOf('data-testid="granted-area"'));
		expect(granted).toContain("gemini");
		expect(granted).toContain("长期·30d衰减");
		expect(granted.includes("<button")).toBe(false);
		expect(granted.includes("<input")).toBe(false);
		expect(granted.includes("<select")).toBe(false);
		expect(granted.includes('role="radio"')).toBe(false);
	});

	test("no authenticator means no approval, and the reason is shown", () => {
		const html = render({ blockedReason: "没有可用的平台认证器 — 用 CLI 或 mygo 通道审批" });
		expect(html).toContain("没有可用的平台认证器");
		expect(html.includes("disabled")).toBe(true);
	});
});
