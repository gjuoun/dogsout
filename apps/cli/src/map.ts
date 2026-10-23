import { dogsoutHome, formatAddress, loadConfig, writeConfig } from "@dogsout/core";
import { command, flag, optional, positional, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { desugarAddress } from "./address-input.ts";
import { runDogsout, withMeta } from "./cmd.ts";

/**
 * The `dogsout map` command (chained reference slots) — unrelated to the notebook feature map,
 * which this repo exposes only as ./commands.ts + ./intent.ts and is read outside the repo.
 */
export function mapCommand() {
	return withMeta(
		command({
			name: "map",
			description: "register a map slot pointing at an address or another slot (chained refs)",
			args: {
				rm: flag({ long: "rm", description: "remove the named slot" }),
				slot: positional({ type: string, displayName: "SLOT" }),
				target: positional({ type: optional(string), displayName: "dogsout://... | SLOT" }),
			},
			handler: async ({ rm, slot, target }): Promise<Result<string, string>> => {
				if (!rm && !target) return err("usage: dogsout map <SLOT> <dogsout://... | other-slot>");
				if (!rm && slot.startsWith("dogsout://")) return err("map slot must be a name, not a dogsout:// address");
				if (!rm && slot === target) return err("map slot cannot point at itself");
				const home = dogsoutHome();
				const cfg = await loadConfig(home);
				if (cfg.isErr()) return err(cfg.error);
				if (rm) {
					if (cfg.value.maps[slot] === undefined) return err("no such map slot: " + slot);
					delete cfg.value.maps[slot];
					const w = await writeConfig(home, cfg.value);
					if (w.isErr()) return err(w.error);
					return ok("removed map " + slot);
				}
				// A target that is an address goes through the same validation/sugar as every other
				// address input and is stored canonically; anything else is another slot name.
				const raw = target as string;
				let value = raw;
				if (raw.startsWith("dogsout://") || raw.startsWith(".")) {
					const parsed = desugarAddress(raw, { strict: true });
					if (parsed.isErr()) return err(parsed.error);
					value = formatAddress(parsed.value);
				}
				cfg.value.maps[slot] = value;
				const w = await writeConfig(home, cfg.value);
				if (w.isErr()) return err(w.error);
				return ok(slot + " -> " + value);
			},
		}),
		{ reads: [], writes: ["config"], env: ["DOGSOUT_HOME"] },
	);
}

export async function runMap(argv: string[]): Promise<Result<string, string>> {
	return runDogsout<string>(mapCommand(), argv);
}
