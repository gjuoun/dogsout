import { z } from "zod";

/** Hierarchical vault plaintext model (spec §5.1) — vaults → items → fields. */
export const ItemSchema = z.object({
	fields: z.record(z.string(), z.string()),
	tags: z.record(z.string(), z.string()).optional(),
	owner: z.string().optional(),
	updated_at: z.string(),
});
export type Item = z.infer<typeof ItemSchema>;

export const VaultDataSchema = z.object({
	version: z.literal(1),
	vaults: z.record(z.string(), z.record(z.string(), ItemSchema)),
});
export type VaultData = z.infer<typeof VaultDataSchema>;

export function emptyVault(): VaultData {
	return { version: 1, vaults: {} };
}

export function parseVaultData(raw: unknown): { ok: true; data: VaultData } | { ok: false; error: string } {
	const r = VaultDataSchema.safeParse(raw);
	if (r.success) return { ok: true, data: r.data };
	const issue = r.error.issues[0] ?? { path: ["(root)"], message: "invalid vault" };
	return { ok: false, error: `${issue.path.join(".") || "(root)"}: ${issue.message}` };
}

/**
 * vault.enc v2 envelope (2026-10-14 design, whiteboard 939bdf97): a random DEK encrypts the data once;
 * each unlock factor is a slot holding a copy of the DEK wrapped by that factor's KEK. No password,
 * no Argon2id — v1 password files (`{version:1, kdf, iv_b64, ct_b64}`) are refused since the 2026-10-14 cold cut.
 */
const B64 = z.string().min(1);

const SlotBase = {
	id: z.string().min(1),
	created_at: z.string(),
	/** AES-256-GCM IV for the wrapped DEK. */
	iv: B64,
	/** AES-256-GCM(KEK, DEK), AAD = "jtk/slot/<kind>|" + vault_id + "|" + id. */
	wrapped: B64,
};

/** Touch ID slot: KEK = HKDF(ECDH(SE private, eph), salt eph_pub||se_pub, info "jtk/se-kek/v1"). */
export const SeSlotSchema = z.object({
	kind: z.literal("se"),
	...SlotBase,
	/** CryptoKit dataRepresentation — an opaque handle only that Mac's Secure Enclave can use. */
	blob: B64,
	/** x963 P-256 public key of the SE key. */
	se_pub: B64,
	/** Ephemeral public key used at wrap time (its private half is never stored). */
	eph_pub: B64,
});
export type SeSlot = z.infer<typeof SeSlotSchema>;

/** Passkey slot (enrolled only through the F3 WebUI): KEK = HKDF(PRF output, salt vault_id, info "jtk/passkey-kek/v1") — a frozen wire constant, same rule as envelope.ts. */
export const PasskeySlotSchema = z.object({
	kind: z.literal("passkey"),
	...SlotBase,
	rp_id: z.literal("localhost"),
	/** Pinned credential: a re-created passkey yields a different PRF secret. */
	cred_id: z.string().min(1),
});
export type PasskeySlot = z.infer<typeof PasskeySlotSchema>;

/**
 * Local token slot — the default unlock factor since 2026-10-30. KEK =
 * HKDF-SHA256(token, salt vault_id|slot_id, info "jtk/token-kek/v1"), no biometrics, no UI.
 * The token lives in `$DOGSOUT_HOME/unlock-token` (0600) or `DOGSOUT_UNLOCK_TOKEN`; the auth
 * server will issue and rotate it, and its expiry bounds how long the slot is usable.
 */
export const TokenSlotSchema = z.object({
	kind: z.literal("token"),
	...SlotBase,
	/** sha256(token) first 16 hex chars — selects the slot without an unwrap attempt; reveals nothing. */
	token_id: z.string().regex(/^[0-9a-f]{16}$/),
	/** Copied from the token when it carries one (Unix seconds); reference validity follows it. */
	expires_at: z.number().int().positive().optional(),
});
export type TokenSlot = z.infer<typeof TokenSlotSchema>;

export const SlotSchema = z.discriminatedUnion("kind", [SeSlotSchema, PasskeySlotSchema, TokenSlotSchema]);
export type Slot = z.infer<typeof SlotSchema>;

export const VaultFileV2Schema = z.object({
	version: z.literal(2),
	/** b64url(16 random bytes), not secret: HKDF salt and AAD context. */
	vault_id: z.string().min(1),
	/** "XXXX-XXXX" = first 4 bytes of HKDF(DEK, info "jtk/fingerprint/v1"), upper-case hex. */
	fingerprint: z.string().regex(/^[0-9A-F]{4}-[0-9A-F]{4}$/),
	/** AES-256-GCM(DEK, VaultData JSON), AAD = "jtk/data/v2|" + vault_id. */
	data: z.object({ iv: B64, ct: B64 }),
	/** At least one unlock factor; removing the last slot is refused. */
	slots: z.array(SlotSchema).min(1),
});
export type VaultFileV2 = z.infer<typeof VaultFileV2Schema>;

export function parseVaultFileV2(raw: unknown): { ok: true; file: VaultFileV2 } | { ok: false; error: string } {
	const r = VaultFileV2Schema.safeParse(raw);
	if (r.success) return { ok: true, file: r.data };
	const issue = r.error.issues[0] ?? { path: ["(root)"], message: "invalid vault file" };
	return { ok: false, error: `${issue.path.join(".") || "(root)"}: ${issue.message}` };
}

/** Sniff the on-disk envelope version without trusting the rest of the document. */
export function vaultFileVersion(raw: unknown): 1 | 2 | null {
	if (typeof raw !== "object" || raw === null) return null;
	const v = (raw as { version?: unknown }).version;
	return v === 1 || v === 2 ? v : null;
}
