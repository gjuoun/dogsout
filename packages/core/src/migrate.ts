import { existsSync } from "node:fs";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import { type Config, type GrantsFile, parseConfig, parseGrantsFile } from "@dogsout/type-contracts";
import { err, ok, type Result } from "neverthrow";
import { configPath, dogsoutHome, grantsPath, legacyHome } from "./paths.ts";
import { saveGrants } from "./session/grants.ts";
import { writeConfig } from "./store.ts";

/**
 * One-time rename migration (2026-10-23. Two parts, both idempotent:
 *
 * 1. stored addresses — `jtk://` → `dogsout://` inside config.json (aliases, map slots,
 *    rule resources) and grants.json (grant addresses). The vault is never opened, so
 *    `vault.enc` stays byte-identical and every `value_hash` survives untouched.
 * 2. storage directory — ~/.config/junethekey → ~/.config/dogsout, a plain `rename()`
 *    (same filesystem, atomic, keeps modes). Skipped when `DOGSOUT_HOME` is set or the
 *    new directory already exists.
 *
 * Nothing here decrypts anything, so no plaintext can reach a temporary file: the only
 * bytes rewritten are addresses, which are metadata (PRD red line 1).
 */

const LEGACY_SCHEME = "jtk://";
const SCHEME = "dogsout://";

type Json = Record<string, unknown>;

export interface FilePlan {
	path: string;
	rewrites: number;
	/** One rewritten address, shown as-is: addresses are metadata, never values. */
	sample: string | null;
	exists: boolean;
}

export type StorageAction = "move" | "already-migrated" | "explicit-home" | "none";

export interface MigrationPlan {
	home: string;
	legacyHome: string;
	storage: { action: StorageAction; from: string; to: string };
	files: FilePlan[];
	totalRewrites: number;
	/** Rewritten documents, carried so apply writes exactly what dry-run described. */
	config: Config | null;
	grants: GrantsFile | null;
}

