import { describe, expect, test } from "bun:test";
import { parseEnvFile } from "./io.ts";

describe("parseEnvFile", () => {
	test("classifies literals, dogsout:// refs and op:// skips", () => {
		const plan = parseEnvFile(["A=literal", "B=dogsout://dev/b/f", "C=op://vault/i/f", ""].join("\n"));
		expect(plan.directs.map((d) => d.key)).toEqual(["A"]);
		expect(plan.refs.map((d) => d.key)).toEqual(["B"]);
		expect(plan.skipped.map((d) => d.key)).toEqual(["C"]);
		expect(plan.legacy).toEqual([]);
	});

	// Rename guard: a pre-2026-10-23 address is a stale REF, not a value. Importing it as a
	// literal would store the address string as a secret and mint a second copy.
	test("a stale jtk:// ref is bucketed as legacy, never as a literal", () => {
		const plan = parseEnvFile(["OLD=jtk://dev/zai/api_key", "NEW=dogsout://dev/zai/api_key"].join("\n"));
		expect(plan.legacy.map((d) => d.key)).toEqual(["OLD"]);
		expect(plan.directs).toEqual([]);
		expect(plan.refs.map((d) => d.key)).toEqual(["NEW"]);
	});
});
