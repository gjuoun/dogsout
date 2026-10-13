import type { Config } from "@jtk/contracts";
import { command, flag, optional, positional, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { runJtk, withMeta } from "./cmd.ts";
import { jtkHome } from "./paths.ts";
import { loadConfig, writeConfig } from "./store.ts";

export const MAX_CHAIN_DEPTH = 8;

export interface Resolved {
	address: string;
	chain: string[];
}

/**
 * Resolve a name to a concrete jtk:// address through the reference chain:
 * literal address -> terminal; map slot -> its target (slot or address) recursively;
 * alias -> its address. Cycle and depth guarded, resolved fresh on every read —
 * upstream rotation propagates with zero stored copies (vault-link).
 */
export function resolveToAddress(name: string, cfg: Pick<Config, "aliases" | "maps">): Result<Resolved, string> {
	if (name.startsWith("jtk://")) return ok({ address: name, chain: [name] });
	const seen = new Set<string>([name]);
	const chain: string[] = [name];
	let cursor = name;
	for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth++) {
		const mapTarget = cfg.maps[cursor];
		if (mapTarget !== undefined) {
			if (mapTarget.startsWith("jtk://")) {
				chain.push(mapTarget);
				return ok({ address: mapTarget, chain });
			}
			if (seen.has(mapTarget)) return err("map cycle detected: " + [...chain, mapTarget].join(" -> "));
			seen.add(mapTarget);
			chain.push(mapTarget);
			cursor = mapTarget;
			continue;
		}
		const aliasTarget = cfg.aliases[cursor];
		if (aliasTarget !== undefined) {
			chain.push(aliasTarget);
			return ok({ address: aliasTarget, chain });
		}
		return err("unknown alias/map slot and not an address: " + name + " (chain: " + chain.join(" -> ") + ")");
	}
	return err("map chain deeper than " + MAX_CHAIN_DEPTH + ": " + chain.join(" -> "));
}

export function mapCommand() {
	return withMeta(
		command({
			name: "map",
			description: "register a map slot pointing at an address or another slot (chained refs)",
			args: {
				rm: flag({ long: "rm", description: "remove the named slot" }),
				slot: positional({ type: string, displayName: "SLOT" }),
				target: positional({ type: optional(string), displayName: "jtk://... | SLOT" }),
			},
			handler: async ({ rm, slot, target }): Promise<Result<string, string>> => {
				if (!rm && !target) return err("usage: jtk map <SLOT> <jtk://... | other-slot>");
				if (!rm && slot.startsWith("jtk://")) return err("map slot must be a name, not a jtk:// address");
				if (!rm && slot === target) return err("map slot cannot point at itself");
				const home = jtkHome();
				const cfg = await loadConfig(home);
				if (cfg.isErr()) return err(cfg.error);
				if (rm) {
					if (cfg.value.maps[slot] === undefined) return err("no such map slot: " + slot);
					delete cfg.value.maps[slot];
					const w = await writeConfig(home, cfg.value);
					if (w.isErr()) return err(w.error);
					return ok("removed map " + slot);
				}
				cfg.value.maps[slot] = target as string;
				const w = await writeConfig(home, cfg.value);
				if (w.isErr()) return err(w.error);
				return ok(slot + " -> " + target);
			},
		}),
		{ reads: [], writes: ["config"], env: ["JTK_HOME"] },
	);
}

export async function runMap(argv: string[]): Promise<Result<string, string>> {
	return runJtk<string>(mapCommand(), argv);
}
