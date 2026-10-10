import { z } from "zod";
import { TtlTierSchema } from "./ask.ts";

/** Approval record — metadata only, never values (PRD red line 1). */
export const GrantMetaSchema = z.object({
	id: z.string().min(1),
	principal: z.string().min(1),
	alias: z.string().min(1),
	address: z.string().min(1),
	value_hash: z.string().min(1),
	ttl: TtlTierSchema,
	approved_via: z.string().min(1),
	approved_at: z.string().min(1),
	/** Absolute expiry (ISO); null for session-tier grants (die with session end). */
	expires_at: z.string().min(1).nullable(),
	/** Session this grant belongs to (session tier, or approvals made inside a session). */
	session: z.string().optional(),
	/** once-tier grants are consumed on first use. */
	consumed: z.boolean().default(false),
});
export type GrantMeta = z.infer<typeof GrantMetaSchema>;

/** grants.json — the whole persisted store (0600 atomic writes, JTK_HOME). */
export const GrantsFileSchema = z.object({
	version: z.literal(1),
	grants: z.array(GrantMetaSchema),
});
export type GrantsFile = z.infer<typeof GrantsFileSchema>;

export function emptyGrants(): GrantsFile {
	return { version: 1, grants: [] };
}

export function parseGrantsFile(raw: unknown): { ok: true; file: GrantsFile } | { ok: false; error: string } {
	const r = GrantsFileSchema.safeParse(raw);
	if (r.success) return { ok: true, file: r.data };
	const issue = r.error.issues[0] ?? { path: ["(root)"], message: "invalid grants store" };
	const where = issue.path.join(".") || "(root)";
	return { ok: false, error: where + ": " + issue.message };
}
