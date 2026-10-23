import { grantStatusLabel, loadGrants, loadSessions } from "@dogsout/core";
import type { UiEvent } from "@dogsout/type-contracts";

/**
 * Snapshot frames, not deltas: the browser replaces its grant/session view wholesale, so
 * the API never has to track per-client state and a reconnect is automatically correct.
 */
export async function grantEvent(home: string, reason: "approval" | "external", now = new Date()): Promise<UiEvent> {
	const file = await loadGrants(home);
	const grants = file.isOk()
		? file.value.grants.map((g) => ({ alias: g.alias, status: grantStatusLabel(g, now) }))
		: [];
	return { type: "grant.changed", at: now.toISOString(), reason, grants };
}

export async function sessionEvent(home: string, now = new Date()): Promise<UiEvent> {
	const file = await loadSessions(home);
	const sessions = file.isOk()
		? file.value.sessions.map((s) => ({ id: s.id, principal: s.principal, opened_at: s.opened_at }))
		: [];
	return { type: "session.changed", at: now.toISOString(), sessions };
}

export async function snapshots(home: string): Promise<UiEvent[]> {
	return [await grantEvent(home, "external"), await sessionEvent(home)];
}
