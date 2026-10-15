# api-skeleton (exp)

Hono + OpenAPI skeleton (`apps/api/`). Not wired to the CLI yet — not a production service.

```bash
bun apps/api/src/server.ts 8787 & API_PID=$!                 # record the PID for cleanup
sleep 1
curl -s http://127.0.0.1:8787/health                        # {"ok":true,"milestone":"F2-skeleton"}
curl -s http://127.0.0.1:8787/doc | head -c 200             # OpenAPI JSON
kill "$API_PID"
```

**Proves**: /health ok=true; /doc returns the OpenAPI document; the port is released after killing the recorded PID. Paste the curl output as evidence — it survives the kill.
