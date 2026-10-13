import { z } from "zod";

/**
 * AskChannel contract (PRD §3) — the single JSON shape every approval channel
 * consumes and emits. Formalized from the validated mockup (mockups/jtk-approve.swift,
 * PR #4); the helper's --selftest literals are the reference fixtures.
 */

/** UI six tiers + manifest-only session tier; always = fixed 30d expiry (always_decay configurable). */
export const TtlTierSchema = z.enum(["session", "once", "10m", "1h", "24h", "30d", "always"]);
export type TtlTier = z.infer<typeof TtlTierSchema>;

/** Default tier when a decision does not pick one (mockup default 10m, 2026-10-09 ruling). */
export const DEFAULT_TTL: TtlTier = "10m";

/** Human-readable order for the six UI tiers (session is never offered in a picker). */
export const TTL_UI_TIERS: readonly TtlTier[] = ["once", "10m", "1h", "24h", "30d", "always"] as const;

/** Per-key three-state choice (mockup ruling A): deny / once (no grant) / ttl (grant under the chosen tier). */
export const KeyChoiceSchema = z.enum(["deny", "once", "ttl"]);
export type KeyChoice = z.infer<typeof KeyChoiceSchema>;

/** A key the agent is asking to use this time (decision area of the window). */
export const AskedKeySchema = z.object({
	alias: z.string().min(1),
	address: z.string().min(1),
	note: z.string().default(""),
	value_hash: z.string().default(""),
});
export type AskedKey = z.infer<typeof AskedKeySchema>;

/** Read-only row for keys the session already holds (display only; never part of a Decision). */
export const GrantedRowSchema = z.object({
	alias: z.string().min(1),
	status: z.string().min(1),
});
export type GrantedRow = z.infer<typeof GrantedRowSchema>;

/** What jtk writes for the channel to render (mockup AskRequest). */
export const AskRequestSchema = z.object({
	principal: z.string().min(1),
	session: z.string().min(1),
	at: z.string().min(1),
	keys: z.array(AskedKeySchema).min(1),
	granted: z.array(GrantedRowSchema).default([]),
});
export type AskRequest = z.infer<typeof AskRequestSchema>;

/**
 * Channel output. Approve carries a global ttl plus per-key choices
 * mapping alias to deny/once/ttl; deny is bare — no key map.
 * renew_existing and "keep" are F3 reservations; F2 writers always send false.
 */
export const DecisionSchema = z.union([
	z.object({
		decision: z.literal("approve"),
		ttl: TtlTierSchema,
		renew_existing: z.boolean(),
		keys: z.record(z.string(), KeyChoiceSchema),
	}),
	z.object({ decision: z.literal("deny") }),
]);
export type Decision = z.infer<typeof DecisionSchema>;

/** Parse with a plain first-issue message (boundary = plain data, like parseConfig). */
export function parseDecision(raw: unknown): { ok: true; decision: Decision } | { ok: false; error: string } {
	const r = DecisionSchema.safeParse(raw);
	if (r.success) return { ok: true, decision: r.data };
	const issue = r.error.issues[0] ?? { path: ["(root)"], message: "invalid decision" };
	const where = issue.path.join(".") || "(root)";
	return { ok: false, error: where + ": " + issue.message };
}

export function parseAskRequest(raw: unknown): { ok: true; request: AskRequest } | { ok: false; error: string } {
	const r = AskRequestSchema.safeParse(raw);
	if (r.success) return { ok: true, request: r.data };
	const issue = r.error.issues[0] ?? { path: ["(root)"], message: "invalid ask request" };
	const where = issue.path.join(".") || "(root)";
	return { ok: false, error: where + ": " + issue.message };
}
