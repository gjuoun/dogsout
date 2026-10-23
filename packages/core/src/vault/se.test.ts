import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { SeSlot } from "@dogsout/type-contracts";
import { createEnvelopeV2, openDataV2, unlockWithSe } from "./envelope.ts";
import { pickLocalSeSlot, SE_HELPER_ENV, seCreate, seEcdh, seHelperPath, seProbe } from "./se.ts";

const FAKE = join(import.meta.dir, "helper", "fake-se.ts");
const prev = process.env[SE_HELPER_ENV];
beforeAll(() => {
	process.env[SE_HELPER_ENV] = FAKE;
});
afterAll(() => {
	if (prev === undefined) delete process.env[SE_HELPER_ENV];
	else process.env[SE_HELPER_ENV] = prev;
	delete process.env.FAKE_SE_MODE;
});

const data = { version: 1 as const, vaults: { dev: { gh: { fields: { token: "FAKE-ghp" }, updated_at: "t" } } } };

describe("SE helper client (fake helper binary)", () => {
	test("create → wrap → ecdh → unwrap round-trips through the helper process", async () => {
		const ref = await seCreate();
		expect(ref.isOk()).toBe(true);
		const { file } = await createEnvelopeV2(data, ref._unsafeUnwrap());
		const dek = await unlockWithSe(file, file.slots[0] as SeSlot, seEcdh);
		expect(dek.isOk()).toBe(true);
		expect((await openDataV2(file, dek._unsafeUnwrap()))._unsafeUnwrap()).toEqual(data);
	});

	test("cancelled Touch ID (helper exit 1) is an error, never a key", async () => {
		const { file } = await createEnvelopeV2(data, (await seCreate())._unsafeUnwrap());
		process.env.FAKE_SE_MODE = "deny";
		try {
			const r = await unlockWithSe(file, file.slots[0] as SeSlot, seEcdh);
			expect(r.isErr()).toBe(true);
		} finally {
			delete process.env.FAKE_SE_MODE;
		}
	});

	test("probe: a foreign/garbage blob is not usable here", async () => {
		expect(await seProbe("Z2FyYmFnZQ==")).toBe(false);
		expect(await seProbe((await seCreate())._unsafeUnwrap().blob)).toBe(true);
	});

	test("pickLocalSeSlot skips another Mac's slot and picks this one", async () => {
		const { file } = await createEnvelopeV2(data, (await seCreate())._unsafeUnwrap());
		const local = file.slots[0] as SeSlot;
		const foreign: SeSlot = { ...local, id: "other-mac", blob: "Zm9yZWlnbg==" };
		const picked = await pickLocalSeSlot({ ...file, slots: [foreign, local] });
		expect(picked?.id).toBe(local.id);
		expect(await pickLocalSeSlot({ ...file, slots: [foreign] })).toBe(null);
	});

	test("a missing helper binary is an error", async () => {
		process.env[SE_HELPER_ENV] = "/nonexistent/dogsout-se";
		try {
			expect((await seCreate()).isErr()).toBe(true);
		} finally {
			process.env[SE_HELPER_ENV] = FAKE;
		}
	});
});

describe("SE helper path", () => {
	test("defaults to ~/.bun/bin/dogsout-se (the SE slot, not the approval window)", () => {
		delete process.env[SE_HELPER_ENV];
		try {
			expect(seHelperPath()).toEndWith(join(".bun", "bin", "dogsout-se"));
		} finally {
			process.env[SE_HELPER_ENV] = FAKE;
		}
	});
});
