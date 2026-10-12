import { describe, expect, test } from "bun:test";
import { err, ok } from "neverthrow";
import type { AskRequest } from "../../contracts/ask.ts";
import { type Channel, runAskChain } from "./channel.ts";

const req: AskRequest = {
	principal: "p",
	session: "s",
	at: "t",
	keys: [{ alias: "gh", address: "jtk://dev/gh/pat", note: "", value_hash: "aa" }],
	granted: [],
};

const chan = (name: string, opts: { available?: boolean; decision?: "approve" | "deny" | "fail" }): Channel => ({
	name,
	available: async () => opts.available ?? true,
	ask: async () => {
		if (opts.decision === "fail") return err("channel exploded");
		if (opts.decision === "deny") return ok({ decision: "deny" });
		return ok({ decision: "approve", ttl: "10m", renew_existing: false, keys: { gh: "ttl" } });
	},
});

describe("ask chain (fail-closed)", () => {
	test("unavailable first channel is skipped, second decides", async () => {
		const r = await runAskChain([chan("a", { available: false }), chan("b", { decision: "approve" })], req, 5000);
		expect(r.isOk()).toBe(true);
	});

	test("failed first channel degrades to the second", async () => {
		const r = await runAskChain([chan("a", { decision: "fail" }), chan("b", { decision: "deny" })], req, 5000);
		expect(r.isOk()).toBe(true);
		if (r.isOk()) expect(r.value.decision).toBe("deny");
	});

	test("all channels unavailable -> error the caller converts to deny", async () => {
		const r = await runAskChain([chan("a", { available: false }), chan("b", { available: false })], req, 5000);
		expect(r.isErr()).toBe(true);
	});

	test("empty channel list is an error, never a silent allow", async () => {
		const r = await runAskChain([], req, 5000);
		expect(r.isErr()).toBe(true);
	});
});
