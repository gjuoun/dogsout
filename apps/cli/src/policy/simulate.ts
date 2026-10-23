import { evaluate, loadGrants, parseAddress, resolveToAddress, sha256Hex } from "@dogsout/core";
import { array, command, multioption, option, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { activeSessionIds, ctxAndConfig, openDataOnce } from "../context.ts";

async function simulateCore(a: {
	principal: string;
	group: string[];
	alias: string[];
}): Promise<Result<string, string>> {
	const ac = await ctxAndConfig();
	if (ac.isErr()) return err(ac.error);
	const { ctx, cfg } = ac.value;
	const opened = await openDataOnce(ctx);
	if (opened.isErr()) return err(opened.error);
	const grants = await loadGrants(ctx.home);
	if (grants.isErr()) return err(grants.error);
	const targets = a.alias.length > 0 ? a.alias : Object.keys(cfg.aliases);
	if (targets.length === 0) return err("no aliases configured — nothing to simulate");

	const lines: string[] = [];
	for (const alias of targets) {
		const resolved = resolveToAddress(alias, cfg);
		if (resolved.isErr()) {
			lines.push(alias + ": ERROR " + resolved.error);
			continue;
		}
		const parsed = parseAddress(resolved.value.address);
		if (parsed.isErr()) {
			lines.push(alias + ": ERROR " + parsed.error);
			continue;
		}
		const raw = opened.value.data.vaults[parsed.value.vault]?.[parsed.value.item]?.fields[parsed.value.field];
		const valueHash = raw !== undefined ? await sha256Hex(raw) : "(missing)";
		const v = evaluate({
			principal: a.principal,
			groups: a.group,
			alias,
			address: resolved.value.address,
			valueHash,
			rules: cfg.rules ?? [],
			grants: grants.value.grants,
			defaultDecision: cfg.settings?.default_decision ?? "ask",
			activeSessions: await activeSessionIds(ctx.home),
			now: new Date(),
		});
		lines.push(alias + ": " + v.kind + "  [" + v.via + "] " + v.reason);
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
