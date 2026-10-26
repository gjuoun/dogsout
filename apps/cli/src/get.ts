import {
	digSubpath,
	formatAddress,
	loadConfig,
	maskHash,
	openData,
	type ParsedAddress,
	parseAddress,
	refFailureMessage,
	refFor,
	resolveToAddress,
} from "@dogsout/core";
import type { Config } from "@dogsout/type-contracts";
import { command, flag, positional, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { desugarAddress } from "./address-input.ts";
import { fail, runDogsout, withMeta } from "./cmd.ts";
import { ctxFromEnv, refResolver } from "./context.ts";

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

/** What `get` found: a stored value, or the reference serving the address plus its resolved value. */
export interface ReadResult {
	/** The stored value, or the value the reference resolved to. */
	value: string;
	/** Set when a config ref serves the address — printed, because a reference is not a secret. */
	ref?: string;
}

export async function readValue(name: string): Promise<Result<ReadResult, string>> {
	const ctxR = ctxFromEnv();
	if (ctxR.isErr()) return err(ctxR.error);
	const cfg = await loadConfig(ctxR.value.home);
	if (cfg.isErr()) return err(cfg.error);
	const target = await resolveInput(name, cfg.value);
	if (target.isErr()) return err(target.error);

	// A ref-served address is read through the service account and never opens the vault.
	const ref = refFor(cfg.value, formatAddress(target.value));
	if (ref !== null) {
		const resolver = await refResolver();
		const resolved = await resolver.resolve([ref]);
		if (resolved.isErr()) return err(refFailureMessage(resolved.error));
		const secret = resolved.value.get(ref);
		if (secret === undefined) return err("1password: no value for " + ref);
		const dug = digSubpath(secret, target.value.subpath);
		if (dug.isErr()) return err(dug.error);
		return ok({ value: dug.value, ref });
	}

	const opened = await openData(ctxR.value);
	if (opened.isErr()) return err(opened.error);
	const { vault, item, field, subpath } = target.value;
	const raw = opened.value.data.vaults[vault]?.[item]?.fields[field];
	if (raw === undefined) return fail(`not found: ${formatAddress(target.value)}`);
	const dug = digSubpath(raw, subpath);
	if (dug.isErr()) return err(dug.error);
	return ok({ value: dug.value });
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
				const found = await readValue(name);
				if (found.isErr()) return err(found.error);
				const { value, ref } = found.value;
				if (reveal) return ok(value);
				const digest = await maskHash(value);
				const suffix = `(${value.length} bytes, --reveal to show)`;
				// A reference is printed (it is a pointer, not a secret); the digest is of the RESOLVED
				// value, so an upstream rotation stays visible here.
				return ok(ref === undefined ? `${digest} ${suffix}` : `${ref} → ${digest} ${suffix}`);
			},
		}),
		{ reads: ["config", "vault"], writes: [], env: ["DOGSOUT_HOME", "DOGSOUT_SE_HELPER", "DOGSOUT_1P_HELPER"] },
	);
}

export async function runGet(argv: string[]): Promise<Result<string, string>> {
	return runDogsout<string>(getCommand(), argv);
}
