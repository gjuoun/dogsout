import { desc, eq } from "drizzle-orm";
import type { ApiDb } from "./client.ts";
import { type AskLogRow, askLog } from "./schema.ts";

export interface AskRecordInput {
	id: string;
	principal: string;
	sessionId?: string | undefined;
	requestedAt: string;
	keys: readonly unknown[];
}

export interface AskDecisionInput {
	decision: "approve" | "deny";
	ttl?: string | undefined;
	via: string;
	at: string;
}

/** Open an ask row the moment the request arrives; its decision lands later. */
export function insertAsk(db: ApiDb, input: AskRecordInput): void {
	db.insert(askLog)
		.values({
			id: input.id,
			principal: input.principal,
			session_id: input.sessionId ?? null,
			requested_at: input.requestedAt,
			keys_json: JSON.stringify(input.keys),
			key_count: input.keys.length,
			decision: "deny",
		})
		.run();
}

/** Record the outcome. A timeout is a deny with `via: "timeout"` — fail-closed, never silent. */
export function decideAsk(db: ApiDb, id: string, input: AskDecisionInput): void {
	db.update(askLog)
		.set({
			decision: input.decision,
			ttl: input.ttl ?? null,
			decided_at: input.at,
			decided_via: input.via,
		})
		.where(eq(askLog.id, id))
		.run();
}

export function listRecent(db: ApiDb, limit = 50): AskLogRow[] {
	return db
		.select()
		.from(askLog)
		.orderBy(desc(askLog.requested_at))
		.limit(Math.max(1, Math.min(200, limit)))
		.all();
}
