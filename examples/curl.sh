#!/usr/bin/env bash
# Local REST smoke. Paid lenses are POST-only (/v1/compare /v1/digest /v1/risk /v1/reply).
# The 10-call trial is shared across all paid tools. Prefer query "Cloudflare Workers" in docs.
set -euo pipefail
ORIGIN="${ORIGIN:-http://127.0.0.1:8787}"
KEY="${IDEMPOTENCY_KEY:-00000000-0000-4000-8000-000000000001}"

echo "== unpaid (expect 402) =="
curl -sS -D - -o /tmp/mf-402.json -X POST "$ORIGIN/v1/research" \
  -H "content-type: application/json" \
  -H "Idempotency-Key: $KEY" \
  -d '{"query":"ForgeCo","timeframe":"7d","limit":5}' || true
head -n 20 /tmp/mf-402.json

echo "== trial (X-Wallet) =="
curl -sS -X POST "$ORIGIN/v1/research" \
  -H "content-type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "X-Wallet: ${WALLET:-0x1111111111111111111111111111111111111111}" \
  -d '{"query":"ForgeCo","timeframe":"7d"}'

echo "== free routers =="
curl -sS "$ORIGIN/v1/suggest?need=compare%20two%20brands"
echo
curl -sS "$ORIGIN/v1/entity?query=ForgeCo"
