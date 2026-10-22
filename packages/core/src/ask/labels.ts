import type { GrantMeta } from "@jtk/type-contracts";

/**
 * Status label for a read-only "already held" row. Wording is the mockup's
 * (apps/ask/mockups/jtk-approve.swift): `session` / `剩 47m` / `长期·30d衰减`.
 * Shared by the approval request builder (swiftui/cli/webui all render this) and the
 * WebUI grant snapshot, so the two channels cannot drift apart.
 */
export function grantStatusLabel(
	grant: Pick<GrantMeta, "ttl" | "expires_at" | "session" | "consumed">,
	now: Date,
): string {
	if (grant.session !== undefined) return "session";
	if (grant.ttl === "always") return "长期·30d衰减";
	if (grant.ttl === "once") return grant.consumed ? "本次·已用完" : "本次·未使用";
	if (grant.expires_at === null) return "no expiry";
	const ms = new Date(grant.expires_at).getTime() - now.getTime();
	if (ms <= 0) return "expired";
	const mins = Math.round(ms / 60_000);
	if (mins < 60) return "剩 " + mins + "m";
	const hours = Math.round(mins / 60);
	if (hours < 48) return "剩 " + hours + "h";
	return "剩 " + Math.round(hours / 24) + "d";
}
