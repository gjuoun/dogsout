import { jtkHome, loadConfig, writeConfig } from "@jtk/core";
import { command, flag, optional, positional, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { runJtk, withMeta } from "./cmd.ts";

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
