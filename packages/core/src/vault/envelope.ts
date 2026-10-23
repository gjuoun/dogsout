import {
	type PasskeySlot,
	parseVaultData,
	type SeSlot,
	type Slot,
	type VaultData,
	type VaultFileV2,
} from "@dogsout/type-contracts";
import { err, ok, type Result } from "neverthrow";

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
	// base64url ids can start with "-" or "_", which CLI parsers read as a flag;
	// force an alphanumeric head so slot ids are always safe as positionals.
	const rawSlotId = randomB64url(6);
	const slotId = /^[-_]/.test(rawSlotId) ? `x${rawSlotId.slice(1)}` : rawSlotId;
	const slot = await wrapSe(dek, vaultId, slotId, se);
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
 * Rekey (suspected leak): new DEK, data re-sealed, every se slot re-wrapped from its public key
 * (no Touch ID). Passkey slots cannot be re-wrapped without the PRF output, so they are dropped
 * and reported — re-enroll them through the WebUI.
 */
export async function rekeyV2(
	file: VaultFileV2,
	data: VaultData,
): Promise<{ file: VaultFileV2; dek: Uint8Array<ArrayBuffer>; dropped: PasskeySlot[] }> {
	const dek = newDek();
	const se = file.slots.filter((s): s is SeSlot => s.kind === "se");
	const dropped = file.slots.filter((s): s is PasskeySlot => s.kind === "passkey");
	const slots: Slot[] = [];
	for (const s of se) slots.push(await wrapSe(dek, file.vault_id, s.id, { blob: s.blob, pub: s.se_pub }));
	const next: VaultFileV2 = {
		...file,
		fingerprint: await fingerprintOf(dek),
		data: await seal(dek, file.vault_id, data),
		slots,
	};
	return { file: next, dek, dropped };
}
