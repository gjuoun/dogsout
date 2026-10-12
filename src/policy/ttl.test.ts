import { describe, expect, test } from "bun:test";
import { expiryFor, parseDuration, ttlToMs } from "./ttl.ts";

describe("ttl tiers", () => {
	test("fixed tiers map to exact milliseconds", () => {
		expect(ttlToMs("once", { always_decay: "720h" })).toBe(0);
		expect(ttlToMs("10m", { always_decay: "720h" })).toBe(600_000);
		expect(ttlToMs("1h", { always_decay: "720h" })).toBe(3_600_000);
		expect(ttlToMs("24h", { always_decay: "720h" })).toBe(86_400_000);
		expect(ttlToMs("30d", { always_decay: "720h" })).toBe(30 * 86_400_000);
	});

	test("always uses the always_decay horizon (fixed 30d expiry ruling)", () => {
		expect(ttlToMs("always", { always_decay: "720h" })).toBe(30 * 86_400_000);
		expect(ttlToMs("always", { always_decay: "48h" })).toBe(48 * 3_600_000);
	});

	test("session tier has no clock expiry", () => {
		expect(ttlToMs("session", { always_decay: "720h" })).toBe(null);
		expect(expiryFor("session", new Date(0), { always_decay: "720h" })).toBe(null);
	});

	test("duration parsing accepts s/m/h/d, rejects junk", () => {
		expect(parseDuration("90s")).toBe(90_000);
		expect(parseDuration("10m")).toBe(600_000);
		expect(parseDuration("1.5h")).toBe(5_400_000);
		expect(parseDuration("30d")).toBe(30 * 86_400_000);
		expect(parseDuration("forever")).toBe(null);
		expect(parseDuration("-5m")).toBe(null);
	});

	test("expiry stamps are absolute ISO instants", () => {
		const at = new Date("2026-10-10T12:00:00.000Z");
		expect(expiryFor("1h", at, { always_decay: "720h" })).toBe("2026-10-10T13:00:00.000Z");
	});
});
