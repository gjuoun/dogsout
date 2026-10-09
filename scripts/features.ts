#!/usr/bin/env bun
// Development-only navigation schema; product runtime contracts remain in contracts/.
import { readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

const Key = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
const Text = z
	.string()
	.min(1)
	.max(400)
	.refine((value) => !/[\r\n]/.test(value), "must be a single line");
const unique = <T extends z.ZodType>(item: T) =>
	z.array(item).refine((values) => new Set(values).size === values.length, "duplicate array value");
const FeatureSchema = z.strictObject({
	key: Key,
	area: Key,
	title: Text,
	intent: Text,
	surfaces: unique(z.enum(["cli", "daemon", "approval-ui", "relay", "hosted", "mcp", "adapter", "distribution"])).min(
		1,
	),
	status: z.enum(["shipped", "wip", "planned", "deferred"]),
	milestone: z
		.string()
		.regex(/^F[1-9][0-9]*$/)
		.optional(),
	doc: z.string(),
	code: unique(z.string()),
	tests: unique(z.string()),
	verification: z.enum(["automated", "partial", "manual", "none"]),
	depends_on: unique(Key),
	issues: unique(z.string().regex(/^[A-Z]+-[1-9][0-9]*$/)).optional(),
});
const RegistrySchema = z.strictObject({
	version: z.literal(1),
	milestones: z.array(z.strictObject({ id: z.string().regex(/^F[1-9][0-9]*$/), title: Text })),
	features: z.array(FeatureSchema).min(1),
});
export type Registry = z.infer<typeof RegistrySchema>;
type Reader = (path: string) => string | undefined;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const ordered = (r: Registry) => [...r.features].sort((a, b) => compare(a.key, b.key));
const safePath = (path: string) =>
	/^[A-Za-z0-9_./-]+$/.test(path) && !isAbsolute(path) && !path.split("/").some((p) => !p || p === ".." || p === ".");

export function fileReader(root: string): Reader {
	const base = realpathSync(root);
	return (path) => {
		if (!safePath(path)) return undefined;
		try {
			const target = realpathSync(resolve(base, path));
			const rel = relative(base, target);
			if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`) || !statSync(target).isFile()) return undefined;
			return readFileSync(target, "utf8");
		} catch {
			return undefined;
		}
	};
}

// Only bare stable-key H3s count; fenced examples are not declarations.
function sections(text: string): Array<{ key: string; body: string }> {
	const result: Array<{ key: string; body: string }> = [];
	let fence = "";
	let active: { key: string; body: string } | undefined;
	for (const line of text.split("\n")) {
		const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
		if (marker) {
			const token = marker[1] ?? "";
			if (!fence) fence = token;
			else if (token[0] === fence[0] && token.length >= fence.length) fence = "";
			continue;
		}
		if (fence) continue;
		const heading = line.match(/^### ([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\s*$/);
		if (heading?.[1]) {
			active = { key: heading[1], body: "" };
			result.push(active);
		} else if (active) active.body += `${line}\n`;
	}
	return result;
}

export function validateRegistry(
	raw: unknown,
	read: Reader,
	docPaths: string[] = [],
): Result<{ registry: Registry; warnings: string[] }, string[]> {
	const parsed = RegistrySchema.safeParse(raw);
	if (!parsed.success) return err(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
	const registry = parsed.data,
		errors: string[] = [],
		warnings: string[] = [];
	const milestones = new Set<string>();
	for (const m of registry.milestones) {
		if (milestones.has(m.id)) errors.push(`duplicate milestone: ${m.id}`);
		milestones.add(m.id);
	}
	const byKey = new Map<string, Registry["features"][number]>();
	for (const f of registry.features) {
		if (byKey.has(f.key)) errors.push(`duplicate key: ${f.key}`);
		byKey.set(f.key, f);
	}
	const docCache = new Map<string, ReturnType<typeof sections>>();
	const paths = new Set(
		docPaths.filter((p) => !["features/INDEX.md", "features/product.md", "features/architecture.md"].includes(p)),
	);
	for (const f of registry.features) {
		if (f.milestone && !milestones.has(f.milestone)) errors.push(`${f.key}: unknown milestone ${f.milestone}`);
		for (const path of [...f.code, ...f.tests]) {
			if (!safePath(path)) errors.push(`${f.key}: unsafe path ${path}`);
			else if (read(path) === undefined) errors.push(`${f.key}: missing file ${path}`);
		}
		const [doc, anchor, ...extra] = f.doc.split("#");
		if (!doc || !anchor || extra.length || !safePath(doc) || !doc.startsWith("features/") || !doc.endsWith(".md")) {
			errors.push(`${f.key}: invalid doc path/anchor ${f.doc}`);
			continue;
		}
		paths.add(doc);
		if (f.status === "shipped" && !f.code.length) errors.push(`${f.key}: shipped needs code`);
		if (f.status === "shipped" && f.verification === "none") errors.push(`${f.key}: shipped needs evidence`);
		if (["automated", "partial"].includes(f.verification) && !f.tests.length)
			errors.push(`${f.key}: ${f.verification} needs tests`);
		if (!docCache.has(doc)) {
			const text = read(doc);
			if (text === undefined) {
				errors.push(`${f.key}: missing file ${doc}`);
				continue;
			}
			docCache.set(doc, sections(text));
		}
		const section = docCache.get(doc)?.find((s) => s.key === anchor);
		if (!section || anchor !== f.key) {
			errors.push(`${f.key}: missing/mismatched anchor ${f.doc}`);
			continue;
		}
		for (const label of ["Intent:", "Acceptance:", "Verification:"])
			if (!section.body.includes(label)) errors.push(`${f.key}: missing ${label} in prose`);
		if (!section.body.includes("Current:") && !section.body.includes("Target:"))
			errors.push(`${f.key}: missing Current/Target in prose`);
		if (f.verification === "manual" && !/Manual evidence:.*\d{4}-\d{2}-\d{2}/.test(section.body))
			errors.push(`${f.key}: missing dated manual evidence`);
		if (["manual", "partial"].includes(f.verification)) {
			if (!section.body.includes("Gaps:")) errors.push(`${f.key}: ${f.verification} must declare Gaps:`);
			warnings.push(`${f.key}: ${f.verification} verification; see ${f.doc}`);
		}
		for (const dep of f.depends_on) if (!byKey.has(dep)) errors.push(`${f.key}: unknown dependency ${dep}`);
	}
	const visiting = new Set<string>(),
		visited = new Set<string>();
	function visit(key: string) {
		if (visiting.has(key)) {
			errors.push(`dependency cycle at ${key}`);
			return;
		}
		if (visited.has(key)) return;
		visiting.add(key);
		for (const dep of byKey.get(key)?.depends_on ?? []) if (byKey.has(dep)) visit(dep);
		visiting.delete(key);
		visited.add(key);
	}
	for (const key of byKey.keys()) visit(key);
	for (const doc of paths) {
		if (!safePath(doc)) {
			errors.push(`unsafe doc path ${doc}`);
			continue;
		}
		if (!docCache.has(doc)) {
			const text = read(doc);
			if (text === undefined) {
				errors.push(`missing file ${doc}`);
				continue;
			}
			docCache.set(doc, sections(text));
		}
		const seen = new Set<string>();
		for (const section of docCache.get(doc) ?? []) {
			if (seen.has(section.key)) errors.push(`duplicate heading ${doc}#${section.key}`);
			seen.add(section.key);
			if (byKey.get(section.key)?.doc !== `${doc}#${section.key}`) errors.push(`orphan section ${doc}#${section.key}`);
		}
	}
	return errors.length ? err(errors) : ok({ registry, warnings: warnings.sort(compare) });
}

const cell = (text: string) => text.replaceAll("|", "\\|");
function counts(features: Registry["features"]) {
	return (
		["shipped", "wip", "planned", "deferred"]
			.map((s) => ({ s, n: features.filter((f) => f.status === s).length }))
			.filter((x) => x.n)
			.map((x) => `${x.n} ${x.s}`)
			.join(", ") || "no features"
	);
}
export function renderRoadmap(r: Registry): string {
	const lines = [
		"Generated from [features/registry.yaml](features/registry.yaml). See the [feature index](features/INDEX.md) for intent, evidence and code/test pointers.",
		"",
		"| Milestone | Scope | Feature state |",
		"|---|---|---|",
	];
	for (const m of [...r.milestones].sort((a, b) => compare(a.id, b.id)))
		lines.push(`| ${m.id} | ${cell(m.title)} | ${counts(r.features.filter((f) => f.milestone === m.id))} |`);
	const unscheduled = r.features.filter((f) => !f.milestone);
	lines.push(
		"",
		`Unscheduled directions: ${counts(unscheduled)}. Distribution, MCP/adapters, hosted relay and deferred sync/backup are separate keys, not an implied release promise.`,
		"",
		"Shipped means locally available, not published or fully regression-covered. Partial/manual evidence and known gaps remain explicit in the feature pages.",
	);
	return lines.join("\n");
}
export function renderIndex(r: Registry): string {
	const lines = [
		"# Feature index",
		"",
		"<!-- Generated by bun run features:generate; edit registry.yaml and family prose, not this file. -->",
		"",
		"[Product intent](product.md) · [Architecture](architecture.md) · [Registry](registry.yaml) · [Foundation decisions](../docs/decisions/0001-foundation.md)",
		"",
		`Inventory: ${r.features.length} keys (${counts(r.features)}). Evidence is not implied by implementation status.`,
		"",
		"## Milestones",
		"",
		"| ID | Scope | State |",
		"|---|---|---|",
	];
	for (const m of [...r.milestones].sort((a, b) => compare(a.id, b.id)))
		lines.push(`| ${m.id} | ${cell(m.title)} | ${counts(r.features.filter((f) => f.milestone === m.id))} |`);
	lines.push(
		"",
		"## Locate a change",
		"",
		"Known key → registry entry → intent/current/target/acceptance → code/tests. Natural language → intent column/family prose; cross-domain requests → product/architecture. Code arrays are entry points, not exhaustive ownership. Planned/deferred entries deliberately have no imaginary implementation paths.",
	);
	const areas = [...new Set(r.features.map((f) => f.area))].sort(compare);
	for (const area of areas) {
		lines.push("", `## ${area}`, "", "| Key | Intent | Status / evidence | Surfaces |", "|---|---|---|---|");
		for (const f of ordered(r).filter((f) => f.area === area))
			lines.push(
				`| [${f.key}](${f.doc.replace(/^features\//, "")}) | ${cell(f.intent)} | ${f.status} / ${f.verification} | ${[...f.surfaces].sort(compare).join(", ")} |`,
			);
	}
	lines.push(
		"",
		"## Maintenance",
		"",
		"Update registry and prose together; run `bun run features:generate` then `bun run features:check`. Checks validate links/schema/dependencies/projections, not product semantics or secret safety. Stable keys survive file moves and new deployment surfaces.",
		"",
	);
	return lines.join("\n");
}

const START = "<!-- features:roadmap:start -->",
	END = "<!-- features:roadmap:end -->";
export function replaceRoadmap(readme: string, roadmap: string): Result<string, string> {
	const start = readme.indexOf(START),
		end = readme.indexOf(END);
	if (
		start < 0 ||
		end < start ||
		readme.indexOf(START, start + START.length) >= 0 ||
		readme.indexOf(END, end + END.length) >= 0
	)
		return err("README needs exactly one ordered roadmap marker pair");
	return ok(`${readme.slice(0, start + START.length)}\n${roadmap}\n${readme.slice(end)}`);
}
export function checkProjections(r: Registry, index: string | undefined, readme: string): Result<void, string[]> {
	const errors: string[] = [];
	if (index !== renderIndex(r)) errors.push("features/INDEX.md is stale; run features:generate");
	const expected = replaceRoadmap(readme, renderRoadmap(r));
	if (expected.isErr()) errors.push(expected.error);
	else if (expected.value !== readme) errors.push("README roadmap is stale; run features:generate");
	return errors.length ? err(errors) : ok(undefined);
}

function docPaths(root: string): string[] {
	const result: string[] = [];
	function walk(path: string) {
		for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
			const child = `${path}/${entry.name}`;
			if (entry.isDirectory()) walk(child);
			else if (entry.isFile() && entry.name.endsWith(".md")) result.push(child);
		}
	}
	walk("features");
	return result;
}
function main(): number {
	const mode = process.argv[2];
	if (mode !== "check" && mode !== "generate") {
		console.error("usage: bun scripts/features.ts check|generate");
		return 1;
	}
	const root = resolve(import.meta.dir, ".."),
		read = fileReader(root);
	try {
		const source = read("features/registry.yaml");
		if (!source) {
			console.error("features: missing registry");
			return 1;
		}
		const result = validateRegistry(Bun.YAML.parse(source), read, docPaths(root));
		if (result.isErr()) {
			for (const message of result.error) console.error(`features: ${message}`);
			return 1;
		}
		const { registry, warnings } = result.value;
		for (const message of warnings) console.warn(`warning: ${message}`);
		const readme = read("README.md");
		if (readme === undefined) {
			console.error("features: missing README.md");
			return 1;
		}
		if (mode === "generate") {
			const updated = replaceRoadmap(readme, renderRoadmap(registry));
			if (updated.isErr()) {
				console.error(updated.error);
				return 1;
			}
			writeFileSync(join(root, "features/INDEX.md"), renderIndex(registry));
			writeFileSync(join(root, "README.md"), updated.value);
		} else {
			const checked = checkProjections(registry, read("features/INDEX.md"), readme);
			if (checked.isErr()) {
				for (const message of checked.error) console.error(message);
				return 1;
			}
		}
		console.log(`features: ${mode} PASS (${registry.features.length} keys, ${warnings.length} explicit evidence gaps)`);
		return 0;
	} catch (error) {
		console.error(`features: ${String(error)}`);
		return 1;
	}
}
if (import.meta.main) process.exit(main());
