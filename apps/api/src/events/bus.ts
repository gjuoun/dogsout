import type { UiEvent } from "@dogsout/type-contracts";

/** Fan-out to every open WebUI socket. A dead socket must never break the others. */
type Listener = (event: UiEvent) => void;
const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function broadcast(event: UiEvent): void {
	for (const listener of listeners) {
		try {
			listener(event);
		} catch {
			// socket already gone; the WS close handler will unsubscribe it
		}
	}
}

export function subscriberCount(): number {
	return listeners.size;
}
