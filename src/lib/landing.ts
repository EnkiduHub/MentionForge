import { escapeHtml } from "./html";
import { sourceBackends } from "./source-backends";
import { networkPublicName, paymentsReady, paymentConfig } from "./x402";
import { EXAMPLE_RESPONSE } from "./example";

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
  const fixture = `<article class="fixture-summary"><h3>${escapeHtml(ex.query)} · ${escapeHtml(String(ex.volume?.total ?? 0))} mentions</h3><p>${escapeHtml(ex.summary ?? "")}</p><p class="muted">as_of ${escapeHtml(String(ex.meta?.as_of ?? "—"))} · sources ${escapeHtml((ex.meta?.sources_used ?? []).join(", "))}</p><ul class="themes">${themes}</ul></article>`;

  return html
    .replace('<span class="dot" data-ready></span>', `<span class="dot" data-ready="${ready ? "true" : "false"}"></span>`)
    .replace("> Base · $0.02 USDC</span>", `>${label}</span>`)
    .replace('<span class="chip" id="network-chip">Base</span>', `<span class="chip" id="network-chip">${escapeHtml(named)}</span>`)
    .replace('<li>Loading from GET /health…</li>', items || '<li>Loading from GET /health…</li>')
    .replace('<p class="stat" id="calls">—</p>', `<p class="stat" id="calls">${Number.isFinite(calls) ? calls : 0}</p>`)
    .replace('<p class="muted">Loading snapshot…</p>', fixture);
}
