import {
	digSubpath,
	formatAddress,
	loadConfig,
	maskHash,
	openData,
	type ParsedAddress,
	parseAddress,
	resolveToAddress,
} from "@dogsout/core";
import type { Config } from "@dogsout/type-contracts";
import { command, flag, positional, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { desugarAddress } from "./address-input.ts";
import { fail, runDogsout, withMeta } from "./cmd.ts";
import { ctxFromEnv } from "./context.ts";

/**
 * Resolve what the user typed: a canonical address, the jq-style sugar, or an alias/map slot.
 * A registered alias or map wins over a dotted name (they are authored); sugar is the fallback for
 * input that already looks like a path. A single bare word is never guessed into an address.
 */
async function resolveInput(name: string, cfg: Config): Promise<Result<ParsedAddress, string>> {
	const looksLikeAddress = name.startsWith("dogsout://") || name.startsWith(".") || name.includes(".");
	if (looksLikeAddress) {
		const direct = desugarAddress(name);
		if (direct.isOk()) return direct;
		if (cfg.aliases[name] === undefined && cfg.maps[name] === undefined) return err(direct.error);
	}
	const resolved = resolveToAddress(name, cfg);
	if (resolved.isErr()) return err(resolved.error);
	return parseAddress(resolved.value.address);
}

export async function readValue(name: string): Promise<Result<string, string>> {
	const ctxR = ctxFromEnv();
	if (ctxR.isErr()) return err(ctxR.error);
	const cfg = await loadConfig(ctxR.value.home);
	if (cfg.isErr()) return err(cfg.error);
	const target = await resolveInput(name, cfg.value);
	if (target.isErr()) return err(target.error);
	const opened = await openData(ctxR.value);
	if (opened.isErr()) return err(opened.error);
	const { vault, item, field, subpath } = target.value;
	const raw = opened.value.data.vaults[vault]?.[item]?.fields[field];
	if (raw === undefined) return fail(`not found: ${formatAddress(target.value)}`);
	return digSubpath(raw, subpath);
}

export function getCommand() {
	return withMeta(
		command({
			name: "get",
			description: "read a value (masked digest by default; --reveal prints plaintext)",
			args: {
				name: positional({ type: string, displayName: "alias|dogsout://vault/item/field|.vault.item.field" }),
				reveal: flag({ long: "reveal", description: "print the plaintext value to stdout" }),
			},
			handler: async ({ name, reveal }): Promise<Result<string, string>> => {
				const value = await readValue(name);
				if (value.isErr()) return err(value.error);
				if (reveal) return ok(value.value);
				const digest = await maskHash(value.value);
				return ok(`${digest} (${value.value.length} bytes, --reveal to show)`);
			},
		}),
		{ reads: ["config", "vault"], writes: [], env: ["DOGSOUT_HOME", "DOGSOUT_SE_HELPER"] },
	);
}

export async function runGet(argv: string[]): Promise<Result<string, string>> {
	return runDogsout<string>(getCommand(), argv);
}
