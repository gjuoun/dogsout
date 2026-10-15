import { type Ctx, jtkHome, masterFromEnv, openData } from "@jtk/core";
import type { VaultData } from "@jtk/type-contracts";
import { err, ok, type Result } from "neverthrow";

/**
 * The app's storage context: the `Ctx` a vault-touching command needs, resolved from the
 * environment. Shared by the crud, run and policy command modules, so it lives here rather
 * than inside any one of them.
 */
export function ctxFromEnv(): Result<Ctx, string> {
	const master = masterFromEnv();
	if (master.isErr()) return err(master.error);
	return ok({ home: jtkHome(), master: master.value });
}

/** Read the vault once, for a caller that is not writing it back. */
export async function openDataOnce(ctx: Ctx): Promise<Result<{ data: VaultData }, string>> {
	const opened = await openData(ctx);
	if (opened.isErr()) return err(opened.error);
	return ok({ data: opened.value.data });
}
