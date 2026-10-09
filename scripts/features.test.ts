import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	checkProjections,
	fileReader,
	renderIndex,
	renderRoadmap,
	replaceRoadmap,
	validateRegistry,
} from "./features.ts";

function first<T>(items: T[]): T {
	const item = items[0];
	if (item === undefined) throw new Error("fixture is empty");
	return item;
}

function fixture() {
	const raw = {
		version: 1,
		milestones: [{ id: "F1", title: "Local CLI" }],
		features: [
			{
				key: "run-demo",
				area: "run",
				title: "Demo",
				intent: "Inject a reference",
				surfaces: ["cli"],
				status: "shipped",
				milestone: "F1",
				doc: "features/demo.md#run-demo",
				code: ["src/demo.ts"],
				tests: ["src/demo.test.ts"],
				verification: "automated",
				depends_on: [] as string[],
			},
		],
	};
	const files: Record<string, string> = {
		"src/demo.ts": "// implementation",
		"src/demo.test.ts": "// test",
		"features/demo.md":
			"# Demo\n### run-demo\n**Intent:** inject\n**Current:** works\n**Acceptance:** child receives value\n**Verification:** test assertion\n",
	};
	return { raw, files, read: (path: string) => files[path] };
}
function errors(result: ReturnType<typeof validateRegistry>): string {
	expect(result.isErr()).toBe(true);
	return result.isErr() ? result.error.join("\n") : "";
}
describe("feature registry validation", () => {
	test("valid schema, links and body", () => {
		const f = fixture();
		expect(validateRegistry(f.raw, f.read).isOk()).toBe(true);
	});
	test("duplicate feature and milestone IDs", () => {
		const f = fixture();
		f.raw.features.push({ ...first(f.raw.features) });
		expect(errors(validateRegistry(f.raw, f.read))).toContain("duplicate key");
		const g = fixture();
		g.raw.milestones.push({ ...first(g.raw.milestones) });
		expect(errors(validateRegistry(g.raw, g.read))).toContain("duplicate milestone");
	});
	test("unknown fields and wildcard keys", () => {
		const f = fixture();
		Object.assign(first(f.raw.features), { typo: true });
		expect(validateRegistry(f.raw, f.read).isErr()).toBe(true);
		const g = fixture();
		first(g.raw.features).key = "policy-*";
		expect(validateRegistry(g.raw, g.read).isErr()).toBe(true);
	});
	test("enums and duplicate array values", () => {
		const f = fixture();
		first(f.raw.features).status = "almost";
		expect(validateRegistry(f.raw, f.read).isErr()).toBe(true);
		const g = fixture();
		first(g.raw.features).surfaces.push("cli");
		expect(validateRegistry(g.raw, g.read).isErr()).toBe(true);
	});
	test.each(["/tmp/outside.ts", "../outside.ts", "src/../outside.ts", "C:\\outside.ts"])(
		"reject unsafe path %s",
		(path) => {
			const f = fixture();
			first(f.raw.features).code = [path];
			expect(errors(validateRegistry(f.raw, f.read))).toContain("path");
		},
	);
	test("missing paths and anchors", () => {
		const f = fixture();
		delete f.files["src/demo.ts"];
		expect(errors(validateRegistry(f.raw, f.read))).toContain("missing file");
		const g = fixture();
		first(g.raw.features).doc = "features/demo.md#missing";
		expect(errors(validateRegistry(g.raw, g.read))).toContain("anchor");
	});
	test("unknown milestone and dependency", () => {
		const f = fixture();
		first(f.raw.features).milestone = "F9";
		expect(errors(validateRegistry(f.raw, f.read))).toContain("unknown milestone");
		const g = fixture();
		first(g.raw.features).depends_on = ["unknown"];
		expect(errors(validateRegistry(g.raw, g.read))).toContain("unknown dependency");
	});
	test("self and multi-feature dependency cycles", () => {
		const f = fixture();
		first(f.raw.features).depends_on = ["run-demo"];
		expect(errors(validateRegistry(f.raw, f.read))).toContain("cycle");
		const g = fixture();
		const entry = first(g.raw.features);
		entry.depends_on = ["run-other"];
		g.raw.features.push({ ...entry, key: "run-other", doc: "features/demo.md#run-other", depends_on: ["run-demo"] });
		g.files["features/demo.md"] += "### run-other\n**Intent:** other\n**Current:** works\n**Acceptance:** works\n";
		expect(errors(validateRegistry(g.raw, g.read))).toContain("cycle");
	});
	test("shipped needs code and evidence; automated needs tests", () => {
		const f = fixture();
		first(f.raw.features).code = [];
		expect(errors(validateRegistry(f.raw, f.read))).toContain("shipped needs code");
		const g = fixture();
		first(g.raw.features).tests = [];
		expect(errors(validateRegistry(g.raw, g.read))).toContain("needs tests");
		const h = fixture();
		first(h.raw.features).verification = "none";
		expect(errors(validateRegistry(h.raw, h.read))).toContain("shipped needs evidence");
	});
	test("manual and partial evidence must declare gaps", () => {
		const f = fixture();
		first(f.raw.features).verification = "manual";
		first(f.raw.features).tests = [];
		expect(errors(validateRegistry(f.raw, f.read))).toContain("manual evidence");
		f.files["features/demo.md"] += "Manual evidence: 2026-10-09 fake-data check. Gaps: no regression.\n";
		const result = validateRegistry(f.raw, f.read);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) expect(result.value.warnings).toHaveLength(1);
		const g = fixture();
		first(g.raw.features).verification = "partial";
		expect(errors(validateRegistry(g.raw, g.read))).toContain("Gaps:");
	});
	test("planned may omit implementation and milestone", () => {
		const f = fixture();
		Object.assign(first(f.raw.features), { status: "planned", verification: "none", code: [], tests: [] });
		const { milestone: _unused, ...entry } = first(f.raw.features);
		const result = validateRegistry({ ...f.raw, features: [entry] }, f.read);
		expect(result.isOk()).toBe(true);
	});
	test("orphan sections, orphan files and duplicate headings fail", () => {
		const f = fixture();
		f.files["features/demo.md"] += "### unregistered\n";
		expect(errors(validateRegistry(f.raw, f.read))).toContain("orphan");
		const g = fixture();
		g.files["features/lost.md"] = "### lost-feature\n";
		expect(errors(validateRegistry(g.raw, g.read, ["features/lost.md"]))).toContain("orphan");
		const h = fixture();
		h.files["features/demo.md"] += "### run-demo\n";
		expect(errors(validateRegistry(h.raw, h.read))).toContain("duplicate heading");
	});
	test("fenced sample headings are not features", () => {
		const f = fixture();
		f.files["features/demo.md"] += ["```markdown", "### phantom-key", "```", ""].join("\n");
		expect(validateRegistry(f.raw, f.read).isOk()).toBe(true);
	});
	test("reader refuses symlink escapes", () => {
		const root = mkdtempSync(join(tmpdir(), "jtk-doc-root-"));
		const outside = mkdtempSync(join(tmpdir(), "jtk-doc-outside-"));
		try {
			writeFileSync(join(root, "public.md"), "readable");
			expect(fileReader(root)("public.md")).toBe("readable");
			expect(fileReader(root)("../outside.md")).toBeUndefined();
			writeFileSync(join(outside, "private.md"), "not readable");
			symlinkSync(join(outside, "private.md"), join(root, "escape.md"));
			expect(fileReader(root)("escape.md")).toBeUndefined();
		} finally {
			rmSync(root, { recursive: true, force: true });
			rmSync(outside, { recursive: true, force: true });
		}
	});
});

