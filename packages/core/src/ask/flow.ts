import type { AskRequest, Config, Decision, SessionManifest, TtlTier, VaultData } from "@dogsout/type-contracts";
import { err, ok, type Result } from "neverthrow";
import { digSubpath, parseAddress } from "../address.ts";
import { evaluate, type Verdict } from "../policy/evaluate.ts";
import { refFor } from "../refs.ts";
import { resolveToAddress } from "../resolve.ts";
import { consumeGrant, endSessionGrants, loadGrants, recordApproval } from "../session/grants.ts";
import { closeSession, loadSessions, openSession, recordApprovals, takeReplay } from "../session/session.ts";
import { type RefResolver, refFailureMessage } from "../vault/onepassword.ts";
import { type Channel, runAskChain } from "./channel.ts";
import { grantStatusLabel } from "./labels.ts";

export async function sha256Hex(v: string): Promise<string> {
	const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
	return Buffer.from(d).toString("hex");
}

export interface AskFlowInput {
	home: string;
	cfg: Config;
	/**
	 * The opened vault, or undefined when the caller proved every requested name is served by a
	 * config ref — that path never touches `vault.enc` and never asks for Touch ID.
	 */
	data?: VaultData | undefined;
	/** The 1Password resolver; required only when a name is served by a ref. */
	resolver?: RefResolver | undefined;
	principal: string;
	groups: string[];
	names: string[];
	channels: Channel[];
	/** Session invites record under this tier regardless of the picked one (manifest semantics). */
	forceTtl?: TtlTier;
	now?: Date;
	sessionId?: string;
	askBudgetMs: number;
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

export function readVaultValue(data: VaultData, address: string): Result<string, string> {
	const parsed = parseAddress(address);
	if (parsed.isErr()) return err(parsed.error);
	const { vault, item, field, subpath } = parsed.value;
	const raw = data.vaults[vault]?.[item]?.fields[field];
	if (raw === undefined) return err("not found: " + address);
	return digSubpath(raw, subpath);
}

function readFromVault(data: VaultData, address: string, name: string): Result<string, string> {
	const parsed = parseAddress(address);
	if (parsed.isErr()) return err(parsed.error);
	const { vault, item, field, subpath } = parsed.value;
	const raw = data.vaults[vault]?.[item]?.fields[field];
	if (raw === undefined) return err("not found for " + name + ": " + address);
	return digSubpath(raw, subpath);
}

/** One requested name after classification: a decided literal value, or a 1Password reference. */
interface Target {
	name: string;
	address: string;
	ref: string | null;
	subpath: string[];
	/** A literal value, or the value a reference resolved to. */
	value?: string;
	hash?: string;
}
/**
 * The F2 ask pipeline: evaluate every requested name against rules + grants, batch the
 * ask-decisions into one AskRequest through the channel chain, and return the injection map.
 * Denied or unresolvable keys abort the whole run — a half-injected child is never spawned.
 *
 * 1Password source (F6): an address served by a config ref is read only when the read cannot
 * change the verdict — the grant is already on record (rotation must be checked) or a rule
 * already says `allow`. A first-time `ask` therefore costs ZERO 1Password calls; the reference
 * is resolved in one batch after the human approves.
 */
export async function prepareRun(input: AskFlowInput): Promise<Result<AskFlowOutput, string>> {
	const now = input.now ?? new Date();
	const { defaultDecision, alwaysDecay } = settingsOf(input.cfg);

	const grantsFile = await loadGrants(input.home);
	if (grantsFile.isErr()) return err(grantsFile.error);
	const sessionsFile = await loadSessions(input.home);
	if (sessionsFile.isErr()) return err(sessionsFile.error);
	const activeSessions = sessionsFile.value.sessions.map((s) => s.id);
	const grants = grantsFile.value.grants;

	const verdicts: Record<string, Verdict> = {};
	const inject: Record<string, string> = {};
	const asked: string[] = [];
	const askKeys: Array<{ alias: string; address: string; valueHash: string; note: string; value?: string }> = [];

	// ---- classify every name: a vault value, or a reference the resolver must serve
	const targets: Target[] = [];
	for (const name of input.names) {
		const resolved = resolveToAddress(name, input.cfg);
		if (resolved.isErr()) return err(resolved.error);
		const address = resolved.value.address;
		const parsed = parseAddress(address);
		if (parsed.isErr()) return err(parsed.error);
		const subpath = parsed.value.subpath;
		const ref = refFor(input.cfg, address);
		if (ref !== null) {
			targets.push({ name, address, ref, subpath });
			continue;
		}
		if (input.data === undefined) {
			return err(`vault not opened for ${name}: ${address} is not served by a 1password ref`);
		}
		const value = readFromVault(input.data, address, name);
		if (value.isErr()) return err(value.error);
		const target: Target = { name, address, ref: null, subpath, value: value.value };
		target.hash = await sha256Hex(value.value);
		targets.push(target);
	}

	const decisionOf = (t: Target, valueHash: string) =>
		evaluate({
			principal: input.principal,
			groups: input.groups,
			alias: t.name,
			address: t.address,
			valueHash,
			rules: input.cfg.rules ?? [],
			grants,
			defaultDecision,
			activeSessions,
			now,
		});

	// ---- decide what may be read before the approval window
	const early: Target[] = [];
	const held: Target[] = [];
	for (const t of targets) {
		if (t.ref === null) continue;
		const hasHistory = grants.some((g) => g.principal === input.principal && g.alias === t.name);
		if (hasHistory) {
			early.push(t);
			continue;
		}
		// No approval history: the hash cannot match a grant, so the placeholder only decides whether
		// a rule already authorises the read. Anything else waits for the human.
		const placeholder = await sha256Hex(t.ref);
		const gate = decisionOf(t, placeholder);
		if (gate.kind === "deny") return err("denied: " + t.name + " — " + gate.reason + " (fail-closed, run aborted)");
		if (gate.kind === "ask") held.push(t);
		else early.push(t);
	}

	// ---- one batched read for every reference the policy already permits
	if (early.length > 0) {
		const resolved = await resolveTargets(input.resolver, early);
		if (resolved.isErr()) return err(resolved.error);
	}

	// ---- verdicts, now that every early value is known
	for (const t of targets) {
		if (t.ref !== null && t.value === undefined) continue; // held: no hash yet
		const hash = t.hash as string;
		const verdict = decisionOf(t, hash);
		verdicts[t.name] = verdict;
		if (verdict.kind === "deny") {
			return err("denied: " + t.name + " — " + verdict.reason + " (fail-closed, run aborted)");
		}
		if (verdict.kind === "allow") {
			if (verdict.grant && verdict.grant.ttl === "once") {
				const c = await consumeGrant(input.home, verdict.grant.id);
				if (c.isErr()) return err(c.error);
			}
			inject[t.name] = t.value as string;
			continue;
		}
		askKeys.push({
			alias: t.name,
			address: t.address,
			valueHash: hash,
			note: t.address,
			value: t.value as string,
		});
	}
	for (const t of held) {
		// The reference is not resolved yet: the request carries the reference digest, and the
		// grant records the resolved value's digest once the read happens.
		const placeholder = await sha256Hex(t.ref as string);
		verdicts[t.name] = decisionOf(t, placeholder);
		askKeys.push({
			alias: t.name,
			address: t.address,
			valueHash: placeholder,
			note: t.address + " · 1password ref, resolves after approval",
		});
	}

	if (askKeys.length > 0) {
		const grantedRows = grants
			.filter((g) => g.principal === input.principal && grantAlive(g, activeSessions, now))
			.map((g) => ({ alias: g.alias, status: grantStatusLabel(g, now) }));

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

		// Approved: resolve whatever is still a reference, in ONE batch.
		const stillHeld = held.filter((t) => t.value === undefined);
		if (stillHeld.length > 0) {
			const resolved = await resolveTargets(input.resolver, stillHeld);
			if (resolved.isErr()) return err(resolved.error);
		}
		for (const k of askKeys) {
			const t = targets.find((x) => x.name === k.alias) as Target;
			k.valueHash = t.hash as string;
			k.value = t.value as string;
		}

		const applied = await applyDecision(input, decision.value, askKeys, alwaysDecay, now);
		if (applied.isErr()) return err(applied.error);
		for (const k of askKeys) {
			const choice = decision.value.keys[k.alias];
			if (choice === "deny") return err("denied by approver: " + k.alias + " (fail-closed, run aborted)");
			inject[k.alias] = k.value as string;
			if (choice !== undefined) asked.push(k.alias);
		}
	}

	return ok({ inject, asked, verdicts });
}

/** Resolve a set of reference targets in one batch and fill value/hash (subpath applied after). */
async function resolveTargets(resolver: RefResolver | undefined, targets: Target[]): Promise<Result<void, string>> {
	if (targets.length === 0) return ok(undefined);
	if (resolver === undefined) {
		return err(
			"1password: no resolver configured for " +
				targets.map((t) => t.name).join(", ") +
				" — this call site does not wire the 1Password adapter",
		);
	}
	const refs = [...new Set(targets.map((t) => t.ref as string))];
	const resolved = await resolver.resolve(refs);
	if (resolved.isErr()) return err(refFailureMessage(resolved.error));
	for (const t of targets) {
		const secret = resolved.value.get(t.ref as string);
		if (secret === undefined) return err("1password: no value for " + (t.ref as string));
		const dug = digSubpath(secret, t.subpath);
		if (dug.isErr()) return err("1password: " + t.ref + ": " + dug.error);
		t.value = dug.value;
		t.hash = await sha256Hex(dug.value);
	}
	return ok(undefined);
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
