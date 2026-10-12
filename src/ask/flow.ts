import { err, ok, type Result } from "neverthrow";
import type { AskRequest, Decision, TtlTier } from "../../contracts/ask.ts";
import type { Config } from "../../contracts/index.ts";
import type { SessionManifest } from "../../contracts/session.ts";
import type { VaultData } from "../../contracts/vault.ts";
import { digSubpath, parseAddress } from "../cli/address.ts";
import { resolveToAddress } from "../cli/map.ts";
import { evaluate, type Verdict } from "../policy/evaluate.ts";
import { consumeGrant, endSessionGrants, loadGrants, recordApproval } from "../session/grants.ts";
import { closeSession, loadSessions, openSession, recordApprovals, takeReplay } from "../session/session.ts";
import { type Channel, runAskChain } from "./channel.ts";

export async function sha256Hex(v: string): Promise<string> {
	const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
	return Buffer.from(d).toString("hex");
}

export interface AskFlowInput {
	home: string;
	cfg: Config;
	data: VaultData;
	principal: string;
	groups: string[];
	names: string[];
	channels: Channel[];
	askBudgetMs: number;
	sessionId?: string;
	/** Session invites record under this tier regardless of the picked one (manifest semantics). */
	forceTtl?: TtlTier;
	now?: Date;
}

export interface AskFlowOutput {
	inject: Record<string, string>;
	asked: string[];
	verdicts: Record<string, Verdict>;
}

function settingsOf(cfg: Config) {
	const s = cfg.settings;
	return {
		defaultDecision: s?.default_decision ?? "ask",
		alwaysDecay: s?.always_decay ?? "720h",
	};
}

function remainingLabel(expiresAt: string | null, sessionBound: boolean, now: Date): string {
	if (sessionBound) return "session";
	if (expiresAt === null) return "no expiry";
	const ms = new Date(expiresAt).getTime() - now.getTime();
	if (ms <= 0) return "expired";
	const mins = Math.round(ms / 60_000);
	if (mins < 60) return "剩 " + mins + "m";
	const hours = Math.round(mins / 60);
	if (hours < 48) return "剩 " + hours + "h";
	return "剩 " + Math.round(hours / 24) + "d";
}

export function readVaultValue(data: VaultData, address: string): Result<string, string> {
	const parsed = parseAddress(address);
	if (parsed.isErr()) return err(parsed.error);
	const { vault, item, field, subpath } = parsed.value;
	const raw = data.vaults[vault]?.[item]?.fields[field];
	if (raw === undefined) return err("not found: " + address);
	return digSubpath(raw, subpath);
}

function readFromVault(data: VaultData, address: string, now: Date, name: string): Result<string, string> {
	const parsed = parseAddress(address);
	if (parsed.isErr()) return err(parsed.error);
	const { vault, item, field, subpath } = parsed.value;
	const raw = data.vaults[vault]?.[item]?.fields[field];
	if (raw === undefined) return err("not found for " + name + ": " + address);
	return digSubpath(raw, subpath);
}

/**
 * The F2 ask pipeline: evaluate every requested name against rules + grants,
 * batch the ask-decisions into one AskRequest through the channel chain, and
 * return the injection map. Denied or unresolvable keys abort the whole run —
 * a half-injected child is never spawned (fail-closed).
 */
