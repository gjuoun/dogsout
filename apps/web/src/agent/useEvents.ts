import type { UiEvent } from "@jtk/type-contracts";
import { useEffect, useRef } from "react";
import { EVENTS_URL } from "~/api/client";
import type { Connection } from "./reducer";

/**
 * Live channel with bounded exponential backoff. The server sends full snapshots on
 * connect, so every successful reconnect repairs whatever was missed while offline —
 * the panel never has to ask "did I miss anything".
 */
export function useEvents(handlers: {
	onEvent: (event: UiEvent) => void;
	onConnection: (status: Connection) => void;
}): void {
	const latest = useRef(handlers);
	latest.current = handlers;

	useEffect(() => {
		let closed = false;
		let socket: WebSocket | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let retry = 0;

		const connect = () => {
			if (closed) return;
			latest.current.onConnection("connecting");
			socket = new WebSocket(EVENTS_URL);
			socket.addEventListener("open", () => {
				retry = 0;
				latest.current.onConnection("open");
			});
			socket.addEventListener("message", (message) => {
				try {
					latest.current.onEvent(JSON.parse(String(message.data)) as UiEvent);
				} catch {
					// a malformed frame must not kill the channel
				}
			});
			socket.addEventListener("close", () => {
				if (closed) return;
				latest.current.onConnection("closed");
				const delay = Math.min(5000, 250 * 2 ** retry);
				retry += 1;
				timer = setTimeout(connect, delay);
			});
		};

		connect();
		return () => {
			closed = true;
			if (timer) clearTimeout(timer);
			socket?.close();
		};
	}, []);
}
