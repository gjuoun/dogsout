import {
	type PasskeySlot,
	parseVaultData,
	type SeSlot,
	type Slot,
	type TokenSlot,
	type VaultData,
	type VaultFileV2,
} from "@dogsout/type-contracts";
import { err, ok, type Result } from "neverthrow";
import { tokenIdOf } from "./token.ts";

/**
 * vault.enc v2 envelope (whiteboard 939bdf97, PRD §2.1). A random DEK encrypts the data once;
 * each slot holds a copy of the DEK wrapped by that factor's KEK. Changing factors never
 * re-encrypts the data. Pure crypto: the Secure Enclave is reached only through the injected
 * `Ecdh` function, so this module is testable with a software P-256 key.
 */

export type EnvelopeFailure = { kind: "corrupt" } | { kind: "unlock"; message: string };

/** What `--se-create` returns: the SE public key + the chip-bound handle. */
export interface SeKeyRef {
	blob: string;
	pub: string;
}

/** ECDH(SE private behind `blob`, `ephPub`) → 32-byte shared secret. Touch ID lives behind this. */
export type Ecdh = (blob: string, ephPub: string) => Promise<Result<Uint8Array, string>>;

const enc = new TextEncoder();
const P256 = { name: "ECDH", namedCurve: "P-256" } as const;

function b64(bytes: Uint8Array | ArrayBuffer): string {
	return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64");
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
	const buf = Buffer.from(s, "base64");
	const out = new Uint8Array(buf.length);
	out.set(buf);
	return out;
}

function randomB64url(n: number): string {
	return Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString("base64url");
}

/**
 * FROZEN WIRE CONSTANTS — MUST NOT CHANGE. These strings are AEAD associated data and HKDF
 * info, not branding: every `jtk/…` literal here is baked into vaults already on disk, so
 * renaming one makes each existing envelope fail its GCM authentication ("corrupt") and
 * would require a vault v3 migration. They keep the pre-rename spelling on purpose.
 */
const dataAad = (vaultId: string) => enc.encode(`jtk/data/v2|${vaultId}`);
const slotAad = (kind: Slot["kind"], vaultId: string, slotId: string) =>
	enc.encode(`jtk/slot/${kind}|${vaultId}|${slotId}`);

export function newDek(): Uint8Array<ArrayBuffer> {
	return crypto.getRandomValues(new Uint8Array(32));
}

async function aesKey(raw: Uint8Array<ArrayBuffer>, usage: KeyUsage[]): Promise<CryptoKey> {
	return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, usage);
}

/** "XXXX-XXXX": first 4 bytes of HKDF(DEK, info "jtk/fingerprint/v1"). Identifies the vault, reveals nothing. */
export async function fingerprintOf(dek: Uint8Array<ArrayBuffer>): Promise<string> {
	const ikm = await crypto.subtle.importKey("raw", dek, "HKDF", false, ["deriveBits"]);
	const bits = await crypto.subtle.deriveBits(
		{ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: enc.encode("jtk/fingerprint/v1") },
		ikm,
		32,
	);
	const hex = Buffer.from(bits).toString("hex").toUpperCase();
	return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

/** se KEK = HKDF-SHA256(ECDH shared, salt eph_pub || se_pub, info "jtk/se-kek/v1"). */
async function seKek(shared: Uint8Array<ArrayBuffer>, ephPub: Uint8Array, sePub: Uint8Array): Promise<CryptoKey> {
	const ikm = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
	return crypto.subtle.deriveKey(
		{ name: "HKDF", hash: "SHA-256", salt: new Uint8Array([...ephPub, ...sePub]), info: enc.encode("jtk/se-kek/v1") },
		ikm,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

/** WRAP into an se slot: needs only the SE public key — no Touch ID. The ephemeral private key is never stored. */
export async function wrapSe(
	dek: Uint8Array<ArrayBuffer>,
	vaultId: string,
	slotId: string,
	ref: SeKeyRef,
): Promise<SeSlot> {
	const sePub = unb64(ref.pub);
	const sePubKey = await crypto.subtle.importKey("raw", sePub, P256, false, []);
	const eph = await crypto.subtle.generateKey(P256, true, ["deriveBits"]);
	const shared = new Uint8Array(
		await crypto.subtle.deriveBits({ name: "ECDH", public: sePubKey }, eph.privateKey, 256),
	);
	const ephPub = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
	const kek = await seKek(shared, ephPub, sePub);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const wrapped = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv, additionalData: slotAad("se", vaultId, slotId) },
		kek,
		dek,
	);
	return {
		kind: "se",
		id: slotId,
		created_at: new Date().toISOString(),
		iv: b64(iv),
		wrapped: b64(wrapped),
		blob: ref.blob,
		se_pub: ref.pub,
		eph_pub: b64(ephPub),
	};
}

/** UNWRAP an se slot: the injected ECDH (Secure Enclave + Touch ID) redoes the key agreement. */
export async function unlockWithSe(
	file: VaultFileV2,
	slot: SeSlot,
	ecdh: Ecdh,
): Promise<Result<Uint8Array<ArrayBuffer>, EnvelopeFailure>> {
	const shared = await ecdh(slot.blob, slot.eph_pub);
	if (shared.isErr()) return err({ kind: "unlock", message: shared.error });
	try {
		const raw = new Uint8Array(shared.value.length);
		raw.set(shared.value);
		const kek = await seKek(raw, unb64(slot.eph_pub), unb64(slot.se_pub));
		const dek = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: unb64(slot.iv), additionalData: slotAad("se", file.vault_id, slot.id) },
			kek,
			unb64(slot.wrapped),
		);
		return ok(new Uint8Array(dek));
	} catch {
		return err({ kind: "unlock", message: "se slot did not open (wrong key or slot from another vault)" });
	}
}

