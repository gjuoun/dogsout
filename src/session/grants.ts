import { err, ok, type Result } from "neverthrow";
import type { TtlTier } from "../../contracts/ask.ts";
import type { Settings } from "../../contracts/config.ts";
import { type GrantMeta, type GrantsFile, parseGrantsFile } from "../../contracts/grant.ts";
import { grantsPath } from "../cli/paths.ts";
import { expiryFor } from "../policy/ttl.ts";

export interface Approval {
	principal: string;
	alias: string;
	address: string;
	valueHash: string;
	ttl: TtlTier;
	via: string;
	session?: string;
}

function randomId(prefix: string): string {
	return prefix + "_" + crypto.randomUUID().replaceAll("-", "").slice(0, 12);
}

export async function loadGrants(home: string): Promise<Result<GrantsFile, string>> {
	const path = grantsPath(home);
	const file = Bun.file(path);
	if (!(await file.exists())) return ok({ version: 1, grants: [] });
	let raw: unknown;
	try {
		raw = JSON.parse(await file.text());
	} catch {
		return err("grants.json is not valid JSON");
	}
	const parsed = parseGrantsFile(raw);
	return parsed.ok ? ok(parsed.file) : err(parsed.error);
}

export async function saveGrants(home: string, file: GrantsFile): Promise<Result<void, string>> {
	try {
		const path = grantsPath(home);
		const tmp = path + ".tmp." + process.pid;
		await Bun.write(tmp, JSON.stringify(file, null, 2));
		const { chmodSync, renameSync } = await import("node:fs");
		chmodSync(tmp, 0o600);
		renameSync(tmp, path);
		return ok(undefined);
	} catch (e) {
		return err(String(e));
	}
}

/** Record an approval; once-tier grants start consumed=false and are consumed on first use. */
export async function recordApproval(
	home: string,
	approval: Approval,
	settings: Pick<Settings, "always_decay">,
	now: Date = new Date(),
): Promise<Result<GrantMeta, string>> {
	const file = await loadGrants(home);
	if (file.isErr()) return err(file.error);
	const grant: GrantMeta = {
		id: randomId("g"),
		principal: approval.principal,
		alias: approval.alias,
		address: approval.address,
		value_hash: approval.valueHash,
		ttl: approval.ttl,
		approved_via: approval.via,
		approved_at: now.toISOString(),
		expires_at: expiryFor(approval.ttl, now, { always_decay: settings.always_decay }),
		session: approval.session,
		consumed: false,
	};
	file.value.grants.push(grant);
	const saved = await saveGrants(home, file.value);
	if (saved.isErr()) return err(saved.error);
	return ok(grant);
}

/** Mark a once-tier grant consumed (single use). */
export async function consumeGrant(home: string, grantId: string): Promise<Result<void, string>> {
	const file = await loadGrants(home);
	if (file.isErr()) return err(file.error);
	const g = file.value.grants.find((x) => x.id === grantId);
	if (!g) return err("grant not found: " + grantId);
	g.consumed = true;
	const saved = await saveGrants(home, file.value);
	return saved.isErr() ? err(saved.error) : ok(undefined);
}

/** Remove grants for an alias (grants rm) — next request falls back to ask. */
export async function revokeByAlias(home: string, principal: string, alias: string): Promise<Result<number, string>> {
	const file = await loadGrants(home);
	if (file.isErr()) return err(file.error);
	const before = file.value.grants.length;
	file.value.grants = file.value.grants.filter((g) => !(g.principal === principal && g.alias === alias));
	const removed = before - file.value.grants.length;
	const saved = await saveGrants(home, file.value);
	if (saved.isErr()) return err(saved.error);
	return ok(removed);
}

/** Session end: every grant bound to the session is withdrawn. */
export async function endSessionGrants(home: string, sessionId: string): Promise<Result<number, string>> {
	const file = await loadGrants(home);
	if (file.isErr()) return err(file.error);
	const before = file.value.grants.length;
	file.value.grants = file.value.grants.filter((g) => g.session !== sessionId);
	const removed = before - file.value.grants.length;
	const saved = await saveGrants(home, file.value);
	if (saved.isErr()) return err(saved.error);
	return ok(removed);
}
