import type { AskRequest, KeyChoice, TtlTier } from "@jtk/type-contracts";

/**
 * In-memory registry of asks waiting for a human. Deliberately not persisted: a pending
 * ask is a live request whose caller is blocked on it, so surviving a restart is
 * meaningless (that caller already failed closed). The durable record is `ask_log`.
 */
export interface PendingOutcome {
	decision: "approve" | "deny";
	ttl?: TtlTier | undefined;
	keys?: Record<string, KeyChoice> | undefined;
}

export interface PendingEntry {
	id: string;
	at: string;
	request: AskRequest;
	/** Resolves the blocked POST /ask. */
	settle: (outcome: PendingOutcome) => void;
}

const pending = new Map<string, PendingEntry>();

export function addPending(entry: PendingEntry): void {
	pending.set(entry.id, entry);
}

export function getPending(id: string): PendingEntry | undefined {
	return pending.get(id);
}

export function listPending(): PendingEntry[] {
	return [...pending.values()].sort((a, b) => a.at.localeCompare(b.at));
}

/** Remove and return — the single way an ask leaves the registry (decided or timed out). */
export function takePending(id: string): PendingEntry | undefined {
	const entry = pending.get(id);
	if (entry) pending.delete(id);
	return entry;
}

/** Test seam: a fresh process starts empty anyway. */
export function clearPending(): void {
	pending.clear();
}
