import type { Config } from "@jtk/type-contracts";
import { err, ok, type Result } from "neverthrow";

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
