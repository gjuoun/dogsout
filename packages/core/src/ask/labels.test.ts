import { describe, expect, test } from "bun:test";
import { grantStatusLabel } from "./labels.ts";

const NOW = new Date("2026-10-22T12:00:00Z");

function grant(over: Partial<Parameters<typeof grantStatusLabel>[0]> = {}) {
	return { ttl: "10m" as const, expires_at: "2026-10-22T12:10:00Z", session: undefined, consumed: false, ...over };
}

describe("grantStatusLabel (mockup wording)", () => {
	test("session-bound grants read as session", () => {
		expect(grantStatusLabel(grant({ session: "sess_1", expires_at: null }), NOW)).toBe("session");
	});

	test("always-tier grants show the 30d decay wording", () => {
		expect(grantStatusLabel(grant({ ttl: "always", expires_at: "2026-11-21T12:00:00Z" }), NOW)).toBe("长期·30d衰减");
	});

	test("once-tier grants say whether they were used", () => {
		expect(grantStatusLabel(grant({ ttl: "once" }), NOW)).toBe("本次·未使用");
		expect(grantStatusLabel(grant({ ttl: "once", consumed: true }), NOW)).toBe("本次·已用完");
	});

	test("timed grants count down, and expired says so", () => {
		expect(grantStatusLabel(grant(), NOW)).toBe("剩 10m");
		expect(grantStatusLabel(grant({ expires_at: "2026-10-23T12:00:00Z" }), NOW)).toBe("剩 24h");
		expect(grantStatusLabel(grant({ expires_at: "2026-10-25T12:00:00Z" }), NOW)).toBe("剩 3d");
		expect(grantStatusLabel(grant({ expires_at: "2026-10-22T11:00:00Z" }), NOW)).toBe("expired");
	});
});
