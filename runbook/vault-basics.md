# vault-basics

init → set → get (masked / reveal) → alias → run injection, in a temporary home. Run from the repo root.

```bash
export JTK_HOME="$(mktemp -d /tmp/jtk-vb.XXXXXX)" JTK_SE_HELPER="$PWD/packages/core/src/vault/helper/fake-se.ts"
bun apps/cli/src/main.ts init                                            # initialized … (vault v2, fingerprint …)
echo "sk-test-001" | bun apps/cli/src/main.ts set jtk://dev/zai/api_key --stdin
bun apps/cli/src/main.ts get jtk://dev/zai/api_key                      # sha256:xxxxxxxx (11 bytes, --reveal to show)
bun apps/cli/src/main.ts get jtk://dev/zai/api_key --reveal             # sk-test-001
bun apps/cli/src/main.ts alias ZAI_API_KEY jtk://dev/zai/api_key
# with no rule, run is fail-closed (ask has no channel) — allow everything for the basic loop; approvals: policy-approval.md
bun apps/cli/src/main.ts policy config rule add '{"id":"allow-all","principal":"*","resource":"*","decide":"allow"}'
bun apps/cli/src/main.ts run --env ZAI_API_KEY -- sh -c 'test "$ZAI_API_KEY" = sk-test-001'; echo "exit=$?"   # exit=0
stat -f '%Lp' "$JTK_HOME/vault.enc"                                   # 600
rm -rf "$JTK_HOME"
```

**Proves**: default `get` prints no plaintext (digest line only); the child process sees the value; vault.enc is 0600. Invariants: `no-plaintext-default`, `unlock-fail-closed` in `apps/cli/src/intent.ts`.
