#!/usr/bin/env bash
# Fail if secret files or private-key material are tracked in git.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() {
  echo "secret-scan: $1" >&2
  exit 1
}

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "secret-scan: skip (not a git repo yet)"
  exit 0
fi

git ls-files -z | while IFS= read -r -d '' f; do
  case "$f" in
    .dev.vars|.env|.env.local|.env.production|.env.staging)
      fail "tracked secret file: $f"
      ;;
    *.pem|*.p12|*.pfx|*.p8|id_rsa|id_ed25519|wallet.json)
      fail "tracked key/cert file: $f"
      ;;
  esac
done

if git grep -nE -I \
  -e 'TEST_PAYER_PRIVATE_KEY=0x[0-9a-fA-F]{64}' \
  -e 'CLOUDFLARE_API_TOKEN=cfat_[A-Za-z0-9_-]{20,}' \
  -e '-----BEGIN (OPENSSH |RSA |EC )?PRIVATE KEY-----' \
  -- . ':!scripts/check-secrets.sh' >/dev/null 2>&1; then
  git grep -nE -I \
    -e 'TEST_PAYER_PRIVATE_KEY=0x[0-9a-fA-F]{64}' \
    -e 'CLOUDFLARE_API_TOKEN=cfat_[A-Za-z0-9_-]{20,}' \
    -e '-----BEGIN (OPENSSH |RSA |EC )?PRIVATE KEY-----' \
    -- . ':!scripts/check-secrets.sh' >&2 || true
  fail "private-key or API token material in tracked files"
fi

echo "secret-scan: ok"
