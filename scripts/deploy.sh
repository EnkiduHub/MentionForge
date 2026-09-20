#!/usr/bin/env bash
set -euo pipefail
# Staging first. Production only after Sepolia payment + Bazaar seed.
npx wrangler d1 migrations apply mentionforge --env staging --remote
npx wrangler deploy --env staging
echo "Next: PAY_ONCE=1 npm run test-payment && PAY_ONCE=1 npm run seed-bazaar"
