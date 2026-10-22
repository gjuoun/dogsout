import { watch } from "node:fs";
import { broadcast } from "./events/bus.ts";
import { grantEvent, sessionEvent } from "./events/snapshot.ts";

/**
 * The CLI writes grants/sessions behind the API's back (`grants rm`, session end, run
 * approvals). Watching JTK_HOME is how the panel stays honest without a daemon rewrite.
 *
 * `fs.watch` may report a null filename, and core writes atomically (tmp + rename), so
 * one logical write can fire two events. Both are handled the same way: debounce, then
 * re-read and broadcast full snapshots (idempotent by construction, so duplicates are
 * harmless and a missed filename costs nothing).
 */
export function watchHome(home: string, debounceMs = 300): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const watcher = watch(home, () => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = undefined;
			void (async () => {
				broadcast(await grantEvent(home, "external"));
				broadcast(await sessionEvent(home));
			})();
		}, debounceMs);
	});
	return () => {
		if (timer) clearTimeout(timer);
		watcher.close();
	};
}
