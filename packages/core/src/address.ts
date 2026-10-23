import { err, ok, type Result } from "neverthrow";

export interface ParsedAddress {
	vault: string;
	item: string;
	field: string;
	subpath: string[];
}

/** dogsout://<vault>/<item>/<field>[.sub.path] — first dot-segment is the field, the rest digs into JSON values. */
export function parseAddress(input: string): Result<ParsedAddress, string> {
	if (!input.startsWith("dogsout://")) return err(`not a dogsout:// address: ${input}`);
	const rest = input.slice("dogsout://".length);
	const parts = rest.split("/").filter((s) => s.length > 0);
	if (parts.length !== 3) return err("address must be dogsout://<vault>/<item>/<field>[.sub.path]");
	const [vault, item, tail] = parts as [string, string, string];
	const segs = tail.split(".").filter((s) => s.length > 0);
	if (segs.length === 0) return err("field part is empty");
	const field = segs[0] as string;
	const subpath = segs.slice(1);
	return ok({ vault, item, field, subpath });
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
