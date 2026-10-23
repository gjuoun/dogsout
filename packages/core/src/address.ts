import { err, ok, type Result } from "neverthrow";

export interface ParsedAddress {
	vault: string;
	item: string;
	field: string;
	subpath: string[];
}

/**
 * One address segment. Lowercase tokens only: a dot is the segment separator, so it can never be
 * part of a name — that is what keeps `dev.gh.pat` unambiguous as input sugar and as a glob.
 */
export const SEGMENT_RE = /^[a-z0-9_-]+$/;

export type SegmentKind = "vault" | "item" | "field";

/** The canonical shape quoted in every rejection: what the caller should write instead. */
const ADDRESS_HINT = "dogsout://dev/gh/pat";

export function isSegment(seg: string): boolean {
	return SEGMENT_RE.test(seg);
}

/** Why `seg` cannot be a `kind` segment, or null when it can. */
export function segmentProblem(kind: SegmentKind, seg: string): string | null {
	if (isSegment(seg)) return null;
	return `invalid ${kind} segment "${seg}": addresses use [a-z0-9_-] only (lowercase, no dots) — e.g. ${ADDRESS_HINT}`;
}

/** One stored address whose segment charset predates the rule (report-only: never rewritten). */
export interface AddressViolation {
	address: string;
	kind: SegmentKind;
	segment: string;
}

/** One line per offending address, naming every offending segment (a report, not a rewrite). */
export interface AddressGroup {
	address: string;
	segments: string[];
}

export function groupViolations(violations: readonly AddressViolation[]): AddressGroup[] {
	const byAddress = new Map<string, string[]>();
	for (const v of violations) {
		const segments = byAddress.get(v.address) ?? [];
		segments.push(`${v.kind} "${v.segment}"`);
		byAddress.set(v.address, segments);
	}
	return [...byAddress].map(([address, segments]) => ({ address, segments }));
}

function problemsOf(segs: Record<SegmentKind, string>): string | null {
	const problems = (["vault", "item", "field"] as const)
		.map((kind) => segmentProblem(kind, segs[kind]))
		.filter((p): p is string => p !== null);
	return problems.length > 0 ? problems.join("; ") : null;
}

/**
 * Offending segments of one stored address — tolerant on purpose: this feeds the `ls` / `migrate`
 * legacy report, where a malformed address must show up as a line, never as an exception.
 */
export function scanAddress(address: string): AddressViolation[] {
	if (!address.startsWith("dogsout://")) return [];
	const parts = address
		.slice("dogsout://".length)
		.split("/")
		.filter((s) => s.length > 0);
	if (parts.length !== 3) return [];
	const [vault, item, tail] = parts as [string, string, string];
	const field = tail.split(".")[0] ?? "";
	const segs: Record<SegmentKind, string> = { vault, item, field };
	const out: AddressViolation[] = [];
	for (const kind of ["vault", "item", "field"] as const) {
		if (!isSegment(segs[kind])) out.push({ address, kind, segment: segs[kind] });
	}
	return out;
}

/** Shape only: the three segments and the subpath, whatever characters they happen to hold. */
function shapeAddress(input: string): Result<ParsedAddress, string> {
	if (!input.startsWith("dogsout://")) return err(`not a dogsout:// address: ${input}`);
	const rest = input.slice("dogsout://".length);
	const parts = rest.split("/").filter((s) => s.length > 0);
	if (parts.length !== 3) return err("address must be dogsout://<vault>/<item>/<field>[.sub.path]");
	const [vault, item, tail] = parts as [string, string, string];
	const segs = tail.split(".").filter((s) => s.length > 0);
	if (segs.length === 0) return err("field part is empty");
	// Subpath keys are JSON keys, not address segments: they keep whatever characters they have.
	return ok({ vault, item, field: segs[0] as string, subpath: segs.slice(1) });
}

/**
 * dogsout://<vault>/<item>/<field>[.sub.path] — first dot-segment is the field, the rest digs into
 * JSON values. Tolerant on purpose: this is the read/cleanup parse. Legacy addresses written before
 * the charset rule stay readable (`get`) and removable (`rm`), which is what makes the `ls` report
 * actionable; new writes go through `parseAddressStrict`.
 */
export function parseAddress(input: string): Result<ParsedAddress, string> {
	return shapeAddress(input);
}

/** The write-path parse: same shape, plus the segment charset. */
export function parseAddressStrict(input: string): Result<ParsedAddress, string> {
	const parsed = shapeAddress(input);
	if (parsed.isErr()) return err(parsed.error);
	const { vault, item, field } = parsed.value;
	const problem = problemsOf({ vault, item, field });
	if (problem !== null) return err(problem);
	return parsed;
}

export function formatAddress(a: ParsedAddress): string {
	const tail = [a.field, ...a.subpath].join(".");
	return `dogsout://${a.vault}/${a.item}/${tail}`;
}

/** Item-level address dogsout://<vault>/<item> — used by --from spreading. */
export function parseItemRef(input: string): Result<{ vault: string; item: string }, string> {
	if (!input.startsWith("dogsout://")) return err(`not a dogsout:// address: ${input}`);
	const parts = input
		.slice("dogsout://".length)
		.split("/")
		.filter((s) => s.length > 0);
	if (parts.length !== 2) return err("item address must be dogsout://<vault>/<item>");
	return ok({ vault: parts[0] as string, item: parts[1] as string });
}

/** Resolve a name that may be an alias (config) or a literal dogsout:// address. */
export function resolveName(name: string, aliases: Record<string, string>): Result<string, string> {
	if (name.startsWith("dogsout://")) return ok(name);
	const hit = aliases[name];
	return hit ? ok(hit) : err(`unknown alias and not an address: ${name}`);
}

/** Dig a dotted subpath into a JSON field value (F1 subset). */
export function digSubpath(value: string, subpath: string[]): Result<string, string> {
	if (subpath.length === 0) return ok(value);
	let cur: unknown;
	try {
		cur = JSON.parse(value);
	} catch {
		return err("field value is not JSON but a subpath was requested");
	}
	for (const seg of subpath) {
		if (cur === null || typeof cur !== "object") return err(`subpath ${seg} hits a non-object`);
		cur = (cur as Record<string, unknown>)[seg];
	}
	if (cur === undefined) return err("subpath resolved to undefined");
	return ok(typeof cur === "string" ? cur : JSON.stringify(cur));
}
