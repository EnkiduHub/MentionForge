# GitHub About (EnkiduHub/MentionForge)

**Already applied** on the public repo (EnkiduHub `gh repo edit`, 2026-09-20). Do not rerun unless the sidebar is empty.

The sidebar must keep pointing at the **hosted Worker**, not a clone.

Do **not** run `sudo apt install gh`. Ubuntu’s package is GitHub CLI 2.4.0 and is not the `gh` these commands need.

## Fields

| Field | Value |
| --- | --- |
| Website | `https://mentionforge.mentionforge.workers.dev` |
| Description | Highest-quality, lowest-latency social listening for agents. Cited mentions, sentiment, and themes in one $0.02 USDC call. |
| Topics | `mcp`, `x402`, `cloudflare-workers`, `model-context-protocol`, `social-listening`, `ai-agents`, `typescript` |

## Fastest: repo UI (no CLI)

1. Open https://github.com/EnkiduHub/MentionForge while signed in as **EnkiduHub**.
2. Click the gear next to **About**.
3. Website: `https://mentionforge.mentionforge.workers.dev`
4. Description: paste the Description row above.
5. Add the seven topics, save.

## CLI (official `gh` in `~/.local/bin`)

This repo’s `origin` is SSH (`git@github.com:EnkiduHub/MentionForge.git`). Keep git on SSH. `gh repo edit` needs a GitHub API login; that is separate from `ssh -T git@github.com`.

If WSL’s browser crashes (`tcmalloc` / `core dumped`), ignore it and open `https://github.com/login/device` yourself.

```bash
export PATH="$HOME/.local/bin:$PATH"
gh auth login -h github.com -p ssh -w
# Authenticate Git with GitHub credentials? No  (keeps origin on SSH)
# Open https://github.com/login/device if the browser fails.

DESC='Highest-quality, lowest-latency social listening for agents. Cited mentions, sentiment, and themes in one $0.02 USDC call.'
gh repo edit EnkiduHub/MentionForge \
  --homepage "https://mentionforge.mentionforge.workers.dev" \
  --description "$DESC" \
  --add-topic mcp \
  --add-topic x402 \
  --add-topic cloudflare-workers \
  --add-topic model-context-protocol \
  --add-topic social-listening \
  --add-topic ai-agents \
  --add-topic typescript

gh config set -h github.com git_protocol ssh
```

If `gh auth status` already shows EnkiduHub, skip `auth login` and run only `gh repo edit` when the About sidebar needs a change.
