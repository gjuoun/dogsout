import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEnvelopeV2 } from "./envelope.ts";
import { readVaultRaw, writeVaultFile } from "./vault.ts";

/** Software stand-in for an SE public key (no helper needed for pure file IO). */
async function seRef() {
	const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
	const b64 = (u: ArrayBuffer) => Buffer.from(new Uint8Array(u)).toString("base64");
	return {
		blob: b64(await crypto.subtle.exportKey("pkcs8", kp.privateKey)),
		pub: b64(await crypto.subtle.exportKey("raw", kp.publicKey)),
	};
}

describe("vault.enc file IO", () => {
	test("write → readVaultRaw round-trips the envelope, file mode 0600", async () => {
		const home = mkdtempSync(join(tmpdir(), "jtk-vault-io-"));
		try {
			const path = join(home, "vault.enc");
			const { file } = await createEnvelopeV2({ version: 1, vaults: {} }, await seRef());
			expect((await writeVaultFile(path, file)).isOk()).toBe(true);
			expect((await readVaultRaw(path))._unsafeUnwrap()).toEqual(file);
			expect(statSync(path).mode & 0o777).toBe(0o600);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("unparseable file → corrupt; missing file → io", async () => {
		const home = mkdtempSync(join(tmpdir(), "jtk-vault-io-"));
		try {
			const path = join(home, "vault.enc");
			expect((await readVaultRaw(path))._unsafeUnwrapErr().kind).toBe("io");
			writeFileSync(path, "{ nope");
			expect((await readVaultRaw(path))._unsafeUnwrapErr().kind).toBe("corrupt");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