/** token KEK = HKDF-SHA256(token, salt vault_id|slot_id, info "jtk/token-kek/v1"). No UI, no chip. */
async function tokenKek(token: string, vaultId: string, slotId: string): Promise<CryptoKey> {
	const ikm = await crypto.subtle.importKey("raw", enc.encode(token), "HKDF", false, ["deriveKey"]);
	return crypto.subtle.deriveKey(
		{ name: "HKDF", hash: "SHA-256", salt: enc.encode(`${vaultId}|${slotId}`), info: enc.encode("jtk/token-kek/v1") },
		ikm,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

/** WRAP into a token slot: pure HKDF+AES-GCM, no biometrics. The token never enters the envelope. */
export async function wrapToken(
	dek: Uint8Array<ArrayBuffer>,
	vaultId: string,
	slotId: string,
	token: string,
): Promise<TokenSlot> {
	const kek = await tokenKek(token, vaultId, slotId);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const wrapped = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv, additionalData: slotAad("token", vaultId, slotId) },
		kek,
		dek,
	);
	return {
		kind: "token",
		id: slotId,
		created_at: new Date().toISOString(),
		iv: b64(iv),
		wrapped: b64(wrapped),
		token_id: tokenIdOf(token),
	};
}

/** UNWRAP a token slot. A mismatched token_id is rejected before any crypto, so a wrong file is cheap. */
export async function unlockWithToken(
	file: VaultFileV2,
	slot: TokenSlot,
	token: string,
): Promise<Result<Uint8Array<ArrayBuffer>, EnvelopeFailure>> {
	if (tokenIdOf(token) !== slot.token_id) {
		return err({ kind: "unlock", message: "unlock token does not match this slot" });
	}
	try {
		const kek = await tokenKek(token, file.vault_id, slot.id);
		const dek = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: unb64(slot.iv), additionalData: slotAad("token", file.vault_id, slot.id) },
			kek,
			unb64(slot.wrapped),
		);
		return ok(new Uint8Array(dek));
	} catch {
		return err({ kind: "unlock", message: "token slot did not open (wrong token or slot from another vault)" });
	}
}

/** The token slot this token opens, or null. Selection is by token_id — no unwrap attempt. */
export function pickTokenSlot(file: VaultFileV2, token: string): TokenSlot | null {
	const id = tokenIdOf(token);
	return file.slots.find((s): s is TokenSlot => s.kind === "token" && s.token_id === id) ?? null;
}

/** A slot id safe to pass as a CLI positional (base64url can start with "-" or "_"). */
export function newSlotId(): string {
	const raw = randomB64url(6);
	return /^[-_]/.test(raw) ? `x${raw.slice(1)}` : raw;
}

async function seal(dek: Uint8Array<ArrayBuffer>, vaultId: string, data: VaultData): Promise<VaultFileV2["data"]> {
	const key = await aesKey(dek, ["encrypt"]);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv, additionalData: dataAad(vaultId) },
		key,
		enc.encode(JSON.stringify(data)),
	);
	return { iv: b64(iv), ct: b64(ct) };
}

