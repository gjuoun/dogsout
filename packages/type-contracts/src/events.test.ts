import { describe, expect, test } from "bun:test";
import { parseUiEvent } from "./events.ts";

const ASK = {
	principal: "claude-code@laptop",
	session: "sess_9f2ac31e",
	at: "2026-10-09T21:14:00Z",
	keys: [{ alias: "gh", address: "dogsout://dev/gh/pat", note: "github.com PAT · repo read", value_hash: "aa11" }],
	granted: [{ alias: "hf", status: "剩 47m" }],
};

const AT = "2026-10-09T21:15:00Z";

const FRAMES = [
	{ type: "ask.pending", at: AT, ask: { id: "a_1", at: AT, request: ASK } },
	{
		type: "ask.decided",
		at: AT,
		id: "a_1",
		decision: { decision: "approve", ttl: "10m", renew_existing: false, keys: { gh: "ttl" } },
	},
	{ type: "grant.changed", at: AT, reason: "approval", grants: [{ alias: "gh", status: "剩 10m" }] },
	{ type: "session.changed", at: AT, sessions: [{ id: "sess_1", principal: "claude-code@laptop", opened_at: AT }] },
] as const;

describe("UiEvent contract", () => {
	test("all four frames parse", () => {
		for (const frame of FRAMES) {
			const r = parseUiEvent(frame);
			expect(r.ok).toBe(true);
		}
	});

	test("deny decision frame carries no key map", () => {
		const r = parseUiEvent({ type: "ask.decided", at: AT, id: "a_2", decision: { decision: "deny" } });
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.event.type).toBe("ask.decided");
	});

	test("unknown frame type is rejected", () => {
		const r = parseUiEvent({ type: "ask.exploded", at: AT });
		expect(r.ok).toBe(false);
	});

	test("missing payload field is rejected with a located message", () => {
		const r = parseUiEvent({ type: "grant.changed", at: AT, reason: "approval" });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toContain("grants");
	});

	test("unknown change reason is rejected", () => {
		const r = parseUiEvent({ type: "grant.changed", at: AT, reason: "because", grants: [] });
		expect(r.ok).toBe(false);
	});
});
