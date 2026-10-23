import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { HELPER_ENV, helperPath, mygoChannel } from "./mygo.ts";

describe("mygo channel", () => {
	test("is named mygo and points at the native helper under ~/.bun/bin", () => {
		const prev = process.env[HELPER_ENV];
		delete process.env[HELPER_ENV];
		try {
			expect(mygoChannel.name).toBe("mygo");
			expect(helperPath()).toEndWith(join(".bun", "bin", "dogsout-approve"));
		} finally {
			if (prev === undefined) delete process.env[HELPER_ENV];
			else process.env[HELPER_ENV] = prev;
		}
	});
});
