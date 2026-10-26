import {
	type Ctx,
	dogsoutHome,
	loadConfig,
	loadSessions,
	openData,
	type RefResolver,
	sdkResolver,
} from "@dogsout/core";
import type { Config, VaultData } from "@dogsout/type-contracts";
import { err, ok, type Result } from "neverthrow";

/**
 * The app's storage context: the `Ctx` a vault-touching command needs, resolved from the
 * environment. Shared by the crud, run and policy command modules, so it lives here rather
 * than inside any one of them. There is no password: the vault unlocks through the Secure Enclave.
 */
export function ctxFromEnv(): Result<Ctx, string> {
	return ok({ home: dogsoutHome() });
}

/** Read the vault once, for a caller that is not writing it back. */
export async function openDataOnce(ctx: Ctx): Promise<Result<{ data: VaultData }, string>> {
	const opened = await openData(ctx);
	if (opened.isErr()) return err(opened.error);
	return ok({ data: opened.value.data });
}

/**
 * The vault, opened only when a requested name is not served by a config ref — the 1Password
 * path must never cost a Touch ID prompt. `needsVault` is decided by the caller after resolving
 * names to addresses; `null` means "nothing to open", which is not an error.
 */
export async function openVaultIfNeeded(ctx: Ctx, needsVault: boolean): Promise<Result<VaultData | undefined, string>> {
	if (!needsVault) return ok(undefined);
	const opened = await openDataOnce(ctx);
	if (opened.isErr()) return err(opened.error);
	return ok(opened.value.data);
}

/**
 * The 1Password resolver. `DOGSOUT_1P_HELPER` points at a test-only module exporting
 * `createResolver()` (the same seam pattern as DOGSOUT_SE_HELPER); production uses the SDK.
 */
export async function refResolver(): Promise<RefResolver> {
	const helper = process.env.DOGSOUT_1P_HELPER;
	if (helper !== undefined && helper.length > 0) return loadHelper(helper);
	return sdkResolver();
}

/** A helper module path is imported at call time so a test can point at any file. */
async function loadHelper(path: string): Promise<RefResolver> {
	const mod = (await import(path)) as { createResolver?: () => RefResolver };
	if (typeof mod.createResolver !== "function") {
		throw new Error(`DOGSOUT_1P_HELPER module has no createResolver(): ${path}`);
	}
	return mod.createResolver();
}

/** The Ctx + parsed Config that every policy-facing command opens first. */
export async function ctxAndConfig(): Promise<Result<{ ctx: Ctx; cfg: Config }, string>> {
	const ctx = ctxFromEnv();
	if (ctx.isErr()) return err(ctx.error);
	const cfg = await loadConfig(ctx.value.home);
	if (cfg.isErr()) return err(cfg.error);
	return ok({ ctx: ctx.value, cfg: cfg.value });
}

/** Live session ids for a home; an unreadable file means nothing is active. */
export async function activeSessionIds(home: string): Promise<string[]> {
	const s = await loadSessions(home);
	return s.isOk() ? s.value.sessions.map((x) => x.id) : [];
}
