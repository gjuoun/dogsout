import {
	evaluate,
	loadConfig,
	loadGrants,
	parseAddress,
	refFailureMessage,
	refFor,
	resolveToAddress,
	sha256Hex,
} from "@dogsout/core";
import { array, command, multioption, option, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { activeSessionIds, ctxFromEnv, openVaultIfNeeded, refResolver } from "../context.ts";

async function simulateCore(a: {
	principal: string;
	group: string[];
	alias: string[];
}): Promise<Result<string, string>> {
	const ctxR = ctxFromEnv();
	if (ctxR.isErr()) return err(ctxR.error);
	const ctx = ctxR.value;
	const cfg = await loadConfig(ctx.home);
	if (cfg.isErr()) return err(cfg.error);
	const grants = await loadGrants(ctx.home);
	if (grants.isErr()) return err(grants.error);
	const targets = a.alias.length > 0 ? a.alias : Object.keys(cfg.value.aliases);
	if (targets.length === 0) return err("no aliases configured — nothing to simulate");

	// Resolve every ref in ONE batch, and open the vault only when some alias is not ref-served.
	const prepared = targets.map((alias) => ({ alias, resolved: resolveToAddress(alias, cfg.value) }));
	const refPlan = new Map<string, string>();
	for (const p of prepared) {
		if (p.resolved.isErr()) continue;
		const ref = refFor(cfg.value, p.resolved.value.address);
		if (ref !== null) refPlan.set(p.alias, ref);
	}
	const needsVault = prepared.some((p) => p.resolved.isOk() && !refPlan.has(p.alias));
	const data = await openVaultIfNeeded(ctx, needsVault);
	if (data.isErr()) return err(data.error);
	const values = new Map<string, string>();
	const errors = new Map<string, string>();
	if (refPlan.size > 0) {
		const resolver = await refResolver();
		const batch = await resolver.resolve([...new Set(refPlan.values())]);
		if (batch.isErr()) {
			for (const alias of refPlan.keys()) errors.set(alias, refFailureMessage(batch.error));
		} else {
			for (const [alias, ref] of refPlan) {
				const secret = batch.value.get(ref);
				if (secret === undefined) errors.set(alias, "1password: no value for " + ref);
				else values.set(alias, secret);
			}
		}
	}

	const lines: string[] = [];
	for (const { alias, resolved } of prepared) {
		if (resolved.isErr()) {
			lines.push(alias + ": ERROR " + resolved.error);
			continue;
		}
		const failed = errors.get(alias);
		if (failed !== undefined) {
			lines.push(alias + ": ERROR " + failed);
			continue;
		}
		const parsed = parseAddress(resolved.value.address);
		if (parsed.isErr()) {
			lines.push(alias + ": ERROR " + parsed.error);
			continue;
		}
		const resolvedValue = values.get(alias);
		const raw =
			resolvedValue !== undefined
				? resolvedValue
				: data.value?.vaults[parsed.value.vault]?.[parsed.value.item]?.fields[parsed.value.field];
		const valueHash = raw !== undefined ? await sha256Hex(raw) : "(missing)";
		const v = evaluate({
			principal: a.principal,
			groups: a.group,
			alias,
			address: resolved.value.address,
			valueHash,
			rules: cfg.value.rules ?? [],
			grants: grants.value.grants,
			defaultDecision: cfg.value.settings?.default_decision ?? "ask",
			activeSessions: await activeSessionIds(ctx.home),
			now: new Date(),
		});
		const source = resolvedValue !== undefined ? "  (1password ref)" : "";
		lines.push(alias + ": " + v.kind + "  [" + v.via + "] " + v.reason + source);
	}
	return ok(lines.join("\n"));
}

export function simulateCommand() {
	return command({
		name: "simulate",
		description: "preview decisions for aliases (nothing granted, nothing revealed)",
		args: {
			principal: option({
				long: "principal",
				type: string,
				defaultValue: () => "cli@simulate",
				description: "requesting principal",
			}),
			group: multioption({ long: "group", type: array(string), description: "principal group (repeatable)" }),
			alias: multioption({
				long: "alias",
				type: array(string),
				description: "alias to preview (repeatable; default all)",
			}),
		},
		handler: simulateCore,
	});
}
