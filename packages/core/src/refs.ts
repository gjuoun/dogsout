import type { Config } from "@dogsout/type-contracts";
import { parseAddressStrict } from "./address.ts";
import { isOnePasswordRef } from "./vault/onepassword.ts";

/**
 * The refs table is keyed by a canonical 3-segment address. A lookup normalizes its input, so an
 * address carrying a JSON subpath (`dogsout://op/dev/key.sub`) still finds `dogsout://op/dev/key`:
 * the subpath belongs to the resolved value, not to the reference.
 */
export function refKeyOf(address: string): string | null {
	const parsed = parseAddressStrict(address);
	if (parsed.isErr()) return null;
	const { vault, item, field } = parsed.value;
	return `dogsout://${vault}/${item}/${field}`;
}

/** The reference serving this address, or null when the address is served by the vault. */
export function refFor(cfg: Pick<Config, "refs">, address: string): string | null {
	const key = refKeyOf(address);
	if (key === null) return null;
	const ref = cfg.refs[key];
	return ref !== undefined && isOnePasswordRef(ref) ? ref : null;
}
