import { jtkHome, loadGrants, revokeByAlias } from "@jtk/core";
import { command, option, optional, positional, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";

async function grantsRmCore(a: { alias: string; principal?: string | undefined }): Promise<Result<string, string>> {
	const grants = await loadGrants(jtkHome());
	if (grants.isErr()) return err(grants.error);
	const targets = grants.value.grants.filter(
		(g) => g.alias === a.alias && (a.principal ? g.principal === a.principal : true),
	);
	if (targets.length === 0) return err("no grants for alias " + a.alias);
	let removed = 0;
	for (const t of targets) {
		const r = await revokeByAlias(jtkHome(), t.principal, t.alias);
		if (r.isErr()) return err(r.error);
		removed += r.value;
	}
	return ok("revoked " + removed + " grant(s) for " + a.alias + " — next request re-asks");
}

export function grantsRmCommand() {
	return command({
		name: "rm",
		description: "revoke grants for an alias",
		args: {
			alias: positional({ type: string, displayName: "ALIAS" }),
			principal: option({ long: "principal", type: optional(string), description: "filter by principal" }),
		},
		handler: grantsRmCore,
	});
}
