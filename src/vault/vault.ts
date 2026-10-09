import { argon2id } from "hash-wasm";
import { err, ok, type Result } from "neverthrow";
import { parseVaultData, type VaultData } from "../../contracts/vault.ts";

/** Vault file envelope (plaintext on disk is this JSON, values are base64). */
export interface VaultFile {
	version: 1;
	kdf: { algo: "argon2id"; salt_b64: string; memorySize: number; iterations: number; parallelism: number };
	iv_b64: string;
	ct_b64: string;
}

export type VaultFailure = { kind: "bad-master" } | { kind: "corrupt" } | { kind: "io"; message: string };

const KDF_PARAMS = { memorySize: 65536, iterations: 2, parallelism: 1 } as const;

function b64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64");
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
	const buf = Buffer.from(s, "base64");
	const out = new Uint8Array(buf.length);
	out.set(buf);
	return out;
}

/** KDF pinned by F1 probe: hash-wasm argon2id(salt, hashLength=32) → AES-256 key. */
async function deriveKey(master: string, salt: Uint8Array): Promise<CryptoKey> {
	const raw = await argon2id({
		password: master,
		salt,
		parallelism: KDF_PARAMS.parallelism,
		iterations: KDF_PARAMS.iterations,
		memorySize: KDF_PARAMS.memorySize,
		hashLength: 32,
		outputType: "binary",
	});
	const keyBytes = Uint8Array.from(raw);
	return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function seal(
	data: VaultData,
	master: string,
	kdf: VaultFile["kdf"],
): Promise<{ iv: Uint8Array; ct: Uint8Array }> {
	const key = await deriveKey(master, unb64(kdf.salt_b64));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(data)));
	return { iv, ct: new Uint8Array(ct) };
}

/** Create a fresh empty vault envelope (random salt + iv). */
export async function createVault(master: string, data: VaultData): Promise<VaultFile> {
	const kdf: VaultFile["kdf"] = {
		algo: "argon2id",
		salt_b64: b64(crypto.getRandomValues(new Uint8Array(16))),
		...KDF_PARAMS,
	};
	const { iv, ct } = await seal(data, master, kdf);
	return { version: 1, kdf, iv_b64: b64(iv), ct_b64: b64(ct) };
}

/** Re-seal (keeps the stored salt so the master password stays the unlock). */
export async function saveVault(data: VaultData, master: string, envelope: VaultFile): Promise<VaultFile> {
	const { iv, ct } = await seal(data, master, envelope.kdf);
	return { ...envelope, iv_b64: b64(iv), ct_b64: b64(ct) };
}

export async function openVault(envelope: VaultFile, master: string): Promise<Result<VaultData, VaultFailure>> {
	if (envelope.version !== 1) return err({ kind: "corrupt" });
	try {
		const key = await deriveKey(master, unb64(envelope.kdf.salt_b64));
		const pt = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: unb64(envelope.iv_b64) },
			key,
			unb64(envelope.ct_b64),
		);
		const parsed = parseVaultData(JSON.parse(new TextDecoder().decode(pt)));
		if (!parsed.ok) return err({ kind: "corrupt" });
		return ok(parsed.data);
	} catch {
		// GCM auth failure: wrong master and tampering are indistinguishable by design.
		return err({ kind: "bad-master" });
	}
}

/** 0600 atomic write (tempfile + rename in the same dir). */
export async function writeVaultFile(path: string, envelope: VaultFile): Promise<Result<void, VaultFailure>> {
	try {
		const tmp = `${path}.tmp.${process.pid}`;
		await Bun.write(tmp, JSON.stringify(envelope, null, 2));
		const { chmodSync, renameSync } = await import("node:fs");
		chmodSync(tmp, 0o600);
		renameSync(tmp, path);
		return ok(undefined);
	} catch (e) {
		return err({ kind: "io", message: String(e) });
	}
}

export async function readVaultFile(path: string): Promise<Result<VaultFile, VaultFailure>> {
	try {
		const text = await Bun.file(path).text();
		return ok(JSON.parse(text) as VaultFile);
	} catch (e) {
		return err({ kind: "io", message: String(e) });
	}
}
