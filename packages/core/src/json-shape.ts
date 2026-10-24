/**
 * The *structure* of a stored JSON value, and nothing else: key names plus a type tag per leaf.
 * No value ever enters this module's output — that is what lets `ls` grow into a JSON object
 * without breaking PRD red line 1 (a value leaves only through `get --reveal`).
 */
export type JsonShape =
	| { kind: "branch"; children: { key: string; shape: JsonShape }[] }
	| { kind: "leaf"; annotation: string };

/** Guard against a pathological (or hostile) value: past this depth it is one opaque leaf. */
export const MAX_JSON_DEPTH = 64;

/**
 * Classify a stored value: a non-empty object becomes a branch (its keys are the next path
 * segments), everything else is a single leaf annotated with its type. `null` means the value
 * is not JSON at all, so the field stays what it always was: one metadata leaf.
 */
export function jsonShapeOf(value: string): JsonShape | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return null;
	}
	return shapeOf(parsed, 0);
}

function shapeOf(value: unknown, depth: number): JsonShape {
	if (depth >= MAX_JSON_DEPTH) return { kind: "leaf", annotation: "too-deep" };
	if (Array.isArray(value)) return { kind: "leaf", annotation: `array(${value.length})` };
	if (value === null) return { kind: "leaf", annotation: "null" };
	if (typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>);
		// `{}` has no structure to grow into, so it stays one leaf instead of an empty branch.
		if (entries.length === 0) return { kind: "leaf", annotation: "object(0)" };
		return {
			kind: "branch",
			children: entries.map(([key, child]) => ({ key, shape: shapeOf(child, depth + 1) })),
		};
	}
	return { kind: "leaf", annotation: typeof value };
}

/**
 * One segment of a jq path: `.key` when the key is a plain identifier, `["key"]` otherwise —
 * the two forms the address sugar already reads back, so a printed path is always feedable
 * to `get` (`client.email` -> `["client.email"]`, `0` -> `["0"]`).
 */
export function jqSegment(key: string): string {
	return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}
