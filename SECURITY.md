# Security

Report vulnerabilities privately. Do not open a public issue that includes secrets, private keys, or Worker tokens.

## Never commit

- `.dev.vars`, `.env`, wallet private keys, Cloudflare API tokens, CDP secrets, `SANDBOX_KEY`, `OPERATOR_TOKEN`
- MetaMask seed phrases (never used by this project)

`TEST_PAYER_PRIVATE_KEY` is a **local seed-script key only**. It is not a Worker secret. Put it in `.dev.vars` (`0x` + 64 hex). Never paste it into GitHub, chat, or `wrangler secret put`.

CI runs `bash scripts/check-secrets.sh` before tests.
