import { err, ok, type Result } from "neverthrow";
import {
	type AskRequest,
	DEFAULT_TTL,
	type Decision,
	TTL_UI_TIERS,
	type TtlTier,
	TtlTierSchema,
} from "../../contracts/ask.ts";
import type { Channel } from "./channel.ts";

async function question(rl: { question: (q: string, cb: (a: string) => void) => void }, q: string): Promise<string> {
	return await new Promise((resolve) => rl.question(q, (a: string) => resolve(a.trim())));
}

/**
 * The CLI slot: a TTY three-state prompt per key plus a TTL pick. Non-TTY stdin
 * never approves — the slot reports unavailable and the chain degrades to deny.
 */
export const cliChannel: Channel = {
	name: "cli",
	async available() {
		return process.stdin.isTTY === true && process.stdout.isTTY === true;
	},
	async ask(request: AskRequest): Promise<Result<Decision, string>> {
		if (!process.stdin.isTTY || !process.stdout.isTTY) return err("no TTY for cli approval");
		const { createInterface } = await import("node:readline");
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		try {
			console.log("jtk approval — principal " + request.principal + " (session " + request.session + ")");
			const keys: Record<string, "deny" | "once" | "ttl"> = {};
			for (const k of request.keys) {
				const a = await question(rl, "  " + k.alias + " (" + k.note + ") approve? [y=ttl n=deny o=once] ");
				keys[k.alias] = a === "o" ? "once" : a === "n" || a === "N" ? "deny" : a === "y" || a === "Y" ? "ttl" : "deny";
			}
			const anyTtl = Object.values(keys).some((v) => v === "ttl");
			let ttl: TtlTier = DEFAULT_TTL;
			if (anyTtl) {
				const a = await question(rl, "  ttl tier [" + TTL_UI_TIERS.join("/") + "] default " + DEFAULT_TTL + ": ");
				if (a && !TtlTierSchema.safeParse(a).success) return err("invalid ttl tier: " + a);
				if (a) ttl = TtlTierSchema.parse(a);
			}
			if (Object.values(keys).every((v) => v === "deny")) return ok({ decision: "deny" });
			return ok({ decision: "approve", ttl, renew_existing: false, keys });
		} finally {
			rl.close();
		}
	},
};
