import { type Ctx, jtkHome, loadConfig, loadSessions, openData } from "@jtk/core";
import type { Config, VaultData } from "@jtk/type-contracts";
import { err, ok, type Result } from "neverthrow";

/**
 * The app's storage context: the `Ctx` a vault-touching command needs, resolved from the
 * environment. Shared by the crud, run and policy command modules, so it lives here rather
 * than inside any one of them. The master is optional: a v1 vault asks for it when opened,
 * a v2 vault unlocks through the Secure Enclave and never needs it.
 */
export function ctxFromEnv(): Result<Ctx, string> {
	const master = process.env.JTK_MASTER;
	return ok(master ? { home: jtkHome(), master } : { home: jtkHome() });
}

/** Read the vault once, for a caller that is not writing it back. */
export async function openDataOnce(ctx: Ctx): Promise<Result<{ data: VaultData }, string>> {
	const opened = await openData(ctx);
	if (opened.isErr()) return err(opened.error);
	return ok({ data: opened.value.data });
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
