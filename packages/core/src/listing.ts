import type { FieldMeta, TreeNode } from "@dogsout/type-contracts";
import { err, ok, type Result } from "neverthrow";
import { type JsonShape, jqSegment, jsonShapeOf } from "./json-shape.ts";
import { fieldMeta, type PathEntry } from "./tree.ts";

/**
 * One node of the `ls` listing — the single tree the three views render: the TTY draws it with
 * connectors, a pipe prints `jq` for every leaf, `--json` turns it into the trie. A JSON object
 * field grows into its keys here, so a node's `meta` is null when it exists only inside a value.
 */
export interface ListingNode {
	/** Segment key: a vault/item/field name, or a JSON object key. */
	name: string;
	/** Absolute jq path from the vault root — always feedable to `get`, whatever depth the view is rooted at. */
	jq: string;
	/** Leaf metadata for a stored field; null for a node inside a JSON value. */
	meta: FieldMeta | null;
	/** Human-only type note, set on a stored field whose value is non-object JSON (`array(3)`, `number`). */
	annotation?: string;
	children: ListingNode[];
}

/** Mutable build node; a Map keeps `__proto__` an ordinary key instead of a prototype write. */
interface Scaffold {
	name: string;
	jq: string;
	meta: FieldMeta | null;
	annotation?: string;
	children: Map<string, Scaffold>;
}

/**
 * Fold the selected entries into the listing, rooted at `depth` (0 = vaults, 1 = items,
 * 2 = fields) — exactly where the pattern pinned it. A field whose value is a JSON object
 * replaces its metadata leaf with that object's structure; a field holding an array or a scalar
 * stays one leaf, annotated. Values never enter the node — only `fieldMeta` (metadata) and the
 * JSON *shape* (key names + type tags) do.
 *
 * The invariants the address grammar promises are checked here: a node holds either a value or
 * children, never both, and one path appears once.
 */
export async function buildListing(
	entries: readonly PathEntry[],
	depth: number,
): Promise<Result<ListingNode[], string>> {
	const root: Scaffold = { name: "", jq: "", meta: null, children: new Map() };
	for (const entry of entries) {
		if (entry.path.length === 0) return err(`empty path: ${entry.address}`);
		let node = root;
		let jq = "";
		for (let i = 0; i < entry.path.length; i++) {
			const seg = entry.path[i] as string;
			const atLeaf = i === entry.path.length - 1;
			jq += `.${seg}`;
			const existing = node.children.get(seg);
			if (atLeaf) {
				if (existing) {
					return err(
						existing.meta === null && existing.children.size > 0
							? `${entry.path.slice(0, i + 1).join("/")} is both a value and a branch`
							: `duplicate path: ${entry.address}`,
					);
				}
				const leaf: Scaffold = { name: seg, jq, meta: await fieldMeta(entry), children: new Map() };
				expandShape(leaf, jsonShapeOf(entry.value));
				node.children.set(seg, leaf);
				continue;
			}
			if (existing) {
				if (existing.meta !== null || existing.children.size === 0) {
					return err(
						`${entry.path.slice(0, i + 1).join("/")} is both a value and a branch (path prefix of ${entry.address})`,
					);
				}
				node = existing;
				continue;
			}
			const child: Scaffold = { name: seg, jq, meta: null, children: new Map() };
			node.children.set(seg, child);
			node = child;
		}
	}
	return ok(rootsAt(root, depth).map(toNode));
}

/** Grow a stored field into its JSON structure; a non-object value only adds a type note. */
function expandShape(leaf: Scaffold, shape: JsonShape | null): void {
	if (shape === null) return;
	if (shape.kind === "leaf") {
		leaf.annotation = shape.annotation;
		return;
	}
	leaf.meta = null;
	leaf.children = shapeChildren(shape, leaf.jq);
}

function shapeChildren(shape: Extract<JsonShape, { kind: "branch" }>, baseJq: string): Map<string, Scaffold> {
	const children = new Map<string, Scaffold>();
	for (const child of shape.children) {
		const jq = baseJq + jqSegment(child.key);
		const node: Scaffold = { name: child.key, jq, meta: null, children: new Map() };
		if (child.shape.kind === "branch") node.children = shapeChildren(child.shape, jq);
		children.set(child.key, node);
	}
	return children;
}

/** The nodes the view is rooted at: 0 keeps the vaults, 1 the items, 2 the fields. */
function rootsAt(root: Scaffold, depth: number): Scaffold[] {
	let level = [...root.children.values()];
	for (let i = 0; i < depth; i++) level = level.flatMap((n) => [...n.children.values()]);
	return level;
}

function toNode(node: Scaffold): ListingNode {
	const out: ListingNode = {
		name: node.name,
		jq: node.jq,
		meta: node.meta,
		children: [...node.children.values()].map(toNode),
	};
	if (node.annotation !== undefined) out.annotation = node.annotation;
	return out;
}

/**
 * The `--json` view: branches become objects, a stored field becomes its metadata, and a node
 * that exists only inside a JSON value becomes `null` — structure with no value, per the card.
 * `Object.fromEntries` defines own properties, so a JSON key named `__proto__` stays a key.
 */
export function listingToTrie(nodes: readonly ListingNode[]): TreeNode {
	return Object.fromEntries(nodes.map((node) => [node.name, trieOf(node)])) as TreeNode;
}

function trieOf(node: ListingNode): FieldMeta | null | TreeNode {
	if (node.children.length === 0) return node.meta;
	return Object.fromEntries(node.children.map((child) => [child.name, trieOf(child)])) as TreeNode;
}
