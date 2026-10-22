// `AskLogRow` is drizzle-derived and only exists in the generated client; the frame
// shapes (and the read-only rows inside them) are the hand-written wire contract.
import type { AskLogRow } from "@jtk/api-client";
import type { GrantedRow, PendingAsk, SessionRow, UiEvent } from "@jtk/type-contracts";

/**
 * The activity panel is a pure fold over two inputs: the ask log (history) and the live
 * WS frames. Keeping it a reducer means the interesting behaviour — ordering, dedupe,
 * snapshot replacement, reconnect — is testable without a DOM or a socket.
 *
 * `grant.changed` / `session.changed` are full snapshots (replace, never merge), so a
 * reconnect that replays the snapshot heals whatever was missed.
 */

export type Connection = "connecting" | "open" | "closed";

export interface TimelineItem {
	id: string;
	at: string;
	principal: string;
	keyCount: number;
	decision: "approve" | "deny";
	via: string;
}

export interface PanelState {
	connection: Connection;
	timeline: TimelineItem[];
	pending: PendingAsk[];
	grants: GrantedRow[];
	sessions: SessionRow[];
}

export const initialPanelState: PanelState = {
	connection: "connecting",
	timeline: [],
	pending: [],
	grants: [],
	sessions: [],
};

export type PanelAction =
	| { type: "connection"; status: Connection }
	| { type: "history"; rows: AskLogRow[] }
	| { type: "event"; event: UiEvent; at: string };

function toItem(row: AskLogRow): TimelineItem {
	return {
		id: row.id,
		at: row.requested_at,
		principal: row.principal,
		keyCount: row.key_count,
		decision: row.decision === "approve" ? "approve" : "deny",
		via: row.decided_via ?? "pending",
	};
}

/** Newest first; a repeated id keeps the newest copy (history then live frame, or two frames). */
function upsert(items: TimelineItem[], item: TimelineItem): TimelineItem[] {
	const rest = items.filter((x) => x.id !== item.id);
	return [item, ...rest].sort((a, b) => b.at.localeCompare(a.at));
}

export function panelReducer(state: PanelState, action: PanelAction): PanelState {
	switch (action.type) {
		case "connection":
			return { ...state, connection: action.status };
		case "history":
			return { ...state, timeline: action.rows.map(toItem).sort((a, b) => b.at.localeCompare(a.at)) };
		case "event": {
			const { event } = action;
			switch (event.type) {
				case "ask.pending":
					return {
						...state,
						pending: [...state.pending.filter((p) => p.id !== event.ask.id), event.ask].sort((a, b) =>
							a.at.localeCompare(b.at),
						),
					};
				case "ask.decided": {
					const waiting = state.pending.find((p) => p.id === event.id);
					const item: TimelineItem = {
						id: event.id,
						at: waiting?.at ?? event.at,
						principal: waiting?.request.principal ?? "—",
						keyCount: waiting?.request.keys.length ?? 0,
						decision: event.decision.decision,
						via: "webui",
					};
					return {
						...state,
						timeline: upsert(state.timeline, item),
						pending: state.pending.filter((p) => p.id !== event.id),
					};
				}
				case "grant.changed":
					return { ...state, grants: event.grants };
				case "session.changed":
					return { ...state, sessions: event.sessions };
			}
		}
	}
}
