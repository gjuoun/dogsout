import { describe, expect, test } from "bun:test";
import {
	getAsks,
	getAsksHistory,
	getHealth,
	postAsk,
	postAsksByIdDecision,
	zAskLogRow,
	zDecision,
	zHealth,
} from "./index.ts";

describe("generated client artifacts", () => {
	test("every route has an sdk operation", () => {
		for (const fn of [getHealth, postAsk, getAsks, postAsksByIdDecision, getAsksHistory]) {
			expect(typeof fn).toBe("function");
		}
	});

	test("zod schemas are usable at runtime (zod 4)", () => {
		expect(zHealth.safeParse({ ok: true, milestone: "F3-preview", webui: "preview" }).success).toBe(true);
		expect(zDecision.safeParse({ decision: "deny" }).success).toBe(true);
		expect(
			zDecision.safeParse({ decision: "approve", ttl: "10m", renew_existing: false, keys: { gh: "ttl" } }).success,
		).toBe(true);
	});

	test("a NULL-able column survives the chain as null (3.1 normalization held)", () => {
		const row = {
			id: "a_1",
			principal: "p",
			session_id: null,
			requested_at: "2026-10-22T10:00:00Z",
			keys_json: "[]",
			key_count: 0,
			decision: "deny",
			ttl: null,
			decided_at: null,
			decided_via: null,
		};
		expect(zAskLogRow.safeParse(row).success).toBe(true);
		expect(zAskLogRow.safeParse({ ...row, session_id: "s" }).success).toBe(true);
	});
});
