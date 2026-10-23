import { type AskLogRow, getAsksHistory } from "@dogsout/api-client";
import type { UiEvent } from "@dogsout/type-contracts";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useReducer } from "react";
import { initialPanelState, panelReducer } from "~/agent/reducer";
import { Timeline } from "~/agent/Timeline";
import { useEvents } from "~/agent/useEvents";

export const Route = createFileRoute("/agent")({ component: AgentPage });

/** Agent activity: the durable ask log on load, live frames afterwards. */
function AgentPage() {
	const [state, dispatch] = useReducer(panelReducer, initialPanelState);

	const loadHistory = useCallback(async () => {
		const { data } = await getAsksHistory({ query: { limit: 50 } });
		if (data) dispatch({ type: "history", rows: data as AskLogRow[] });
	}, []);

	useEffect(() => {
		void loadHistory();
	}, [loadHistory]);

	useEvents({
		onEvent: (event: UiEvent) => dispatch({ type: "event", event, at: new Date().toISOString() }),
		onConnection: (status) => dispatch({ type: "connection", status }),
	});

	return <Timeline state={state} />;
}
