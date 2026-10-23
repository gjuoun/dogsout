import { describe, expect, test } from "bun:test";
import { desugarAddress, expandPattern } from "./address-input.ts";

const addr = (input: string) => {
	const r = desugarAddress(input);
	if (r.isErr()) throw new Error(`expected ok for ${input}, got: ${r.error}`);
	return r.value;
};

const pattern = (input: string) => {
	const r = expandPattern(input);
	if (r.isErr()) throw new Error(`expected ok for ${input}, got: ${r.error}`);
	return r.value;
};

describe("desugarAddress (jq-style input sugar)", () => {
	test("canonical, leading-dot and bare dotted forms are the same address", () => {
		const canonical = { vault: "dev", item: "gh", field: "pat", subpath: [] };
		expect(addr("dogsout://dev/gh/pat")).toEqual(canonical);
		expect(addr(".dev.gh.pat")).toEqual(canonical);
		expect(addr("dev.gh.pat")).toEqual(canonical);
		expect(addr("  .dev.gh.pat  ")).toEqual(canonical);
	});

	test("bracket segments quote a subpath key that a dot would split", () => {
		expect(addr('.gcp.sa.key["client.email"]')).toEqual({
			vault: "gcp",
			item: "sa",
			field: "key",
			subpath: ["client.email"],
		});
		expect(addr('dogsout://gcp/sa/key["a.b"].c').subpath).toEqual(["a.b", "c"]);
	});

	test("a single word is refused with the full address form, never guessed", () => {
		const r = desugarAddress("gh");
		expect(r.isErr()).toBe(true);
		if (r.isErr()) {
			expect(r.error).toContain("cannot read");
			expect(r.error).toContain("dogsout://dev/zai/api_key");
		}
	});

	test("two segments name an item, so a field command says so", () => {
		const r = desugarAddress(".dev.gh");
		expect(r.isErr() && r.error).toContain("names an item, not a field");
	});

	test("the write path enforces the charset on sugared input too", () => {
		const r = desugarAddress(".Dev.gh.pat", { strict: true });
		expect(r.isErr() && r.error).toContain('invalid vault segment "Dev"');
	});

	test("the read path still parses a pre-charset address", () => {
		const a = addr("dogsout://e2e/misc/DIRECT_ONE");
		expect(a.field).toBe("DIRECT_ONE");
	});

	test("an unquoted special segment is a malformed bracket, not a silent pass", () => {
		const r = desugarAddress(".gcp.sa.key[client.email]");
		expect(r.isErr() && r.error).toContain("quote the key as JSON");
	});
});

describe("expandPattern (ls arguments)", () => {
	test("a literal field address is exact", () => {
		const p = pattern(".dev.gh.pat");
		expect(p.pattern).toEqual(["dev", "gh", "pat"]);
		expect(p.literalField).toBe(true);
	});

	test("a short path is a subtree prefix", () => {
		expect(pattern("dev").pattern).toEqual(["dev", "**"]);
		expect(pattern(".dev.gh").pattern).toEqual(["dev", "gh", "**"]);
		expect(pattern(".dev.gh").literalField).toBe(false);
	});

	test("glob segments are taken as written: * is one level, ** is the subtree", () => {
		expect(pattern(".dev.gh.*").pattern).toEqual(["dev", "gh", "*"]);
		expect(pattern("dogsout://dev/**").pattern).toEqual(["dev", "**"]);
		expect(pattern(".dev.gh.*").literalField).toBe(false);
	});

	test("a subpath is not a pattern", () => {
		const r = expandPattern(".dev.gh.pat.x");
		expect(r.isErr() && r.error).toContain("not subpaths");
	});

	test("a partial glob segment is refused", () => {
		const r = expandPattern(".dev.gh.pat*");
		expect(r.isErr() && r.error).toContain("exactly * or **");
	});
});
