import { digSubpath, loadConfig, openData, parseAddress, resolveToAddress } from "@jtk/core";
import { command, flag, positional, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { fail, runJtk, withMeta } from "./cmd.ts";
import { ctxFromEnv } from "./context.ts";

export async function readValue(name: string): Promise<Result<string, string>> {
	const ctxR = ctxFromEnv();
	if (ctxR.isErr()) return err(ctxR.error);
	const cfg = await loadConfig(ctxR.value.home);
	if (cfg.isErr()) return err(cfg.error);
	const resolved = resolveToAddress(name, cfg.value);
	if (resolved.isErr()) return err(resolved.error);
	const parsed = parseAddress(resolved.value.address);
	if (parsed.isErr()) return err(parsed.error);
	const opened = await openData(ctxR.value);
	if (opened.isErr()) return err(opened.error);
	const { vault, item, field, subpath } = parsed.value;
	const raw = opened.value.data.vaults[vault]?.[item]?.fields[field];
	if (raw === undefined) return fail(`not found: ${resolved.value.address}`);
	return digSubpath(raw, subpath);
}

export function getCommand() {
	return withMeta(
		command({
			name: "get",
			description: "read a value (masked digest by default; --reveal prints plaintext)",
			args: {
				name: positional({ type: string, displayName: "alias|jtk://vault/item/field" }),
				reveal: flag({ long: "reveal", description: "print the plaintext value to stdout" }),
			},
			handler: async ({ name, reveal }): Promise<Result<string, string>> => {
				const value = await readValue(name);
				if (value.isErr()) return err(value.error);
				if (reveal) return ok(value.value);
				const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.value));
				const hex = Buffer.from(digest).toString("hex").slice(0, 8);
				return ok(`sha256:${hex} (${value.value.length} bytes, --reveal to show)`);
			},
		}),
		{ reads: ["config", "vault"], writes: [], env: ["JTK_HOME", "JTK_MASTER"] },
	);
}

export async function runGet(argv: string[]): Promise<Result<string, string>> {
	return runJtk<string>(getCommand(), argv);
}
