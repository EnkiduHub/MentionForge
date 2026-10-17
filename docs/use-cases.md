# Use cases

Five jobs a user can type into an MCP client. Each maps to **exactly one** MentionForge MCP tool or prompt. Names are taken from the live [server card](https://mentionforge.mentionforge.workers.dev/.well-known/mcp/server-card.json) (`mcpToolCards()` in `src/lib/discoverability.ts`) and from `server.registerPrompt` in `src/mcp.ts`.

**Sources (measured 2026-10-17):** `GET /health` reports `source_backends.reddit` and `source_backends.x` as `disabled`. Live gathers use web, news, and reviews adapters only. These jobs do not claim Reddit or X coverage.

**Price (repo facts):** free tools never charge. Paid tools share **10 trial calls** (`X-Wallet` or `X-Sandbox-Key`), then **$0.02 USDC** per successful call (`src/routes/pricing.ts`, `docs/payments.md`). Empty windows still succeed and still count as a paid or trial call.

Optional: call free `get_example` first if you only need the frozen payload shape. That is not one of the jobs below.

## 1. Competitor brief

**Prompt to type:** Compare share of voice for Notion vs Obsidian over 7d.

**Call:** MCP prompt `competitor_brief` (`src/mcp.ts`).

**Cost:** Paid. The prompt tells the client to call `compare_brands` once ($0.02 USDC after the shared trial).

**What you get back:** A vs-style brief with share of voice for the primary brand and the named competitor (the prompt passes `brand` and `competitors`). It is not a full `research_mentions` dump and not a free `get_entity_profile` identity card.

## 2. Launch-day check

**Prompt to type:** Check launch-day risk for Cloudflare Workers in the last 24h — any volume spike or negative concentration?

**Call:** MCP tool `detect_risk` (server card; `src/lib/discoverability.ts`).

**Cost:** Paid ($0.02 USDC after the shared trial).

**What you get back:** Risk triage (`signals` such as spike / negative concentration) for the query and window. It is not a mention-row export (`list_mentions`) and not a time-bucket chart (`get_trends`).

## 3. Review pain digest

**Prompt to type:** Digest Trustpilot and web review pain for Notion this week.

**Call:** MCP prompt `review_digest` (`src/mcp.ts`).

**Cost:** Paid. The prompt tells the client to call `get_digest` once ($0.02 USDC after the shared trial).

**What you get back:** Mentions grouped into praise, pain, news, reviews, and reply-worthy buckets for a 7d window. Sibling prompt `pain_mining` also calls `get_digest`; this job uses `review_digest` only.

## 4. Brand / crisis watch

**Prompt to type:** Watch MentionForge for a mention crisis in the last 24 hours.

**Call:** MCP prompt `crisis_watch` (`src/mcp.ts`).

**Cost:** Paid. The prompt tells the client to call `detect_risk` with `timeframe` 24h ($0.02 USDC after the shared trial).

**What you get back:** Spike and negative-concentration triage for crisis use. It is not a full fused brief and not a flat mention list.

## 5. Reply draft

**Prompt to type:** Draft an unsent public reply for the latest complaint about Cloudflare Workers. Do not post it.

**Call:** MCP tool `draft_reply` (server card; `src/lib/discoverability.ts`).

**Cost:** Paid ($0.02 USDC after the shared trial).

**What you get back:** Suggested public-reply copy seeded from cited mentions. The tool never posts and never fetches a `mention_url` you pass in.

## Free vs paid

| Job | Name | Kind |
| --- | --- | --- |
| Competitor brief | `competitor_brief` → `compare_brands` | paid |
| Launch-day check | `detect_risk` | paid |
| Review pain digest | `review_digest` → `get_digest` | paid |
| Brand / crisis watch | `crisis_watch` → `detect_risk` | paid |
| Reply draft | `draft_reply` | paid |

Free tools on the same card (`get_health`, `get_pricing`, `get_example`, `suggest_tool`, `get_entity_profile`) are not these jobs. Use `suggest_tool` only if you need the router to pick a single tool from a goal sentence.
