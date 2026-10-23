import { describe, expect, test } from "bun:test";
import { emptyVault, type VaultData } from "@dogsout/type-contracts";
import {
	createEnvelopeV2,
	type Ecdh,
	fingerprintOf,
	openDataV2,
	rekeyV2,
	removeSlot,
	resealV2,
	type SeKeyRef,
	unlockWithSe,
	wrapSe,
} from "./envelope.ts";

const b64 = (u: ArrayBuffer | Uint8Array) =>
	Buffer.from(u instanceof Uint8Array ? u : new Uint8Array(u)).toString("base64");

/** Software stand-in for the Secure Enclave: blob = pkcs8 private key (test only). */
async function fakeSe(): Promise<SeKeyRef> {
	const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
	return {
		blob: b64(await crypto.subtle.exportKey("pkcs8", kp.privateKey)),
		pub: b64(await crypto.subtle.exportKey("raw", kp.publicKey)),
	};
}
const fakeEcdh: Ecdh = async (blob, ephPub) => {
	const priv = await crypto.subtle.importKey(
		"pkcs8",
		Buffer.from(blob, "base64"),
		{ name: "ECDH", namedCurve: "P-256" },
		false,
		["deriveBits"],
	);
	const peer = await crypto.subtle.importKey(
		"raw",
		Buffer.from(ephPub, "base64"),
		{ name: "ECDH", namedCurve: "P-256" },
		false,
		[],
	);
	const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, priv, 256);
	const { ok } = await import("neverthrow");
	return ok(new Uint8Array(bits));
};
const data = (): VaultData => ({
	version: 1,
	vaults: { dev: { gh: { fields: { token: "FAKE-ghp" }, updated_at: "t" } } },
});

describe("vault v2 envelope", () => {
	test("create → unlock with the se slot → open data round-trips", async () => {
		const se = await fakeSe();
		const { file } = await createEnvelopeV2(data(), se);
		expect(file.slots).toHaveLength(1);
		expect(file.fingerprint).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
		const dek = await unlockWithSe(file, file.slots[0] as never, fakeEcdh);
		expect(dek.isOk()).toBe(true);
		const opened = await openDataV2(file, dek._unsafeUnwrap());
		expect(opened._unsafeUnwrap().vaults.dev?.gh?.fields.token).toBe("FAKE-ghp");
		expect(await fingerprintOf(dek._unsafeUnwrap())).toBe(file.fingerprint);
	});

	test("a different SE key cannot unwrap the slot (fail-closed)", async () => {
		const { file } = await createEnvelopeV2(data(), await fakeSe());
		const other = await fakeSe();
		const slot = { ...(file.slots[0] as object), blob: other.blob } as never;
		expect((await unlockWithSe(file, slot, fakeEcdh)).isErr()).toBe(true);
	});

	test("a slot moved into another vault fails its AAD check", async () => {
		const se = await fakeSe();
		const a = await createEnvelopeV2(data(), se);
		const b = await createEnvelopeV2(emptyVault(), se);
		const moved = { ...b.file, slots: a.file.slots };
		expect((await unlockWithSe(moved, moved.slots[0] as never, fakeEcdh)).isErr()).toBe(true);
	});

	test("wrap needs only the public key; a second slot opens the same DEK", async () => {
		const { file, dek } = await createEnvelopeV2(data(), await fakeSe());
		const se2 = await fakeSe();
		const slot2 = await wrapSe(dek, file.vault_id, "s2", { pub: se2.pub, blob: se2.blob });
		const both = { ...file, slots: [...file.slots, slot2] };
		const via2 = await unlockWithSe(both, slot2, fakeEcdh);
		expect(b64(via2._unsafeUnwrap())).toBe(b64(dek));
	});

	test("removing the last slot is refused", async () => {
		const { file } = await createEnvelopeV2(data(), await fakeSe());
		expect(removeSlot(file, file.slots[0]?.id ?? "").isErr()).toBe(true);
	});

	test("reseal keeps the DEK and fingerprint, changes the data IV", async () => {
		const { file, dek } = await createEnvelopeV2(data(), await fakeSe());
		const next = await resealV2(file, dek, emptyVault());
		expect(next.fingerprint).toBe(file.fingerprint);
		expect(next.data.iv).not.toBe(file.data.iv);
		expect((await openDataV2(next, dek))._unsafeUnwrap()).toEqual(emptyVault());
	});

	test("rekey: new DEK and fingerprint, data intact, se slots rewrapped without the chip", async () => {
		const se = await fakeSe();
		const { file, dek } = await createEnvelopeV2(data(), se);
		const r = await rekeyV2(file, data());
		expect(r.file.fingerprint).not.toBe(file.fingerprint);
		expect(b64(r.dek)).not.toBe(b64(dek));
		const dek2 = await unlockWithSe(r.file, r.file.slots[0] as never, fakeEcdh);
		expect((await openDataV2(r.file, dek2._unsafeUnwrap()))._unsafeUnwrap()).toEqual(data());
	});
});