export async function openDataV2(
	file: VaultFileV2,
	dek: Uint8Array<ArrayBuffer>,
): Promise<Result<VaultData, EnvelopeFailure>> {
	try {
		const key = await aesKey(dek, ["decrypt"]);
		const pt = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: unb64(file.data.iv), additionalData: dataAad(file.vault_id) },
			key,
			unb64(file.data.ct),
		);
		const parsed = parseVaultData(JSON.parse(new TextDecoder().decode(pt)));
		return parsed.ok ? ok(parsed.data) : err({ kind: "corrupt" });
	} catch {
		return err({ kind: "corrupt" });
	}
}

/** New v2 envelope: random DEK + vault_id, data sealed, one se slot for the given SE key. */
export async function createEnvelopeV2(
	data: VaultData,
	se: SeKeyRef,
): Promise<{ file: VaultFileV2; dek: Uint8Array<ArrayBuffer> }> {
	const dek = newDek();
	const vaultId = randomB64url(16);
	const slot = await wrapSe(dek, vaultId, newSlotId(), se);
	const file: VaultFileV2 = {
		version: 2,
		vault_id: vaultId,
		fingerprint: await fingerprintOf(dek),
		data: await seal(dek, vaultId, data),
		slots: [slot],
	};
	return { file, dek };
}

/** New v2 envelope whose only slot is a local token slot — the no-Touch-ID default since 2026-10-30. */
export async function createEnvelopeTokenV2(
	data: VaultData,
	token: string,
): Promise<{ file: VaultFileV2; dek: Uint8Array<ArrayBuffer> }> {
	const dek = newDek();
	const vaultId = randomB64url(16);
	const slot = await wrapToken(dek, vaultId, newSlotId(), token);
	const file: VaultFileV2 = {
		version: 2,
		vault_id: vaultId,
		fingerprint: await fingerprintOf(dek),
		data: await seal(dek, vaultId, data),
		slots: [slot],
	};
	return { file, dek };
}

/** Re-seal the data under the same DEK (fresh IV); slots untouched. */
export async function resealV2(file: VaultFileV2, dek: Uint8Array<ArrayBuffer>, data: VaultData): Promise<VaultFileV2> {
	return { ...file, data: await seal(dek, file.vault_id, data) };
}

export function addSlot(file: VaultFileV2, slot: Slot): VaultFileV2 {
	return { ...file, slots: [...file.slots, slot] };
}

/** Remove one slot; the last remaining slot can never be removed (unlock-fail-closed invariant). */
export function removeSlot(file: VaultFileV2, id: string): Result<VaultFileV2, string> {
	if (!file.slots.some((s) => s.id === id)) return err(`no slot with id ${id}`);
	if (file.slots.length === 1) return err("refusing to remove the last slot — the vault would become unopenable");
	return ok({ ...file, slots: file.slots.filter((s) => s.id !== id) });
}

/**
 * Rekey (suspected leak): new DEK, data re-sealed, se slots re-wrapped from their public key
 * (no Touch ID), token slots re-wrapped with a token present in `opts.tokens`. Passkey slots and
 * token slots whose token is unavailable cannot be re-wrapped, so they are dropped and reported —
 * re-enroll passkeys through the WebUI, re-add tokens with `dogsout vault token-add`.
 */
export async function rekeyV2(
	file: VaultFileV2,
	data: VaultData,
	opts: { tokens?: string[] } = {},
): Promise<{ file: VaultFileV2; dek: Uint8Array<ArrayBuffer>; dropped: Slot[] }> {
	const dek = newDek();
	const tokens = opts.tokens ?? [];
	const slots: Slot[] = [];
	const dropped: Slot[] = [];
	for (const s of file.slots) {
		if (s.kind === "se") {
			slots.push(await wrapSe(dek, file.vault_id, s.id, { blob: s.blob, pub: s.se_pub }));
			continue;
		}
		if (s.kind === "token") {
			const token = tokens.find((t) => tokenIdOf(t) === s.token_id);
			if (token) {
				slots.push(await wrapToken(dek, file.vault_id, s.id, token));
				continue;
			}
		}
		dropped.push(s);
	}
	const next: VaultFileV2 = {
		...file,
		fingerprint: await fingerprintOf(dek),
		data: await seal(dek, file.vault_id, data),
		slots,
	};
	return { file: next, dek, dropped };
}
