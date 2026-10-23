import { describe, expect, test } from "bun:test";
import {
	formatAddress,
	groupViolations,
	parseAddress,
	parseAddressStrict,
	parseItemRef,
	scanAddress,
} from "./address.ts";

const strict = (input: string) => parseAddressStrict(input);

describe("address segment charset [a-z0-9_-] (write path)", () => {
	test("accepts lowercase letters, digits, underscore and dash in every segment", () => {
		const a = strict("dogsout://dev-2/gh_main/pat-1.v2");
		if (a.isErr()) throw new Error(a.error);
		expect(a.value).toEqual({ vault: "dev-2", item: "gh_main", field: "pat-1", subpath: ["v2"] });
		expect(formatAddress(a.value)).toBe("dogsout://dev-2/gh_main/pat-1.v2");
	});

	test("rejects an uppercase field and names the offending segment", () => {
		const r = strict("dogsout://e2e/misc/DIRECT_ONE");
		expect(r.isErr()).toBe(true);
		if (r.isErr()) {
			expect(r.error).toContain('invalid field segment "DIRECT_ONE"');
			expect(r.error).toContain("[a-z0-9_-]");
			expect(r.error).toContain("dogsout://dev/gh/pat");
		}
	});

	test("rejects an uppercase vault or item, not just the field", () => {
		const vault = strict("dogsout://Dev/gh/pat");
		const item = strict("dogsout://dev/GH/pat");
		expect(vault.isErr() && vault.error).toContain('invalid vault segment "Dev"');
		expect(item.isErr() && item.error).toContain('invalid item segment "GH"');
	});

	test("rejects characters outside the charset (space, at-sign)", () => {
		expect(strict("dogsout://dev/gh/my pat").isErr()).toBe(true);
		expect(strict("dogsout://dev/gh/pat@2").isErr()).toBe(true);
	});

	test("exempts subpath keys: they are JSON keys, not address segments", () => {
		const a = strict("dogsout://gcp/prod-sa/key.API_KEY");
		if (a.isErr()) throw new Error(a.error);
		expect(a.value.subpath).toEqual(["API_KEY"]);
	});
});

describe("the read/cleanup parse stays tolerant", () => {
	test("a pre-charset address still parses, so get and rm can act on it", () => {
		const a = parseAddress("dogsout://e2e/misc/DIRECT_ONE");
		if (a.isErr()) throw new Error(a.error);
		expect(a.value).toEqual({ vault: "e2e", item: "misc", field: "DIRECT_ONE", subpath: [] });
	});

	test("shape errors are still refused", () => {
		expect(parseAddress("jtk://dev/gh/pat").isErr()).toBe(true);
		expect(parseAddress("dogsout://dev/gh").isErr()).toBe(true);
	});

	test("item refs parse by shape (nothing writes them)", () => {
		const r = parseItemRef("dogsout://Dev/gh");
		if (r.isErr()) throw new Error(r.error);
		expect(r.value).toEqual({ vault: "Dev", item: "gh" });
	});
});

describe("scanAddress (legacy report, never throws)", () => {
	test("lists every offending segment of a stored address", () => {
		const found = scanAddress("dogsout://Dev/gh_main/DIRECT_ONE");
		expect(found.map((v) => `${v.kind}:${v.segment}`)).toEqual(["vault:Dev", "field:DIRECT_ONE"]);
		const groups = groupViolations(found);
		expect(groups).toEqual([
			{ address: "dogsout://Dev/gh_main/DIRECT_ONE", segments: ['vault "Dev"', 'field "DIRECT_ONE"'] },
		]);
	});

	test("is silent for a clean address and for anything that is not a dogsout:// address", () => {
		expect(scanAddress("dogsout://dev/gh/pat")).toEqual([]);
		expect(scanAddress("jtk://dev/gh/pat")).toEqual([]);
		expect(scanAddress("not-an-address")).toEqual([]);
	});
});
