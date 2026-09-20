#!/usr/bin/env bash
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
