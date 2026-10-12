import { runSafely } from "cmd-ts";
import { err, type Result } from "neverthrow";

/** Resources a command can touch — the feature map's reads/writes vocabulary. */
export type Resource = "config" | "vault" | "grants" | "sessions";

/** Per-command metadata consumed by the notebook feature map (ctx/check). */
export interface JtkMeta {
	readonly reads: readonly Resource[];
	readonly writes: readonly Resource[];
	readonly env: readonly string[];
}

/** Anything runSafely accepts: a command() or subcommands() product. */
type Runnable = Parameters<typeof runSafely>[0];

/** Attach map metadata to a command without disturbing its type. */
export function withMeta<C extends object>(cmd: C, meta: JtkMeta): C & { readonly meta: JtkMeta } {
	return { ...cmd, meta };
}

/** cmd-ts parse errors carry {config:{message,exitCode,into}}; strip the boilerplate head. */
function parseErrorMessage(exit: unknown): string {
	const cfg = (exit as { config?: { message?: unknown } }).config;
	const raw = typeof cfg?.message === "string" ? cfg.message : String(exit);
	return raw.replace(/^error: found \d+ errors?\n+/, "").trim();
}

/** Run one command in-process and map its outcome back onto neverthrow (unit-test surface).
 * Accepts a single command (ok value = handler return) or a subcommands tree
 * (ok value = {command, value}); both unwrap to the handler's Result.
 */
export async function runJtk<T>(cmd: Runnable, argv: string[]): Promise<Result<T, string>> {
	const r = await runSafely(cmd, argv);
	if (r._tag === "error") return err(parseErrorMessage(r.error));
	// subcommands wrap as {command, value} once per nesting level; unwrap all of them
	let v: unknown = r.value;
	for (;;) {
		const w = v as { command?: unknown; value?: unknown };
		if (w !== null && typeof w === "object" && "command" in w && "value" in w && typeof w.command === "string") {
			v = w.value;
			continue;
		}
		break;
	}
	return v as Result<T, string>;
}
