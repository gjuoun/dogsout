import { evaluate, loadGrants, parseAddress, resolveToAddress, sha256Hex } from "@dogsout/core";
import { command, option, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { activeSessionIds, ctxAndConfig, openDataOnce } from "../context.ts";

async function whyCore(a: { alias: string; principal: string }): Promise<Result<string, string>> {
	const ac = await ctxAndConfig();
	if (ac.isErr()) return err(ac.error);
	const { ctx, cfg } = ac.value;
	const opened = await openDataOnce(ctx);
	if (opened.isErr()) return err(opened.error);
	const grants = await loadGrants(ctx.home);
	if (grants.isErr()) return err(grants.error);
	const resolved = resolveToAddress(a.alias, cfg);
	if (resolved.isErr()) return err(resolved.error);
	const parsed = parseAddress(resolved.value.address);
	if (parsed.isErr()) return err(parsed.error);
	const raw = opened.value.data.vaults[parsed.value.vault]?.[parsed.value.item]?.fields[parsed.value.field];
	const valueHash = raw !== undefined ? await sha256Hex(raw) : "(missing)";
	const v = evaluate({
		principal: a.principal,
		alias: a.alias,
		address: resolved.value.address,
		valueHash,
		rules: cfg.rules ?? [],
		grants: grants.value.grants,
		defaultDecision: cfg.settings?.default_decision ?? "ask",
		activeSessions: await activeSessionIds(ctx.home),
		now: new Date(),
	});
	const lines = [a.alias + ": " + v.kind + "  [" + v.via + "] " + v.reason];
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
