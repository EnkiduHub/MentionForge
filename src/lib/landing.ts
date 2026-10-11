import { escapeHtml } from "./html";
import { sourceBackends } from "./source-backends";
import { networkPublicName, paymentsReady, paymentConfig } from "./x402";
import { EXAMPLE_RESPONSE } from "./example";
import { mcpToolCards } from "./discoverability";

function barRow(label: string, pct: number): string {
  const p = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  return `<div class="bar-row"><span>${escapeHtml(label)}</span><div class="bar" role="img" aria-label="${escapeHtml(label)} ${p} percent"><span style="width:${p}%"></span></div><span class="bar-n">${p.toFixed(0)}%</span></div>`;
}

/** Fill the static landing with this deployment's live status so first paint is not a loading shell. */
export function hydrateLandingHtml(html: string, env: Env, calls: number): string {
  const backends = sourceBackends(env);
  const ready = paymentsReady(env);
  const cfg = paymentConfig(env);
  const named = networkPublicName(env);
  const items = Object.entries(backends)
    .map(([name, mode]) => `<li>${escapeHtml(name)}: ${escapeHtml(String(mode))}</li>`)
    .join("");
  const label = ready ? ` Live · ${escapeHtml(cfg.network)}` : ` Degraded · ${escapeHtml(cfg.network)}`;
  const ex = EXAMPLE_RESPONSE;
  const themes = (ex.themes ?? [])
    .map((t) => `<li>${escapeHtml(t.theme)}</li>`)
    .join("");
  const sent = ex.sentiment;
  const sentBars = [
    barRow("positive", sent.positive),
    barRow("neutral", sent.neutral),
    barRow("negative", sent.negative),
  ].join("");
  const sovBars = (ex.share_of_voice ?? [])
    .map((r) => barRow(r.brand, r.share * 100))
    .join("");
  const mentions = (ex.mentions ?? [])
    .slice(0, 4)
    .map((m) => {
      const intent = m.intent ? `<span class="intent">${escapeHtml(m.intent)}</span>` : "";
      return `<article class="mention"><header><span>${escapeHtml(m.platform)} · ${escapeHtml(m.author)}</span>${intent}</header><p>${escapeHtml(m.text.slice(0, 180))}</p></article>`;
    })
    .join("");
  const gallery = mcpToolCards()
    .map((t) => {
      const kind = t.kind === "paid" ? "Paid · $0.02 USDC" : "Free";
      return `<article class="tool-card"><h3>${escapeHtml(t.name)}</h3><p class="muted">${kind}</p><p>${escapeHtml(t.when_to_use)}</p></article>`;
    })
    .join("");
  const fixture = `<article class="fixture-summary"><h3>${escapeHtml(ex.query)} · ${escapeHtml(String(ex.volume?.total ?? 0))} mentions</h3><p>${escapeHtml(ex.summary ?? "")}</p><p class="muted">as_of ${escapeHtml(String(ex.meta?.as_of ?? "—"))} · sources ${escapeHtml((ex.meta?.sources_used ?? []).join(", "))}</p><div class="bars" aria-label="Sentiment mix">${sentBars}</div>${sovBars ? `<div class="bars" aria-label="Share of voice">${sovBars}</div>` : ""}<ul class="themes">${themes}</ul>${mentions}</article>`;

  return html
    .replace('<span class="dot" data-ready></span>', `<span class="dot" data-ready="${ready ? "true" : "false"}"></span>`)
    .replace("> Base · $0.02 USDC</span>", `>${label}</span>`)
    .replace('<span class="chip" id="network-chip">Base</span>', `<span class="chip" id="network-chip">${escapeHtml(named)}</span>`)
    .replace('<li>Loading from GET /health…</li>', items || '<li>Loading from GET /health…</li>')
    .replace('<p class="stat" id="calls">—</p>', `<p class="stat" id="calls">${Number.isFinite(calls) ? calls : 0}</p>`)
    .replace('<p class="muted">Loading snapshot…</p>', fixture)
    .replace('<div id="tool-gallery" class="tool-gallery"></div>', `<div id="tool-gallery" class="tool-gallery">${gallery}</div>`);
}