export async function prepareRun(input: AskFlowInput): Promise<Result<AskFlowOutput, string>> {
	const now = input.now ?? new Date();
	const { defaultDecision, alwaysDecay } = settingsOf(input.cfg);

	const grantsFile = await loadGrants(input.home);
	if (grantsFile.isErr()) return err(grantsFile.error);
	const sessionsFile = await loadSessions(input.home);
	if (sessionsFile.isErr()) return err(sessionsFile.error);
	const activeSessions = sessionsFile.value.sessions.map((s) => s.id);

	const verdicts: Record<string, Verdict> = {};
	const inject: Record<string, string> = {};
	const askKeys: Array<{ alias: string; address: string; valueHash: string; value: string; note: string }> = [];

	for (const name of input.names) {
		const resolved = resolveToAddress(name, input.cfg);
		if (resolved.isErr()) return err(resolved.error);
		const value = readFromVault(input.data, resolved.value.address, now, name);
		if (value.isErr()) return err(value.error);
		const valueHash = await sha256Hex(value.value);

		const verdict = evaluate({
			principal: input.principal,
			groups: input.groups,
			alias: name,
			address: resolved.value.address,
			valueHash,
			rules: input.cfg.rules ?? [],
			grants: grantsFile.value.grants,
			defaultDecision,
			activeSessions,
			now,
		});
		verdicts[name] = verdict;

		if (verdict.kind === "deny") {
			return err("denied: " + name + " — " + verdict.reason + " (fail-closed, run aborted)");
		}
		if (verdict.kind === "allow") {
			if (verdict.grant && verdict.grant.ttl === "once") {
				const c = await consumeGrant(input.home, verdict.grant.id);
				if (c.isErr()) return err(c.error);
			}
			inject[name] = value.value;
		} else {
			askKeys.push({
				alias: name,
				address: resolved.value.address,
				valueHash,
				value: value.value,
				note: resolved.value.address,
			});
		}
	}

	const asked: string[] = [];
	if (askKeys.length > 0) {
		const grantedRows = grantsFile.value.grants
			.filter((g) => g.principal === input.principal && grantAlive(g, activeSessions, now))
			.map((g) => ({ alias: g.alias, status: remainingLabel(g.expires_at, g.session !== undefined, now) }));

		const request: AskRequest = {
			principal: input.principal,
			session: input.sessionId ?? "adhoc_" + crypto.randomUUID().slice(0, 8),
			at: now.toISOString(),
			keys: askKeys.map((k) => ({
				alias: k.alias,
				address: k.address,
				note: k.note,
				value_hash: k.valueHash.slice(0, 12),
			})),
			granted: grantedRows,
		};
		const decision = await runAskChain(input.channels, request, input.askBudgetMs);
		if (decision.isErr())
			return err(
				"ask failed for [" + askKeys.map((k) => k.alias).join(", ") + "] — " + decision.error + " (fail-closed)",
			);
		if (decision.value.decision === "deny") {
			return err("denied by approver: [" + askKeys.map((k) => k.alias).join(", ") + "] (fail-closed, run aborted)");
		}
		const applied = await applyDecision(input, decision.value, askKeys, alwaysDecay, now);
		if (applied.isErr()) return err(applied.error);
		for (const k of askKeys) {
			const choice = decision.value.keys[k.alias];
			if (choice === "deny") return err("denied by approver: " + k.alias + " (fail-closed, run aborted)");
			inject[k.alias] = k.value;
			if (choice !== undefined) asked.push(k.alias);
		}
	}

	return ok({ inject, asked, verdicts });
}

function grantAlive(
	g: { expires_at: string | null; session?: string | undefined },
	_active: string[],
	_now: Date,
): boolean {
	return g.expires_at !== null;
}

async function applyDecision(
	input: AskFlowInput,
	decision: Extract<Decision, { decision: "approve" }>,
	askKeys: Array<{ alias: string; address: string; valueHash: string }>,
	alwaysDecay: string,
	now: Date,
): Promise<Result<void, string>> {
	for (const k of askKeys) {
		const choice = decision.keys[k.alias];
		if (choice === "ttl" || input.forceTtl !== undefined) {
			const r = await recordApproval(
				input.home,
				{
					principal: input.principal,
					alias: k.alias,
					address: k.address,
					valueHash: k.valueHash,
					ttl: input.forceTtl ?? decision.ttl,
					via: "ask",
					...(input.sessionId !== undefined ? { session: input.sessionId } : {}),
				},
				{ always_decay: alwaysDecay },
				now,
			);
			if (r.isErr()) return err(r.error);
		}
	}
	return ok(undefined);
}

/**
 * Session opening: batch-invite manifest keys (one approval window, session tier),
 * optionally replaying the last approval list once (--resume). Returns the session id.
 */
export async function openSessionFlow(home: string, manifest: SessionManifest): Promise<Result<string, string>> {
	const r = await openSession(home, manifest);
	if (r.isErr()) return err(r.error);
	return ok(manifest.id);
}

export async function resumeReplayFlow(home: string, sessionId: string): Promise<Result<string[], string>> {
	return await takeReplay(home, sessionId);
}

export async function recordApprovalsFlow(
	home: string,
	sessionId: string,
	aliases: string[],
): Promise<Result<void, string>> {
	return await recordApprovals(home, sessionId, aliases);
}

/** Session end: withdraw session grants and drop the record (the run is over). */
export async function closeSessionFlow(home: string, sessionId: string): Promise<Result<void, string>> {
	const g = await endSessionGrants(home, sessionId);
	if (g.isErr()) return err(g.error);
	const c = await closeSession(home, sessionId);
	if (c.isErr()) return err(c.error);
	return ok(undefined);
}
