import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The WebUI's only durable state: an append-only record of every ask this process
 * served and what came back. Metadata only (aliases/addresses/hashes live inside
 * `keys_json`), never a credential value — PRD red line 1.
 *
 * `decision: "deny"` also covers timeout/fail-closed; `decided_at` stays null when no
 * human ever decided. F3's audit hash chain will link these rows; this table is the seed.
 */
export const askLog = sqliteTable("ask_log", {
	id: text("id").primaryKey(),
	principal: text("principal").notNull(),
	session_id: text("session_id"),
	requested_at: text("requested_at").notNull(),
	keys_json: text("keys_json").notNull(),
	key_count: integer("key_count").notNull(),
	decision: text("decision").notNull(),
	ttl: text("ttl"),
	decided_at: text("decided_at"),
	decided_via: text("decided_via"),
});

export type AskLogRow = typeof askLog.$inferSelect;
export type AskLogInsert = typeof askLog.$inferInsert;

/**
 * WebAuthn credentials allowed to approve (PRD §4: "Web 侧触摸验证用 WebAuthn").
 * The public key is not a secret; the private key never leaves the platform authenticator
 * (Touch ID / iCloud Keychain). `counter` is the clone-detection counter.
 */
export const webauthnCred = sqliteTable("webauthn_cred", {
	id: text("id").primaryKey(),
	public_key: text("public_key").notNull(),
	counter: integer("counter").notNull().default(0),
	transports: text("transports"),
	created_at: text("created_at").notNull(),
});

export type WebauthnCredRow = typeof webauthnCred.$inferSelect;
