import { z } from "zod";

/** Opening manifest an agent runner hands to jtk (batch invite at session start). */
export const SessionManifestSchema = z.object({
	id: z.string().min(1),
	principal: z.string().min(1),
	groups: z.array(z.string()).default([]),
	/** Aliases to invite up front; resolved against config at open time. */
	invites: z.array(z.string()).default([]),
});
export type SessionManifest = z.infer<typeof SessionManifestSchema>;

/** Persisted session record (sessions.json) — resume state, never values. */
export const SessionRecordSchema = z.object({
	id: z.string().min(1),
	principal: z.string().min(1),
	opened_at: z.string().min(1),
	/** Aliases approved in the last run of this session — the resume replay list. */
	last_approvals: z.array(z.string()).default([]),
	/** A resume replay is one-shot; replayed sessions never replay again. */
	replayed: z.boolean().default(false),
});
export type SessionRecord = z.infer<typeof SessionRecordSchema>;

export const SessionFileSchema = z.object({
	version: z.literal(1),
	sessions: z.array(SessionRecordSchema),
});
export type SessionFile = z.infer<typeof SessionFileSchema>;

export function emptySessionFile(): SessionFile {
	return { version: 1, sessions: [] };
}

export function parseSessionFile(raw: unknown): { ok: true; file: SessionFile } | { ok: false; error: string } {
	const r = SessionFileSchema.safeParse(raw);
	if (r.success) return { ok: true, file: r.data };
	const issue = r.error.issues[0] ?? { path: ["(root)"], message: "invalid session store" };
	const where = issue.path.join(".") || "(root)";
	return { ok: false, error: where + ": " + issue.message };
}
