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