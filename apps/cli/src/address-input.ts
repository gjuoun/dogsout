import { type ParsedAddress, SEGMENT_RE, type SegmentKind, segmentProblem } from "@dogsout/core";
import { err, ok, type Result } from "neverthrow";

/**
 * CLI input sugar for addresses — jq conventions, and *only* here: the stored/contractual form is
 * and stays `dogsout://<vault>/<item>/<field>`.
 *
 *   dogsout://dev/gh/pat        canonical
 *   .dev.gh.pat                 leading dot, the jq shape
 *   dev.gh.pat                  bare dotted (the `set gh` ambiguity is refused, not guessed)
 *   .gcp.sa.key["client.email"] bracket-quoted subpath key: address segments are lowercase
 *                               [a-z0-9_-] tokens, so a dot inside a name is always a JSON key
 */
const SCHEME = "dogsout://";
const ADDRESS_FORM = "dogsout://dev/zai/api_key";

/** Index of the closing bracket of a quoted segment, skipping `]` inside the JSON string. */
function bracketEnd(input: string, start: number): number {
	let inString = false;
	let escaped = false;
	for (let i = start + 1; i < input.length; i++) {
		const ch = input[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (ch === "\\" && inString) {
			escaped = true;
			continue;
		}
		if (ch === '"') inString = !inString;
		else if (ch === "]" && !inString) return i;
	}
	return -1;
}

/** Split on `.` / `/` outside brackets; a bracket group contributes one JSON-string segment. */
function tokenize(body: string): Result<string[], string> {
	const segments: string[] = [];
	let current = "";
	const flush = () => {
		if (current.length > 0) segments.push(current);
		current = "";
	};
	for (let i = 0; i < body.length; i++) {
		const ch = body[i] as string;
		if (ch === "." || ch === "/") {
			flush();
			continue;
		}
		if (ch === "[") {
			flush();
			const end = bracketEnd(body, i);
			if (end === -1) return err(`unclosed bracket segment in "${body}" — write a quoted key, e.g. ["client.email"]`);
			let key: unknown;
			try {
				key = JSON.parse(body.slice(i + 1, end));
			} catch {
				return err(`malformed bracket segment in "${body}" — quote the key as JSON, e.g. ["client.email"]`);
			}
			if (typeof key !== "string" || key.length === 0) return err(`bracket segment must be a non-empty string`);
			segments.push(key);
			i = end;
			continue;
		}
		current += ch;
	}
	flush();
	return ok(segments);
}

/** Strip the scheme and one optional leading dot, then split into segments. */
function segmentsOf(input: string): Result<string[], string> {
	const trimmed = input.trim();
	if (trimmed.length === 0) return err(`empty address — write ${ADDRESS_FORM}`);
	const body = trimmed.startsWith(SCHEME) ? trimmed.slice(SCHEME.length) : trimmed.replace(/^\./, "");
	return tokenize(body);
}

const KIND_BY_INDEX: readonly SegmentKind[] = ["vault", "item", "field"];

/**
 * `strict` is the write path (set / alias / map): the segments must satisfy the charset. The read
 * path (get / rm) parses the shape only, so a pre-charset address stays readable and removable —
 * that is how the `ls` report gets acted on.
 */
export interface DesugarOptions {
	strict?: boolean;
}

/**
 * A field-level address from canonical or sugared input. Two segments name an item, not a leaf,
 * and one segment names nothing: both are refused with the full form instead of being guessed.
 */
export function desugarAddress(input: string, opts: DesugarOptions = {}): Result<ParsedAddress, string> {
	const segs = segmentsOf(input);
	if (segs.isErr()) return err(segs.error);
	const parts = segs.value;
	const shown = input.trim();
	if (parts.length === 1) {
		return err(`cannot read "${shown}" as an address — write at least .vault.item or the full form ${ADDRESS_FORM}`);
	}
	if (parts.length === 2) {
		return err(`"${shown}" names an item, not a field — values live at <vault>.<item>.<field> (e.g. ${shown}.key)`);
	}
	if (opts.strict === true) {
		for (let i = 0; i < 3; i++) {
			const problem = segmentProblem(KIND_BY_INDEX[i] as SegmentKind, parts[i] as string);
			if (problem !== null) return err(problem);
		}
	}
	return ok({
		vault: parts[0] as string,
		item: parts[1] as string,
		field: parts[2] as string,
		subpath: parts.slice(3),
	});
}

/** A resolved match pattern plus whether it points at exactly one field. */
export interface PathPattern {
	/** Segments to glob: `*` is one segment, `**` is the rest of the subtree. */
	pattern: string[];
	/** true when the input named one field, so an empty result is a miss, not an empty listing. */
	literalField: boolean;
	/** The input as written, for error messages. */
	source: string;
}

/**
 * A `ls` / `tree` argument: a literal field address, or a subtree prefix. Anything shorter than
 * vault/item/field is a prefix, so `dev` means `dev.**` and `dev.gh` means `dev.gh.**`; a pattern
 * that already ends in `**`, and anything that already names a field, is taken as written.
 * Subpaths are not patterns (the leaves are fields).
 */
export function expandPattern(input: string): Result<PathPattern, string> {
	const segs = segmentsOf(input);
	if (segs.isErr()) return err(segs.error);
	const parts = segs.value;
	const shown = input.trim();
	if (parts.length > 3) {
		return err(`"${shown}" addresses a subpath — ls/tree match field addresses (vault/item/field), not subpaths`);
	}
	for (let i = 0; i < parts.length; i++) {
		const seg = parts[i] as string;
		if (seg === "*" || seg === "**") continue;
		if (seg.includes("*")) return err(`"${seg}": a glob segment is exactly * or **, not a partial one`);
		const problem = segmentProblem(KIND_BY_INDEX[i] as SegmentKind, seg);
		if (problem !== null) return err(problem);
	}
	const literalField = parts.length === 3 && parts.every((s) => !s.includes("*"));
	const endsDeep = parts[parts.length - 1] === "**";
	const prefix = parts.length < 3 && !endsDeep ? [...parts, "**"] : parts;
	return ok({ pattern: prefix, literalField, source: shown });
}

/** True when every segment already satisfies the charset (used by callers that only warn). */
export function isPlainSegment(seg: string): boolean {
	return SEGMENT_RE.test(seg);
}
