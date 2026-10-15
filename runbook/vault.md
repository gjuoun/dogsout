# vault

The vault has one format (v2, since the 2026-10-14 cold cut): a random data key (DEK) encrypts everything once; each unlock slot holds a copy of the DEK wrapped by that factor. Today the only slot kind is `se` — a Secure Enclave key opened with Touch ID (login-password fallback). There is no master password; a `version: 1` file is refused.

## Fake helper (automatable, CI-equivalent)

```bash
export JTK_HOME="$(mktemp -d /tmp/jtk-vault.XXXXXX)" JTK_SE_HELPER="$PWD/packages/core/src/vault/helper/fake-se.ts"
bun apps/cli/src/main.ts init                                       # initialized … (vault v2, fingerprint XXXX-XXXX) + 1-factor warning
echo FAKE-a | bun apps/cli/src/main.ts set jtk://dev/gh/a --stdin
echo FAKE-b | bun apps/cli/src/main.ts set jtk://dev/gh/b --stdin
echo FAKE-c | bun apps/cli/src/main.ts set jtk://dev/gh/c --stdin
bun apps/cli/src/main.ts vault status                               # se <id> … Touch ID · this Mac; backups: 2
FAKE_SE_MODE=deny bun apps/cli/src/main.ts get jtk://dev/gh/a; echo "exit=$?"   # vault unlock failed …, exit=1

# corruption → restore promotes the newest backup (= the state before the last write)
echo '{ broken' > "$JTK_HOME/vault.enc"
bun apps/cli/src/main.ts get jtk://dev/gh/a; echo "exit=$?"     # vault corrupt — backup vault.enc.bak.1 exists: run jtk vault restore, exit=1
bun apps/cli/src/main.ts vault restore                              # restored vault.enc.bak.1 → vault.enc (previous file kept as vault.enc.broken)
bun apps/cli/src/main.ts get jtk://dev/gh/b --reveal                # FAKE-b (c was the lost last write)

bun apps/cli/src/main.ts vault rekey                                # rekeyed: fingerprint A → B; backups cleared
bun apps/cli/src/main.ts vault slot rm "$(bun -e 'console.log(JSON.parse(await Bun.file(process.env.JTK_HOME + "/vault.enc").text()).slots[0].id)')"; echo "exit=$?"   # refusing to remove the last slot …, exit=1

# a v1 (password) file is refused
echo '{"version":1,"kdf":{},"iv_b64":"x","ct_b64":"y"}' > "$JTK_HOME/vault.enc"
bun apps/cli/src/main.ts vault status; echo "exit=$?"             # vault v1 is no longer supported …, exit=1
rm -rf "$JTK_HOME"
```

## Real Secure Enclave (macOS, one Touch ID per command)

```bash
bash apps/ask/build.sh                                              # ~/.bun/bin/jtk-approve … {"se":"ok"} (no Touch ID)
export JTK_HOME="$(mktemp -d /tmp/jtk-vault-real.XXXXXX)"; unset JTK_SE_HELPER
bun apps/cli/src/main.ts init                                       # Touch ID ×1 (test unlock)
echo FAKE-real | bun apps/cli/src/main.ts set jtk://dev/x/y --stdin   # Touch ID ×1
bun apps/cli/src/main.ts get jtk://dev/x/y --reveal                 # Touch ID ×1 → FAKE-real
rm -rf "$JTK_HOME"
```

This section needs a human finger and is not automatable; everything else above is.

**Proves**: no password anywhere; `status` never prompts; a cancelled Touch ID is exit 1 (fail-closed); every write keeps `vault.enc.bak.1/.bak.2`; restore never happens silently; the last slot cannot be removed; v1 files are refused. Invariants: `v2-at-least-one-slot`, `backup-verified-before-rotate`, `unlock-fail-closed` in `apps/cli/src/intent.ts`.
