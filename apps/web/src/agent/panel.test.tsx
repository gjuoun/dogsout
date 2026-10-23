import { describe, expect, test } from "bun:test";
import type { AskLogRow } from "@dogsout/api-client";
import type { UiEvent } from "@dogsout/type-contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { initialPanelState, type PanelState, panelReducer } from "./reducer.ts";
import { Timeline } from "./Timeline.tsx";

const AT = "2026-10-22T12:00:00Z";

const ROWS: AskLogRow[] = [
	{
		id: "a_1",
		principal: "claude-code@laptop",
		session_id: "sess_1",
		requested_at: "2026-10-22T11:00:00Z",
		keys_json: "[]",
		key_count: 2,
		decision: "approve",
		ttl: "10m",
		decided_at: AT,
		decided_via: "webui",
	},
	{
		id: "a_0",
		principal: "agent@laptop",
		session_id: null,
		requested_at: "2026-10-22T10:00:00Z",
		keys_json: "[]",
		key_count: 1,
		decision: "deny",
		ttl: null,
		decided_at: null,
		decided_via: "timeout",
	},
];

const ASK = {
	principal: "claude-code@laptop",
	session: "sess_1",
	at: AT,
	keys: [{ alias: "gh", address: "dogsout://dev/gh/pat", note: "gh", value_hash: "aa" }],
	granted: [],
};

function apply(state: PanelState, events: UiEvent[]): PanelState {
	return events.reduce((acc, event) => panelReducer(acc, { type: "event", event, at: AT }), state);
}

describe("panel reducer", () => {
	test("history lands newest first with the via label preserved", () => {
		const state = panelReducer(initialPanelState, { type: "history", rows: ROWS });
		expect(state.timeline.map((x) => x.id)).toEqual(["a_1", "a_0"]);
		expect(state.timeline[0]?.via).toBe("webui");
		expect(state.timeline[1]?.via).toBe("timeout");
	});

	test("ask.pending then ask.decided moves the ask from waiting to the timeline", () => {
		const waiting = apply(initialPanelState, [
			{ type: "ask.pending", at: AT, ask: { id: "a_9", at: AT, request: ASK } },
		]);
		expect(waiting.pending.length).toBe(1);
		const decided = apply(waiting, [
			{
				type: "ask.decided",
				at: AT,
				id: "a_9",
				decision: { decision: "approve", ttl: "10m", renew_existing: false, keys: { gh: "ttl" } },
			},
		]);
		expect(decided.pending.length).toBe(0);
		expect(decided.timeline[0]?.id).toBe("a_9");
		expect(decided.timeline[0]?.principal).toBe("claude-code@laptop");
		expect(decided.timeline[0]?.decision).toBe("approve");
	});

	test("grant and session frames replace the snapshot (reconnect-safe)", () => {
		const once = apply(initialPanelState, [
			{ type: "grant.changed", at: AT, reason: "external", grants: [{ alias: "gh", status: "剩 10m" }] },
			{ type: "session.changed", at: AT, sessions: [{ id: "sess_1", principal: "p", opened_at: AT }] },
		]);
		expect(once.grants).toEqual([{ alias: "gh", status: "剩 10m" }]);
		expect(once.sessions.length).toBe(1);
		const twice = apply(once, [{ type: "grant.changed", at: AT, reason: "revoke", grants: [] }]);
		expect(twice.grants).toEqual([]);
	});

	test("a repeated decision frame does not duplicate the row", () => {
		const frame: UiEvent = { type: "ask.decided", at: AT, id: "a_9", decision: { decision: "deny" } };
		const state = apply(apply(initialPanelState, [frame]), [frame]);
		expect(state.timeline.filter((x) => x.id === "a_9").length).toBe(1);
	});

	test("connection state is visible (a silent dead socket is a lie)", () => {
		const state = panelReducer(initialPanelState, { type: "connection", status: "closed" });
		expect(state.connection).toBe("closed");
	});
});

describe("panel markup", () => {
	test("counts, timeline rows and the held-keys snapshot render", () => {
		const state = apply(panelReducer(initialPanelState, { type: "history", rows: ROWS }), [
			{ type: "grant.changed", at: AT, reason: "external", grants: [{ alias: "gh", status: "剩 10m" }] },
			{ type: "session.changed", at: AT, sessions: [{ id: "sess_1", principal: "p", opened_at: AT }] },
			{ type: "ask.pending", at: AT, ask: { id: "a_9", at: AT, request: ASK } },
		]);
		const html = renderToStaticMarkup(<Timeline state={state} />);
		expect(html).toContain("批准");
		expect(html).toContain("拒绝");
		expect(html).toContain("gh");
		expect(html.match(/<li/g)?.length).toBe(2);
		const granted = html.slice(html.indexOf('data-testid="granted-area"'), html.indexOf('data-testid="timeline"'));
		expect(granted.includes("<button")).toBe(false);
	});

	test("an offline panel says so instead of looking live", () => {
		const state = panelReducer(initialPanelState, { type: "connection", status: "closed" });
		const html = renderToStaticMarkup(<Timeline state={state} />);
		expect(html).toContain("已断开");
	});
});
