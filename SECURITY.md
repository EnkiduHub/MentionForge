# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately by email to **harbor-ops@mail.grokbot.com** with the subject `MentionForge security report`.

Include:

- Steps to reproduce
- The affected URL or component
- The impact (what an attacker could do)

**Please do not open public issues for vulnerabilities**, and do not include secrets, private keys, or Worker tokens in any public issue, pull request, or discussion.

## What to expect

- We aim to acknowledge your report within 5 business days.
- We will not pursue legal action against good-faith security research.
- There is no bounty program.

## Scope

The MentionForge site and app in this repository.

## For maintainers

Enable GitHub private vulnerability reporting in the repo under **Settings → Code security → Private vulnerability reporting**. This needs repo-admin access and is a manual step; it is not done by the PR that added this policy.

## Never commit

- `.dev.vars`, `.env`, wallet private keys, Cloudflare API tokens, CDP secrets, `SANDBOX_KEY`, `OPERATOR_TOKEN`
- MetaMask seed phrases (never used by this project)

`TEST_PAYER_PRIVATE_KEY` / `TEST_SEED_PAYER_PRIVATE_KEY` are **local seed-script keys only**. They are not Worker secrets. Put them in `.dev.vars` (`0x` + 64 hex). Never paste them into GitHub, chat, or `wrangler secret put`. The CDP facilitator rejects a buyer that equals `RECIPIENT_WALLET` (`self_send_not_allowed`).

CI runs `bash scripts/check-secrets.sh` before tests.

Upstream fetch is allowlist-only (HTTPS, redirect re-check, max 3 hops). Mention permalinks (`mention_url`) are **never fetched**. `draft_reply` matches `mention_id` only inside this gather, or uses an optional `quote` already in the 8 KB body.
