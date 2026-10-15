# policy-approval

Rules → decision → approval → grants, end to end, with the fake approval helper instead of a real window.

```bash
export JTK_HOME="$(mktemp -d /tmp/jtk-pa.XXXXXX)" JTK_SE_HELPER="$PWD/packages/core/src/vault/helper/fake-se.ts"
export JTK_APPROVE_HELPER="$PWD/packages/core/src/ask/helper/fake-approve.ts"
bun apps/cli/src/main.ts init >/dev/null
echo "sk-pol-1" | bun apps/cli/src/main.ts set jtk://dev/zai/api_key --stdin
bun apps/cli/src/main.ts alias ZAI_API_KEY jtk://dev/zai/api_key

# no rule → default ask: the fake approves once, a grant lands on disk (metadata only)
bun apps/cli/src/main.ts run --env ZAI_API_KEY -- sh -c 'echo ok'      # ok; grants.json appears
bun apps/cli/src/main.ts grants ls                                     # principal  alias  ttl=…

# deny mode: fail-closed, the child never starts (a fresh principal, so the grant above does not apply)
JTK_PRINCIPAL=other@x FAKE_APPROVE_MODE=deny bun apps/cli/src/main.ts run --env ZAI_API_KEY -- sh -c "touch $JTK_HOME/pwned"; echo "exit=$? pwned=$(test -e $JTK_HOME/pwned && echo yes || echo no)"   # exit≠0 pwned=no

# rules and dry runs
bun apps/cli/src/main.ts policy config rule add '{"id":"r1","principal":"*","resource":"ZAI_*","decide":"allow"}'
bun apps/cli/src/main.ts policy simulate --alias ZAI_API_KEY           # allow [rule:r1]
bun apps/cli/src/main.ts policy why --alias ZAI_API_KEY                # decision + grant state

# session: one manifest invite, the grant is withdrawn when run ends; --resume replays once
printf '{"id":"s1","principal":"a@x","groups":[],"invites":["ZAI_API_KEY"]}' > "$JTK_HOME/s.json"
bun apps/cli/src/main.ts run --session "$JTK_HOME/s.json" --env ZAI_API_KEY -- sh -c 'true'
rm -rf "$JTK_HOME"
```

**Proves**: only ask writes grants.json and it carries no values; deny / timeout / no channel = refusal; a session's grants end with it; rotating a value invalidates its grant (value_hash mismatch). Invariant: `metadata-only-persist`.
