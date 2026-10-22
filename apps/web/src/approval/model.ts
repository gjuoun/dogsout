import type { AskRequest, Decision, PendingAsk } from "@jtk/api-client";

/**
 * The decision area's whole semantics, as pure functions — the mockup's rules, nothing else.
 * Source of truth for wording/labels: apps/ask/mockups/jtk-approve.swift and
 * apps/ask/helper/jtk-approve.swift (whose --selftest literal is the parity target).
 */

/** Six UI tiers; `session` is never offered in the picker (it is a manifest tier). */
export const TTL_TIERS = ["once", "10m", "1h", "24h", "30d", "always"] as const;
export type UiTier = (typeof TTL_TIERS)[number];

/** "本次" is the `once` tier; the rest are expiring tiers (always = 30d decay). */
export const TTL_LABELS: Record<UiTier, string> = {
	once: "本次",
	"10m": "10m",
	"1h": "1h",
	"24h": "24h",
	"30d": "30d",
	always: "长期",
};

/** Mockup default (2026-10-09 ruling): 10m. */
export const DEFAULT_UI_TIER: UiTier = "10m";

export type Choice = "approve" | "once" | "deny";

/** Per-key three-state, defaulting to 批准 for every new key (mockup). */
export function defaultChoices(request: AskRequest): Record<string, Choice> {
	const out: Record<string, Choice> = {};
	for (const key of request.keys) out[key.alias] = "approve";
	return out;
}

export function approvedCount(request: AskRequest, choices: Record<string, Choice>): number {
	return request.keys.filter((key) => (choices[key.alias] ?? "deny") !== "deny").length;
}

/**
 * The decision JSON. Byte-for-byte what the native helper emits for the same choices:
 * key order follows the request, `granted` rows never appear, and picking the 本次 tier
 * turns every "批准" into `once` (no grant is recorded for those).
 */
export function decisionFor(request: AskRequest, choices: Record<string, Choice>, tier: UiTier): Decision {
	const approved = approvedCount(request, choices) > 0;
	if (!approved) return { decision: "deny" };
	const keys: Record<string, "deny" | "once" | "ttl"> = {};
	for (const key of request.keys) {
		const choice = choices[key.alias] ?? "deny";
		keys[key.alias] = choice === "approve" && tier === "once" ? "once" : choice === "approve" ? "ttl" : choice;
	}
	return { decision: "approve", ttl: tier, renew_existing: false, keys };
}

/** Header time: ISO in, local readable out (the mockup shows a wall-clock stamp). */
export function headerTime(at: string): string {
	const d = new Date(at);
	if (Number.isNaN(d.getTime())) return at;
	return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** First pending ask, if any — the page shows one ask at a time (mockup semantics). */
export function firstPending(asks: PendingAsk[]): PendingAsk | undefined {
	return [...asks].sort((a, b) => a.at.localeCompare(b.at))[0];
}
