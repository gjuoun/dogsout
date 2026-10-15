import { describe, expect, test } from "bun:test";
import { parseVaultFileV2, vaultFileVersion } from "./vault.ts";

const se = {
	kind: "se",
	id: "s1",
	created_at: "2026-10-14T00:00:00.000Z",
	iv: "aXY=",
	wrapped: "d3JhcHBlZA==",
	blob: "YmxvYg==",
	se_pub: "cHVi",
	eph_pub: "ZXBo",
};
const passkey = {
	kind: "passkey",
	id: "p1",
	created_at: "2026-10-14T00:00:00.000Z",
	iv: "aXY=",
	wrapped: "d3JhcHBlZA==",
	rp_id: "localhost",
	cred_id: "YEd974un",
};
const doc = (slots: unknown[]) => ({
	version: 2,
	vault_id: "dmF1bHQtaWQ",
	fingerprint: "1945-A6F4",
	data: { iv: "aXY=", ct: "Y3Q=" },
	slots,
});

describe("vault.enc v2 envelope schema", () => {
	test("accepts a v2 file with se and passkey slots", () => {
		const r = parseVaultFileV2(doc([se, passkey]));
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.file.slots.map((s) => s.kind)).toEqual(["se", "passkey"]);
	});
	test("rejects a file with no slots (at least one unlock factor)", () => {
		expect(parseVaultFileV2(doc([])).ok).toBe(false);
	});
	test("rejects an unknown slot kind", () => {
		expect(parseVaultFileV2(doc([{ ...se, kind: "paper" }])).ok).toBe(false);
	});
	test("rejects a passkey slot without a pinned cred_id", () => {
		const { cred_id: _c, ...noCred } = passkey;
		expect(parseVaultFileV2(doc([noCred])).ok).toBe(false);
	});
	test("rejects a malformed fingerprint", () => {
		expect(parseVaultFileV2({ ...doc([se]), fingerprint: "nope" }).ok).toBe(false);
	});
	test("vaultFileVersion sniffs v1, v2 and garbage", () => {
		expect(vaultFileVersion({ version: 1, kdf: {}, iv_b64: "", ct_b64: "" })).toBe(1);
		expect(vaultFileVersion(doc([se]))).toBe(2);
		expect(vaultFileVersion({ version: 9 })).toBe(null);
		expect(vaultFileVersion("x")).toBe(null);
	});
});
