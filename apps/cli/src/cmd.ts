import { runSafely } from "cmd-ts";
import { err, type Result } from "neverthrow";

/** Fail a command handler on a plain message (Result plumbing shared by every command). */
export function fail(message: string): Result<never, string> {
	return err(message);
}

/** Resources a command can touch — the feature map's reads/writes vocabulary. */
export type Resource = "config" | "vault" | "grants" | "sessions";

/** Per-command metadata consumed by the notebook feature map (ctx/check). */
export interface DogsoutMeta {
	readonly reads: readonly Resource[];
	readonly writes: readonly Resource[];
	readonly env: readonly string[];
}

/** Anything runSafely accepts: a command() or subcommands() product. */
type Runnable = Parameters<typeof runSafely>[0];

/** Attach map metadata to a command without disturbing its type. */
export function withMeta<C extends object>(cmd: C, meta: DogsoutMeta): C & { readonly meta: DogsoutMeta } {
	return { ...cmd, meta };
}

/** cmd-ts parse errors carry {config:{message,exitCode,into}}; strip the boilerplate head. */
export function parseErrorMessage(exit: unknown): string {
	const cfg = (exit as { config?: { message?: unknown } }).config;
	const raw = typeof cfg?.message === "string" ? cfg.message : String(exit);
	return raw.replace(/^error: found \d+ errors?\n+/, "").trim();
}

/** Run one command in-process and map its outcome back onto neverthrow (unit-test surface).
 * Accepts a single command (ok value = handler return) or a subcommands tree
 * (ok value = {command, value}); both unwrap to the handler's Result.
 */
export async function runDogsout<T>(cmd: Runnable, argv: string[]): Promise<Result<T, string>> {
	const r = await runSafely(cmd, argv);
	if (r._tag === "error") return err(parseErrorMessage(r.error));
	return unwrapRunnerOutput(r.value) as Result<T, string>;
}

/** Unwrap {command, value} once per subcommands nesting level down to the handler return. */
export function unwrapRunnerOutput(v: unknown): unknown {
	for (;;) {
		const w = v as { command?: unknown; value?: unknown };
		if (w !== null && typeof w === "object" && "command" in w && "value" in w && typeof w.command === "string") {
			v = w.value;
			continue;
		}
		return v;
	}
}

/**
 * The stdin/stdout seam that every terminal-touching command takes as its last parameter:
 * tests inject a fake, the entry uses `defaultIo`. It lives here, not in a command module,
 * because every command test imports it.
 */
export interface Io {
	stdin: () => Promise<string>;
	stdout: (line: string) => void;
	/** Warnings (legacy data, advisories) go here so stdout stays machine-readable. */
	stderr?: (line: string) => void;
	/** Is stdout a terminal? Commands with a human and a machine view branch on this; tests inject it. */
	tty?: boolean;
}

export const defaultIo: Io = {
	stdin: async () => await new Response(Bun.stdin).text(),
	stdout: (l) => console.log(l),
	stderr: (l) => console.error(l),
	tty: process.stdout.isTTY === true,
};
