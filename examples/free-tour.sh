#!/usr/bin/env bash
# Zero-wallet tour of the five public FREE routes (no payment headers, no paid POSTs).
# Override the live Worker with: BASE=https://your-origin ./examples/free-tour.sh
set -euo pipefail

BASE="${BASE:-https://mentionforge.mentionforge.workers.dev}"

pretty() {
  if command -v jq >/dev/null 2>&1; then
    jq .
  else
    cat
    echo
  fi
}

echo "== health"
curl -fsS "$BASE/health" | pretty

echo "== pricing"
curl -fsS "$BASE/v1/pricing" | pretty

echo "== research example"
curl -fsS "$BASE/v1/research/example" | pretty

echo "== suggest"
curl -fsS "$BASE/v1/suggest?need=compare%20two%20brands" | pretty

echo "== entity"
curl -fsS "$BASE/v1/entity?query=Cloudflare" | pretty