function isJson(v: unknown): v is Json {
	return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Rewrite one address string; anything else is returned unchanged. */
function rewriteAddress(v: unknown, seen: { count: number; sample: string | null }): unknown {
	if (typeof v !== "string" || !v.startsWith(LEGACY_SCHEME)) return v;
	const next = SCHEME + v.slice(LEGACY_SCHEME.length);
	seen.count += 1;
	seen.sample ??= next;
	return next;
}

/** config.json: aliases values, map-slot targets, rule resources. */
function rewriteConfig(raw: unknown): { value: Config; rewrites: number; sample: string | null } | { error: string } {
	if (!isJson(raw)) return { error: "config.json is not an object" };
	const seen = { count: 0, sample: null as string | null };
	const aliases = raw.aliases;
	if (isJson(aliases)) for (const k of Object.keys(aliases)) aliases[k] = rewriteAddress(aliases[k], seen);
	const maps = raw.maps;
	if (isJson(maps)) for (const k of Object.keys(maps)) maps[k] = rewriteAddress(maps[k], seen);
	const rules = raw.rules;
	if (Array.isArray(rules)) {
		for (const rule of rules) {
			if (isJson(rule) && "resource" in rule) rule.resource = rewriteAddress(rule.resource, seen);
		}
	}
	// Write gate: the rewritten document must satisfy the current schema, or nothing is written.
	const parsed = parseConfig(raw);
	if (!parsed.ok) return { error: `config.json after rewrite: ${parsed.error}` };
	return { value: parsed.config, rewrites: seen.count, sample: seen.sample };
}

/** grants.json: every grant address. value_hash is copied verbatim. */
function rewriteGrants(
	raw: unknown,
): { value: GrantsFile; rewrites: number; sample: string | null } | { error: string } {
	if (!isJson(raw)) return { error: "grants.json is not an object" };
	const seen = { count: 0, sample: null as string | null };
	const grants = raw.grants;
	if (Array.isArray(grants)) {
		for (const grant of grants) {
			if (isJson(grant) && "address" in grant) grant.address = rewriteAddress(grant.address, seen);
		}
	}
	const parsed = parseGrantsFile(raw);
	if (!parsed.ok) return { error: `grants.json after rewrite: ${parsed.error}` };
	return { value: parsed.file, rewrites: seen.count, sample: seen.sample };
}

async function readJson(path: string): Promise<Result<unknown, string>> {
	const file = Bun.file(path);
	if (!(await file.exists())) return err("missing");
	try {
		return ok(JSON.parse(await file.text()));
	} catch {
		return err(`${path} is not valid JSON`);
	}
}

function storagePlan(home: string, legacy: string, explicitHome: boolean): MigrationPlan["storage"] {
	const moved = { action: "already-migrated" as const, from: legacy, to: home };
	// `DOGSOUT_HOME` pins storage for every command, so migration must not move anything
	// behind it; an explicit `--home` argument only changes the target of this run.
	if (explicitHome) return { action: "explicit-home", from: legacy, to: home };
	const targetHas = existsSync(join(home, "config.json")) || existsSync(join(home, "vault.enc"));
	const legacyHas = existsSync(join(legacy, "config.json")) || existsSync(join(legacy, "vault.enc"));
	if (targetHas) return moved;
	if (legacyHas) return { action: "move", from: legacy, to: home };
	return { action: "none", from: legacy, to: home };
}

export interface PlanOptions {
	/** Target storage root; defaults to dogsoutHome(). */
	home?: string;
	/** Pre-rename root; defaults to legacyHome(). */
	legacy?: string;
}

/**
 * Read the current storage and describe what `dogsout migrate` would change. Pure read:
 * no file is created, moved or touched, so this is also the `--dry-run` path.
 */
export async function planMigration(opts: PlanOptions = {}): Promise<Result<MigrationPlan, string>> {
	const home = opts.home ?? dogsoutHome();
	const legacy = opts.legacy ?? legacyHome();
	const storage = storagePlan(home, legacy, opts.home === undefined && Boolean(process.env.DOGSOUT_HOME));
	// Addresses are rewritten where they live now: the legacy root before it moves, the
	// target root once it exists (a resumed migration), or an explicit DOGSOUT_HOME.
	const source = storage.action === "move" ? legacy : home;
	const files: FilePlan[] = [];
	let config: Config | null = null;
	let grants: GrantsFile | null = null;
	let totalRewrites = 0;

	const cfgPath = configPath(source);
	const cfgRaw = await readJson(cfgPath);
	if (cfgRaw.isOk()) {
		const r = rewriteConfig(cfgRaw.value);
		if ("error" in r) return err(r.error);
		config = r.value;
		totalRewrites += r.rewrites;
		files.push({ path: cfgPath, rewrites: r.rewrites, sample: r.sample, exists: true });
	} else if (cfgRaw.error !== "missing") {
		return err(cfgRaw.error);
	} else {
		files.push({ path: cfgPath, rewrites: 0, sample: null, exists: false });
	}

	const grantPath = grantsPath(source);
	const grantRaw = await readJson(grantPath);
	if (grantRaw.isOk()) {
		const r = rewriteGrants(grantRaw.value);
		if ("error" in r) return err(r.error);
		grants = r.value;
		totalRewrites += r.rewrites;
		files.push({ path: grantPath, rewrites: r.rewrites, sample: r.sample, exists: true });
	} else if (grantRaw.error !== "missing") {
		return err(grantRaw.error);
	} else {
		files.push({ path: grantPath, rewrites: 0, sample: null, exists: false });
	}

	return ok({ home, legacyHome: legacy, storage, files, totalRewrites, config, grants });
}

export interface MigrationResult {
	rewrites: number;
	filesWritten: number;
	storage: StorageAction;
	from: string;
	to: string;
}

/**
 * Apply a plan: rewrite the address files (0600 atomic writes, only when something
 * changed), then move the directory. Never opens vault.enc, so the ciphertext and every
 * `value_hash` are exactly what they were.
 */
export async function applyMigration(plan: MigrationPlan): Promise<Result<MigrationResult, string>> {
	let filesWritten = 0;
	const source = plan.storage.action === "move" ? plan.legacyHome : plan.home;
	for (const file of plan.files) {
		if (!file.exists || file.rewrites === 0) continue;
		if (file.path === configPath(source) && plan.config) {
			const w = await writeConfig(source, plan.config);
			if (w.isErr()) return err(w.error);
			filesWritten += 1;
		} else if (file.path === grantsPath(source) && plan.grants) {
			const w = await saveGrants(source, plan.grants);
			if (w.isErr()) return err(w.error);
			filesWritten += 1;
		}
	}
	if (plan.storage.action === "move") {
		try {
			await rename(plan.legacyHome, plan.home);
		} catch (e) {
			return err(`addresses were rewritten but the directory move failed: ${String(e)}`);
		}
	}
	return ok({
		rewrites: plan.totalRewrites,
		filesWritten,
		storage: plan.storage.action,
		from: plan.storage.from,
		to: plan.storage.to,
	});
}
