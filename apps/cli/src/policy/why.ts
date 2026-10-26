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
import { command, option, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { activeSessionIds, ctxFromEnv, openVaultIfNeeded, refResolver } from "../context.ts";

/**
 * The hash a live run would compare: the stored value for a vault leaf, the RESOLVED value for a
 * ref-served address (so `value-changed` and grant matching read the truth). A resolve failure is
 * data, not a verdict — the caller prints it instead of pretending a decision was reached.
 */
async function whyCore(a: { alias: string; principal: string }): Promise<Result<string, string>> {
	const ctxR = ctxFromEnv();
	if (ctxR.isErr()) return err(ctxR.error);
	const ctx = ctxR.value;
	const cfg = await loadConfig(ctx.home);
	if (cfg.isErr()) return err(cfg.error);
	const grants = await loadGrants(ctx.home);
	if (grants.isErr()) return err(grants.error);
	const resolved = resolveToAddress(a.alias, cfg.value);
	if (resolved.isErr()) return err(resolved.error);
	const parsed = parseAddress(resolved.value.address);
	if (parsed.isErr()) return err(parsed.error);

	const ref = refFor(cfg.value, resolved.value.address);
	let valueHash: string;
	if (ref !== null) {
		const resolver = await refResolver();
		const batch = await resolver.resolve([ref]);
		if (batch.isErr()) return ok(a.alias + ": ERROR " + refFailureMessage(batch.error));
		const secret = batch.value.get(ref);
		if (secret === undefined) return ok(a.alias + ": ERROR 1password: no value for " + ref);
		valueHash = await sha256Hex(secret);
	} else {
		const data = await openVaultIfNeeded(ctx, true);
		if (data.isErr()) return err(data.error);
		const raw = data.value?.vaults[parsed.value.vault]?.[parsed.value.item]?.fields[parsed.value.field];
		valueHash = raw !== undefined ? await sha256Hex(raw) : "(missing)";
	}

	const v = evaluate({
		principal: a.principal,
		alias: a.alias,
		address: resolved.value.address,
		valueHash,
		rules: cfg.value.rules ?? [],
		grants: grants.value.grants,
		defaultDecision: cfg.value.settings?.default_decision ?? "ask",
		activeSessions: await activeSessionIds(ctx.home),
		now: new Date(),
	});
	const lines = [a.alias + ": " + v.kind + "  [" + v.via + "] " + v.reason];
	if (ref !== null) lines.push("  source: 1password ref " + ref);
	if (v.grant) {
		const left =
			v.grant.expires_at === null
				? "session-bound"
				: Math.max(0, Math.round((new Date(v.grant.expires_at).getTime() - Date.now()) / 60_000)) + "m left";
		lines.push(
			"  grant " + v.grant.id.slice(0, 8) + " ttl=" + v.grant.ttl + " via=" + v.grant.approved_via + " " + left,
		);
	}
	return ok(lines.join("\n"));
}

export function whyCommand() {
	return command({
		name: "why",
		description: "explain the current decision for one alias",
		args: {
			alias: option({ long: "alias", type: string, description: "alias to explain" }),
			principal: option({
				long: "principal",
				type: string,
				defaultValue: () => "cli@simulate",
				description: "requesting principal",
			}),
		},
		handler: whyCore,
	});
}
