import { err, ok, type Result } from "neverthrow";
import { type AskRequest, type Decision, parseDecision } from "../../contracts/ask.ts";

/** One approval outlet in the degradation chain (webui -> swiftui -> cli -> deny). */
export interface Channel {
	name: string;
	/** False = slot empty on this machine; the chain skips it without penalty. */
	available(): Promise<boolean>;
	/** Must honor the timeout budget itself; err = channel failed, chain degrades. */
	ask(request: AskRequest, budgetMs: number): Promise<Result<Decision, string>>;
}

/**
 * Run the degradation chain under one total budget. First channel that returns a
 * decision wins; unavailable or failed channels degrade; exhaustion is an error the
 * caller converts to deny — fail-closed end to end (PRD red line 3).
 */
export async function runAskChain(
	channels: Channel[],
	request: AskRequest,
	totalBudgetMs: number,
): Promise<Result<Decision, string>> {
	const deadline = Date.now() + totalBudgetMs;
	const skipped: string[] = [];
	for (const ch of channels) {
		const remaining = deadline - Date.now();
		if (remaining <= 0)
			return err("ask timed out after " + ch.name + " waited (channels skipped: " + skipped.join(",") + ")");
		let usable = false;
		try {
			usable = await ch.available();
		} catch {
			usable = false;
		}
		if (!usable) {
			skipped.push(ch.name + ":unavailable");
			continue;
		}
		const r = await ch.ask(request, remaining);
		if (r.isOk()) return r;
		skipped.push(ch.name + ":" + r.error);
	}
	return err("no channel decided (chain: " + skipped.join(" | ") + ")");
}

/** Parse helper stdout as a Decision; anything else is a channel failure. */
export function decisionFromStdout(text: string): Result<Decision, string> {
	try {
		const r = parseDecision(JSON.parse(text));
		return r.ok ? ok(r.decision) : err(r.error);
	} catch {
		return err("channel stdout is not decision JSON");
	}
}