describe("deterministic projections", () => {
	test("sorting is independent of registry input order", () => {
		const f = fixture();
		const result = validateRegistry(f.raw, f.read);
		if (result.isErr()) throw Error(result.error.join("\n"));
		const r = result.value.registry;
		const more = {
			...r,
			milestones: [...r.milestones, { id: "F2", title: "Policy" }],
			features: [...r.features, { ...first(r.features), key: "other-demo", area: "other" }],
		};
		const reversed = { ...more, milestones: [...more.milestones].reverse(), features: [...more.features].reverse() };
		expect(renderIndex(more)).toBe(renderIndex(reversed));
		expect(renderRoadmap(more)).toBe(renderRoadmap(reversed));
	});
	test("markers preserve unrelated README text, regeneration is idempotent and drift fails", () => {
		const f = fixture();
		const result = validateRegistry(f.raw, f.read);
		if (result.isErr()) throw Error(result.error.join("\n"));
		const r = result.value.registry;
		const input = "before\n<!-- features:roadmap:start -->\nold\n<!-- features:roadmap:end -->\nafter\n";
		const replaced = replaceRoadmap(input, renderRoadmap(r));
		if (replaced.isErr()) throw Error(replaced.error);
		expect(replaced.value.startsWith("before\n")).toBe(true);
		expect(replaced.value.endsWith("after\n")).toBe(true);
		const again = replaceRoadmap(replaced.value, renderRoadmap(r));
		expect(again.isOk()).toBe(true);
		if (again.isOk()) expect(again.value).toBe(replaced.value);
		expect(checkProjections(r, renderIndex(r), replaced.value).isOk()).toBe(true);
		expect(checkProjections(r, `${renderIndex(r)}stale`, replaced.value).isErr()).toBe(true);
		expect(checkProjections(r, renderIndex(r), input).isErr()).toBe(true);
	});
	test("missing, repeated and reversed markers fail", () => {
		const start = "<!-- features:roadmap:start -->",
			end = "<!-- features:roadmap:end -->";
		for (const bad of ["no markers", start + start + end, end + start])
			expect(replaceRoadmap(bad, "body").isErr()).toBe(true);
	});
});
