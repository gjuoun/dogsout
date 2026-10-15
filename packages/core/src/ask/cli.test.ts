import { describe, expect, test } from "bun:test";
import { cliChannel } from "./cli.ts";

describe("cli channel (non-TTY fail-closed)", () => {
	test("no TTY means unavailable — the chain degrades to deny", async () => {
		const available = await cliChannel.available();
		if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
			expect(available).toBe(false);
			const r = await cliChannel.ask(
				{
					principal: "p",
					session: "s",
					at: "t",
					keys: [{ alias: "a", address: "b", note: "", value_hash: "" }],
					granted: [],
				},
				1000,
			);
			expect(r.isErr()).toBe(true);
		}
	});
});
