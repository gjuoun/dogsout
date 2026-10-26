#!/usr/bin/env bun
// TEST-ONLY fake of the 1Password resolver, selected through DOGSOUT_1P_HELPER (mirrors fake-se.ts).
// The helper module must export createResolver(): RefResolver.
//
//   FAKE_1P_MAP     path to a JSON file { "<op://ref>": "<value>" }
//   FAKE_1P_CALLS   path to a file; one line per reference per resolve() call (proves "zero reads")
//   FAKE_1P_MODE    missing-token | deny  (otherwise the map answers)
import { appendFileSync, readFileSync } from "node:fs";
import { err, ok, type Result } from "neverthrow";
import type { RefFailure, RefResolver } from "../onepassword.ts";

function readMap(): Record<string, string> {
	const path = process.env.FAKE_1P_MAP;
	if (!path) return {};
	try {
		return JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
	} catch {
		return {};
	}
}

export function createResolver(): RefResolver {
	return {
		async resolve(refs: readonly string[]): Promise<Result<Map<string, string>, RefFailure>> {
			const calls = process.env.FAKE_1P_CALLS;
			if (calls) for (const ref of refs) appendFileSync(calls, ref + "\n");
			const mode = process.env.FAKE_1P_MODE;
			if (mode === "missing-token") {
				return err({
					kind: "missing-token",
					message: "no service account token (OP_SERVICE_ACCOUNT_TOKEN unset and ~/.config/op/sa-token unreadable)",
				});
			}
			if (mode === "deny") return err({ kind: "resolve", ref: refs[0] ?? "op://", message: "fake: denied" });
			const map = readMap();
			const out = new Map<string, string>();
			const missing: string[] = [];
			for (const ref of refs) {
				const value = map[ref];
				if (value === undefined) missing.push(ref);
				else out.set(ref, value);
			}
			if (missing.length > 0) {
				return err({ kind: "resolve", ref: missing[0] as string, message: "no value for " + missing[0] });
			}
			return ok(out);
		},
	};
}
