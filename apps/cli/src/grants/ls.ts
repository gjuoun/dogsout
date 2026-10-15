import { jtkHome, loadGrants } from "@jtk/core";
import { command, option, optional, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { activeSessionIds } from "../context.ts";

async function grantsLsCore(a: { principal?: string | undefined }): Promise<Result<string, string>> {
	const file = await loadGrants(jtkHome());
	if (file.isErr()) return err(file.error);
	const active = await activeSessionIds(jtkHome());
	const now = new Date();
	const rows = file.value.grants
		.filter((g) => (a.principal ? g.principal === a.principal : true))
		.filter((g) => !g.consumed && (g.expires_at === null || new Date(g.expires_at) > now))
		.map((g) => {
			const left =
				g.expires_at === null
					? "session" + (active.includes(g.session ?? "") ? "" : " (closed)")
					: Math.round((new Date(g.expires_at).getTime() - now.getTime()) / 60_000) + "m";
			return g.principal + "  " + g.alias + "  ttl=" + g.ttl + "  " + left + "  via=" + g.approved_via;
		});
	return ok(rows.length > 0 ? rows.join("\n") : "(no live grants)");
}

export function grantsLsCommand() {
	return command({
		name: "ls",
		description: "list live grants",
		args: { principal: option({ long: "principal", type: optional(string), description: "filter by principal" }) },
		handler: grantsLsCore,
	});
}
