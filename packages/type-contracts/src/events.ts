import { z } from "zod";
import { AskRequestSchema, DecisionSchema, GrantedRowSchema } from "./ask.ts";

/**
 * WebSocket frames the WebUI consumes (PRD §4: shapes with no drizzle table behind them
 * are hand-written zod here, same single source as the ask contract).
 *
 * Everything is metadata-only: aliases, addresses, hashes, status labels — never values.
 * Frames are full snapshots on the grant/session channels (a client replaces, it never
 * merges), which keeps the browser reducer dumb and the API free of delta bookkeeping.
 */

/** Why the grant snapshot changed. "external" = the CLI wrote grants.json behind the API's back. */
export const GrantChangeReasonSchema = z.enum(["approval", "revoke", "consume", "session-end", "external"]);
export type GrantChangeReason = z.infer<typeof GrantChangeReasonSchema>;

/** A pending ask the WebUI can decide — WebUI-only shape; `id` is not part of the wire contract. */
export const PendingAskSchema = z.object({
	id: z.string().min(1),
	at: z.string().min(1),
	request: AskRequestSchema,
});
export type PendingAsk = z.infer<typeof PendingAskSchema>;

/** Read-only session row for the activity panel. */
export const SessionRowSchema = z.object({
	id: z.string().min(1),
	principal: z.string().min(1),
	opened_at: z.string().min(1),
});
export type SessionRow = z.infer<typeof SessionRowSchema>;

export const UiEventSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("ask.pending"), at: z.string().min(1), ask: PendingAskSchema }),
	z.object({ type: z.literal("ask.decided"), at: z.string().min(1), id: z.string().min(1), decision: DecisionSchema }),
	z.object({
		type: z.literal("grant.changed"),
		at: z.string().min(1),
		reason: GrantChangeReasonSchema,
		grants: z.array(GrantedRowSchema),
	}),
	z.object({ type: z.literal("session.changed"), at: z.string().min(1), sessions: z.array(SessionRowSchema) }),
]);
export type UiEvent = z.infer<typeof UiEventSchema>;

/** Parse with a plain first-issue message (boundary = plain data, like parseDecision). */
export function parseUiEvent(raw: unknown): { ok: true; event: UiEvent } | { ok: false; error: string } {
	const r = UiEventSchema.safeParse(raw);
	if (r.success) return { ok: true, event: r.data };
	const issue = r.error.issues[0] ?? { path: ["(root)"], message: "invalid ui event" };
	const where = issue.path.join(".") || "(root)";
	return { ok: false, error: where + ": " + issue.message };
}
