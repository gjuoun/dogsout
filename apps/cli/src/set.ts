import {
	formatAddress,
	isOnePasswordRef,
	loadConfig,
	nowIso,
	openData,
	refKeyOf,
	saveData,
	writeConfig,
} from "@dogsout/core";
import { command, flag, positional, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { desugarAddress } from "./address-input.ts";
import { defaultIo, fail, type Io, runDogsout, withMeta } from "./cmd.ts";
import { ctxFromEnv } from "./context.ts";

export function setCommand(io: Io = defaultIo) {
	return withMeta(
		command({
			name: "set",
			description: "store a value from stdin; a value starting with op:// is kept as a 1password ref",
			args: {
				addr: positional({ type: string, displayName: "dogsout://vault/item/field | .vault.item.field" }),
				stdin: flag({ long: "stdin", description: "value is read from stdin (default behavior)" }),
			},
			handler: async ({ addr }): Promise<Result<string, string>> => {
				const parsed = desugarAddress(addr, { strict: true });
				if (parsed.isErr()) return err(parsed.error);
				// A leaf holds a value and nothing else: writing `field.sub` would make `field` both a value
				// and a branch, and it previously stored the value at `field` while the user said `field.sub`.
				const { subpath } = parsed.value;
				if (subpath.length > 0) {
					return fail(
						`set stores one whole value — "${addr}" ends in a subpath; drop .${subpath.join(".")} (subpaths are read-only via get)`,
					);
				}
				// TTY: prompt with hidden input instead of silently waiting on stdin.
				let value: string;
				if (process.stdin.isTTY) {
					process.stderr.write(`value for ${formatAddress(parsed.value)} (input hidden, Enter to finish): `);
					// raw mode disables the kernel tty's local echo; muted readline is NOT enough
					value = await new Promise<string>((resolve) => {
						let buf = "";
						process.stdin.setRawMode(true);
						process.stdin.resume();
						const finish = (v: string) => {
							process.stdin.setRawMode(false);
							process.stdin.pause();
							process.stdin.removeListener("data", onData);
							process.stderr.write("\n");
							resolve(v);
						};
						const onData = (chunk: Buffer) => {
							for (const byte of chunk) {
								if (byte === 0x0d || byte === 0x0a) return finish(buf);
								if (byte === 0x04) return finish(buf); // Ctrl-D
								if (byte === 0x03) return finish(""); // Ctrl-C aborts
								if (byte === 0x7f || byte === 0x08) buf = buf.slice(0, -1);
								else buf += String.fromCharCode(byte);
							}
						};
						process.stdin.on("data", onData);
					});
				} else {
					value = (await io.stdin()).replace(/\n$/, "");
				}
				if (value.length === 0) return fail("empty value refused");
				const ctxR = ctxFromEnv();
				if (ctxR.isErr()) return err(ctxR.error);
				const existingCfg = await loadConfig(ctxR.value.home);
				if (existingCfg.isErr()) return err(existingCfg.error);
				const addressKey = refKeyOf(formatAddress(parsed.value));
				if (addressKey === null) return fail(`cannot read "${addr}" as an address`);
				// A value that IS a reference is a pointer, not a secret: it belongs in config.json, needs
				// no unlock, and is not parsed here — a typo surfaces at read time as a typed error.
				if (isOnePasswordRef(value)) {
					existingCfg.value.refs[addressKey] = value;
					const w = await writeConfig(ctxR.value.home, existingCfg.value);
					if (w.isErr()) return err(w.error);
					return ok(`set ${addressKey} (1password ref)`);
				}
				if (existingCfg.value.refs[addressKey] !== undefined) {
					return fail(
						`${addressKey} is served by a 1password ref — set an op:// reference to replace it, or dogsout rm ${addressKey} first`,
					);
				}
				const opened = await openData(ctxR.value);
				if (opened.isErr()) return err(opened.error);
				const { envelope, data } = opened.value;
				const { vault, item, field } = parsed.value;
				data.vaults[vault] ??= {};
				const items = data.vaults[vault];
				if (!items[item]) items[item] = { fields: {}, updated_at: nowIso() };
				items[item].fields[field] = value;
				items[item].updated_at = nowIso();
				const saved = await saveData(ctxR.value, envelope, data);
				if (saved.isErr()) return err(saved.error);
				return ok(`set ${formatAddress(parsed.value)}`);
			},
		}),
		{ reads: ["config"], writes: ["vault", "config"], env: ["DOGSOUT_HOME", "DOGSOUT_SE_HELPER"] },
	);
}

export async function runSet(argv: string[], io: Io = defaultIo): Promise<Result<string, string>> {
	return runDogsout<string>(setCommand(io), argv);
}
