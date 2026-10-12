import type { GrantMeta } from "../../contracts/grant.ts";
import type { Rule } from "../../contracts/index.ts";

/** A policy verdict: what to do, which record decided it, and why (human-readable). */
export interface Verdict {
	kind: "allow" | "ask" | "deny";
	via: string;
	reason: string;
	matchedRule?: Rule;
	grant?: GrantMeta;
}

export interface EvaluateInput {
	principal: string;
	groups?: string[];
	alias: string;
	address: string;
	/** sha256 hex of the currently stored value — rotation detector. */
	valueHash: string;
	rules: Rule[];
	grants: GrantMeta[];
	defaultDecision: "allow" | "ask" | "deny";
	/** Session ids still open; session grants of closed sessions are dead. */
	activeSessions?: string[];
	now: Date;
}

/** Bare * matches everything (addresses contain /); otherwise real glob semantics (** crosses separators). */
function globMatch(pattern: string, text: string): boolean {
	if (pattern === "*") return true;
	return new Bun.Glob(pattern).match(text);
}

/** A rule matches when its principal glob hits the name or a group, and its resource glob hits the alias or address. */
export function ruleMatches(
	rule: Rule,
	input: Pick<EvaluateInput, "principal" | "groups" | "alias" | "address">,
): boolean {
	const principalHit =
		globMatch(rule.principal, input.principal) || (input.groups ?? []).some((g) => globMatch(rule.principal, g));
	if (!principalHit) return false;
	return globMatch(rule.resource, input.alias) || globMatch(rule.resource, input.address);
}

/** Last matching rule wins (ordered array, specific rules after general ones). */
export function lastMatchingRule(
	rules: Rule[],
	input: Pick<EvaluateInput, "principal" | "groups" | "alias" | "address">,
) {
	let found: Rule | undefined;
	for (const rule of rules) if (ruleMatches(rule, input)) found = rule;
	return found;
}

/**
 * ask_on gates an allow rule (policy-askon): "first-use" asks until this principal+alias
 * has any approval history; "value-changed" asks when history exists with a different
 * value fingerprint (rotation), even through a link.
 */
export function askOnTriggers(
	rule: Rule,
	history: Pick<EvaluateInput, "principal" | "alias" | "valueHash"> & { grants: GrantMeta[] },
): string[] {
	const askOn = rule.ask_on ?? [];
	if (askOn.length === 0) return [];
	const hits: string[] = [];
	const prior = history.grants.filter((g) => g.principal === history.principal && g.alias === history.alias);
	if (askOn.includes("first-use") && prior.length === 0) hits.push("first-use");
	if (askOn.includes("value-changed") && prior.some((g) => g.value_hash !== history.valueHash))
		hits.push("value-changed");
	return hits;
}

/** A grant is usable when not consumed, hash matches (rotation), not expired, and its session (if any) is still open. */
export function grantUsable(
	g: GrantMeta,
	valueHash: string,
	activeSessions: string[],
	now: Date,
): { ok: true } | { ok: false; why: string } {
	if (g.consumed) return { ok: false, why: "once-tier grant already consumed" };
	if (g.value_hash !== valueHash) return { ok: false, why: "value rotated (hash mismatch)" };
	if (g.session !== undefined && !activeSessions.includes(g.session)) return { ok: false, why: "session ended" };
	if (g.expires_at !== null && new Date(g.expires_at).getTime() <= now.getTime())
		return { ok: false, why: "grant expired" };
	return { ok: true };
}

/** Usable grant for exactly this principal+alias+value. */
function usableGrantFor(input: EvaluateInput): GrantMeta | undefined {
	const active = input.activeSessions ?? [];
	return input.grants.find(
		(g) =>
			g.principal === input.principal &&
			g.alias === input.alias &&
			grantUsable(g, input.valueHash, active, input.now).ok,
	);
}

/**
 * Pure evaluator — identical input must produce an identical verdict, live or simulated.
 * Precedence: deny rule > usable grant > allow rule > ask rule / default.
 */
export function evaluate(input: EvaluateInput): Verdict {
	const rule = lastMatchingRule(input.rules, input);

	if (rule?.decide === "deny") {
		return { kind: "deny", via: "rule:" + rule.id, reason: "denied by rule " + rule.id, matchedRule: rule };
	}

	const grant = usableGrantFor(input);
	if (grant) {
		return {
			kind: "allow",
			via: "grant:" + grant.id.slice(0, 8),
			reason: "approved earlier via " + grant.approved_via,
			grant,
		};
	}

	if (rule?.decide === "allow") {
		const triggers = askOnTriggers(rule, input);
		if (triggers.length > 0) {
			return {
				kind: "ask",
				via: "rule:" + rule.id,
				reason: "rule " + rule.id + " asks on " + triggers.join("+"),
				matchedRule: rule,
			};
		}
		return { kind: "allow", via: "rule:" + rule.id, reason: "allowed by rule " + rule.id, matchedRule: rule };
	}

	if (rule?.decide === "ask") {
		return { kind: "ask", via: "rule:" + rule.id, reason: "rule " + rule.id + " asks", matchedRule: rule };
	}

	return {
		kind: input.defaultDecision,
		via: "default",
		reason: "no rule matched; default_decision=" + input.defaultDecision,
	};
}
