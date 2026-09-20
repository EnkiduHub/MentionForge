# Security

Report vulnerabilities privately. Do not open a public issue that includes secrets, private keys, or Worker tokens.

## Never commit

- `.dev.vars`, `.env`, wallet private keys, Cloudflare API tokens, CDP secrets, `SANDBOX_KEY`, `OPERATOR_TOKEN`
- MetaMask seed phrases (never used by this project)

`TEST_PAYER_PRIVATE_KEY` / `TEST_SEED_PAYER_PRIVATE_KEY` are **local seed-script keys only**. They are not Worker secrets. Put them in `.dev.vars` (`0x` + 64 hex). Never paste them into GitHub, chat, or `wrangler secret put`. The CDP facilitator rejects a buyer that equals `RECIPIENT_WALLET` (`self_send_not_allowed`).

CI runs `bash scripts/check-secrets.sh` before tests.
