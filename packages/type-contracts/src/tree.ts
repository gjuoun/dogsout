import { z } from "zod";

/**
 * Leaf metadata of the vault tree (`dogsout tree`): one field address plus facts about its value —
 * never the value itself (PRD red line 1). Fixed here so the CLI output, the API and a future
 * SQLite store agree on one shape instead of each inventing its own.
 */
export const FieldMetaSchema = z.object({
	/** Canonical address of this leaf: dogsout://<vault>/<item>/<field>. */
	address: z.string().min(1),
	/** Masked digest, same format `get` prints: "sha256:" plus 8 hex chars, not reversible. */
	value_hash: z.string().regex(/^sha256:[0-9a-f]{8}$/),
	/** Value length in bytes — metadata, never content. */
	bytes: z.number().int().nonnegative(),
	/** When the owning item was last written (ISO 8601). */
	updated_at: z.string().min(1),
});
export type FieldMeta = z.infer<typeof FieldMetaSchema>;

/**
 * A node of the vault trie: segment name -> child node, down to `FieldMeta` leaves. A node is
 * either a branch (a map of segments) or a leaf (metadata) — never both.
 */
export type TreeNode = { [segment: string]: FieldMeta | TreeNode };

export const TreeNodeSchema: z.ZodType<TreeNode> = z.lazy(() =>
	z.record(z.string(), z.union([FieldMetaSchema, TreeNodeSchema])),
);

export function parseTreeNode(raw: unknown): { ok: true; tree: TreeNode } | { ok: false; error: string } {
	const r = TreeNodeSchema.safeParse(raw);
	if (r.success) return { ok: true, tree: r.data };
	const issue = r.error.issues[0] ?? { path: ["(root)"], message: "invalid tree node" };
	return { ok: false, error: `${issue.path.join(".") || "(root)"}: ${issue.message}` };
}
