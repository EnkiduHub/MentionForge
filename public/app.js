(function () {
  const origin = location.origin;

  const originLink = document.getElementById("origin-link");
  if (originLink) {
    originLink.textContent = location.host;
    originLink.setAttribute("href", `${origin}/`);
  }

  function networkLabel(caip) {
    if (caip === "eip155:8453") return "Base";
    if (caip === "eip155:84532") return "Base Sepolia";
    return location.host.includes("-staging.") ? "Base Sepolia" : "Base";
  }

  const PRESETS = {
    brand: { query: "Cloudflare Workers", timeframe: "7d", note: "brand" },
    vs: { query: "Cloudflare Workers vs AWS Lambda", timeframe: "7d", note: "vs" },
    reviews: { query: "Cloudflare Workers reviews", timeframe: "30d", note: "reviews" },
    risk: { query: "Cloudflare Workers", timeframe: "24h", note: "24h risk" },
  };

  function paintCurl(netName, preset) {
    const el = document.getElementById("curl");
    if (!el) return;
    const spec = preset || PRESETS.brand;
    const uuid = crypto.randomUUID();
    const body = JSON.stringify({ query: spec.query, timeframe: spec.timeframe, limit: 20, include_summary: true });
    const line = `curl -sS -X POST ${origin}/v1/research -H 'content-type: application/json' -H 'Idempotency-Key: ${uuid}' -d '${body}'`;
    el.dataset.copyLine = [
      line,
      `# HTTP 402 → retry with PAYMENT-SIGNATURE (x402 exact 0.02 USDC on ${netName})`,
      `# trial → X-Wallet`,
    ].join("\n");
    el.textContent = [
      `POST ${origin}/v1/research`,
      `content-type: application/json`,
      `Idempotency-Key: ${uuid}`,
      body,
      `# HTTP 402 → PAYMENT-SIGNATURE · 0.02 USDC on ${netName}`,
      `# trial → X-Wallet`,
    ].join("\n");
  }

  const mcp = document.getElementById("mcp");
  if (mcp) {
    mcp.textContent = JSON.stringify(
      { mcpServers: { mentionforge: { url: `${origin}/mcp` } } },
      null,
      2,
    );
  }
  const named = networkLabel();
  paintCurl(named);
  const chip0 = document.getElementById("network-chip");
  if (chip0) chip0.textContent = named;

  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-preset");
      const spec = PRESETS[key];
      if (!spec) return;
      paintCurl(networkLabel(), spec);
      const mcp = document.getElementById("mcp");
      if (mcp) {
        mcp.textContent = JSON.stringify(
          {
            mcpServers: { mentionforge: { url: `${origin}/mcp` } },
            example: { query: spec.query, timeframe: spec.timeframe, include_summary: true },
          },
          null,
          2,
        );
      }
    });
  });

  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-copy");
      const el = id ? document.getElementById(id) : null;
      if (!el) return;
      const text = el.dataset.copyLine || el.textContent || "";
      const ok = await copyText(text);
      btn.textContent = ok ? "Copied" : "Select & copy";
      setTimeout(() => {
        btn.textContent = "Copy";
      }, 1600);
    });
  });

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        return document.execCommand("copy");
      } catch {
        return false;
      } finally {
        ta.remove();
      }
    }
  }

  function httpUrl(value) {
    if (typeof value !== "string") return "";
    try {
      const u = new URL(value, origin);
      if (u.protocol !== "http:" && u.protocol !== "https:") return "";
      return u.href;
    } catch {
      return "";
    }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function link(href, text, className) {
    const a = document.createElement("a");
    if (className) a.className = className;
    a.href = href;
    a.textContent = text;
    a.rel = "noopener noreferrer";
    a.target = "_blank";
    return a;
  }

  function fmtTime(iso) {
    if (typeof iso !== "string" || !iso) return "";
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return iso;
    return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }

  function jsonOrNull(res) {
    return res.ok ? res.json() : Promise.reject(new Error(String(res.status)));
  }

  function liveJson(path, init) {
    return fetch(path, {
      cache: init && init.cache ? init.cache : "default",
      headers: { Accept: "application/json" },
    }).then(jsonOrNull);
  }

  function paintFacts() {
    const pre = document.getElementById("payload");
    const host = document.getElementById("facts");
    if (!pre || !host) return;
    let data;
    try {
      data = JSON.parse(pre.textContent || "");
    } catch {
      return;
    }
    if (!data || typeof data !== "object") return;
    const chips = [];
    if (typeof data.status === "string") chips.push(`status ${data.status}`);
    if (typeof data.payments_ready === "boolean") {
      chips.push(data.payments_ready ? "payments ready" : "payments degraded");
    }
    if (typeof data.network === "string") {
      const named = networkLabel(data.network);
      chips.push(named === data.network ? data.network : `${named} · ${data.network}`);
    }
    if (data.price_usdc != null) chips.push(`$${data.price_usdc} ${data.asset || "USDC"}`);
    if (data.free_trial_calls != null) chips.push(`${data.free_trial_calls} trial calls`);
    if (typeof data.query === "string") chips.push(data.query);
    if (data.volume && data.volume.total != null) chips.push(`${data.volume.total} mentions`);
    if (data.info && typeof data.info.title === "string") chips.push(data.info.title);
    if (typeof data.calls === "number") chips.push(`${data.calls} calls`);
    if (typeof data.paid === "number") chips.push(`${data.paid} paid`);
    if (typeof data.trial === "number") chips.push(`${data.trial} trial`);
    if (data.source_backends && typeof data.source_backends === "object") {
      for (const [name, mode] of Object.entries(data.source_backends)) {
        chips.push(`${name}: ${String(mode)}`);
      }
    }
    if (!chips.length) return;
    host.hidden = false;
    host.replaceChildren();
    for (const label of chips) {
      const li = document.createElement("li");
      li.textContent = label;
      host.append(li);
    }
  }

  paintFacts();

  const wantsLanding = Boolean(
    document.getElementById("fixture-root") || document.getElementById("live-status"),
  );
  if (!wantsLanding) return;

  Promise.all([
    liveJson("/stats").catch(() => null),
    liveJson("/health").catch(() => null),
    liveJson("/v1/pricing").catch(() => null),
    liveJson("/v1/research/example", { cache: "no-cache" }).catch(() => null),
  ]).then(([stats, health, pricing, example]) => {
    const calls = document.getElementById("calls");
    if (calls && stats && stats.calls != null) calls.textContent = String(stats.calls);

    const status = document.getElementById("live-status");
    const dot = status?.querySelector(".dot");
    const label = document.getElementById("live-label");
    if (health) {
      const ready = Boolean(health.payments_ready);
      const net = typeof health.network === "string" ? health.network : "unknown";
      if (dot) dot.setAttribute("data-ready", ready ? "true" : "false");
      if (label) label.textContent = ready ? ` Live · ${net}` : ` Degraded · ${net}`;
      const chip = document.getElementById("network-chip");
      const named = networkLabel(health.network);
      if (chip) chip.textContent = named;
      paintCurl(named);
      const list = document.getElementById("backends");
      const backends = health.source_backends && typeof health.source_backends === "object" ? health.source_backends : {};
      if (list) {
        list.replaceChildren();
        for (const [name, mode] of Object.entries(backends)) {
          const li = document.createElement("li");
          li.textContent = `${name}: ${String(mode)}`;
          list.append(li);
        }
      }
    } else {
      if (dot) dot.setAttribute("data-ready", "false");
      if (label) label.textContent = " Status unavailable";
    }

    const pay = document.getElementById("payto");
    if (pay && pricing) {
      const netName = networkLabel(pricing.network);
      pay.replaceChildren();
      pay.append(
        document.createTextNode(
          `Settle ${pricing.price_usdc ?? "0.02"} ${pricing.asset ?? "USDC"} on ${netName}. Agents read payTo from `,
        ),
      );
      const pricingLink = document.createElement("a");
      pricingLink.href = "/v1/pricing";
      pricingLink.textContent = "GET /v1/pricing";
      pay.append(pricingLink);
      pay.append(document.createTextNode("."));
    }

    if (example) renderFixture(example);
    else {
      const root = document.getElementById("fixture-root");
      if (root) root.textContent = "Snapshot unavailable. Open /v1/research/example directly.";
    }
  }).catch(() => {
    const label = document.getElementById("live-label");
    if (label) label.textContent = " Status unavailable";
    const root = document.getElementById("fixture-root");
    if (root && root.textContent?.includes("Loading")) {
      root.textContent = "Snapshot unavailable. Open /v1/research/example directly.";
    }
  });

  function sparkline(host, counts, label) {
    if (!host) return;
    host.replaceChildren();
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 120 40");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label || "volume sparkline");
    const max = Math.max(1, ...counts);
    const pts = counts
      .map((n, i) => {
        const x = counts.length <= 1 ? 0 : (i / (counts.length - 1)) * 120;
        const y = 36 - (n / max) * 32;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    const poly = document.createElementNS(ns, "polyline");
    poly.setAttribute("fill", "none");
    poly.setAttribute("stroke", "currentColor");
    poly.setAttribute("stroke-width", "2");
    poly.setAttribute("points", pts || "0,36 120,36");
    svg.append(poly);
    host.append(svg);
  }

  function renderBars(root, rows, title) {
    if (!rows.length) return;
    const box = el("div", "bars");
    box.setAttribute("aria-label", title);
    for (const [label, pct] of rows) {
      const row = el("div", "bar-row");
      row.append(el("span", "", label));
      const bar = el("div", "bar");
      bar.setAttribute("role", "img");
      bar.setAttribute("aria-label", `${label} ${Math.round(pct)} percent`);
      const fill = document.createElement("span");
      fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
      bar.append(fill);
      row.append(bar, el("span", "bar-n", `${Math.round(pct)}%`));
      box.append(row);
    }
    root.append(box);
  }

  function renderFixture(body) {
    const root = document.getElementById("fixture-root");
    if (!root) return;
    root.replaceChildren();

    const summary = el("article", "fixture-summary");
    const h = el("h3", "", `${body.query ?? "Cloudflare Workers"} · ${body.volume?.total ?? 0} mentions`);
    const p = el("p", "", body.summary ?? "");
    const meta = el(
      "p",
      "muted",
      `as_of ${body.meta?.as_of ?? "—"} · confidence ${body.meta?.confidence ?? "—"} · sources ${(body.meta?.sources_used ?? []).join(", ")}`,
    );
    const themes = el("ul", "themes");
    for (const t of body.themes ?? []) {
      const li = document.createElement("li");
      li.textContent = t.theme;
      themes.append(li);
    }
    summary.append(h, p, meta);
    root.append(summary);
    renderBars(root, [
      ["positive", Number(body.sentiment?.positive) || 0],
      ["neutral", Number(body.sentiment?.neutral) || 0],
      ["negative", Number(body.sentiment?.negative) || 0],
    ], "Sentiment mix");
    renderBars(
      root,
      (body.share_of_voice ?? []).map((r) => [r.brand, (Number(r.share) || 0) * 100]),
      "Share of voice",
    );
    sparkline(
      document.getElementById("sparkline"),
      (body.volume?.trend ?? []).map((t) => Number(t.count) || 0),
      "Volume sparkline",
    );
    summary.append(themes);

    const cites = body.citations ?? [];
    if (cites.length) {
      const box = el("article", "citations");
      box.append(el("h3", "", "Citations from this call"));
      const ul = el("ul", "cite-list");
      for (const c of cites.slice(0, 12)) {
        const href = httpUrl(c.url);
        if (!href) continue;
        const li = document.createElement("li");
        li.append(link(href, c.title || href, ""));
        const src = el("span", "cite-src", c.source ?? "");
        li.append(src);
        ul.append(li);
      }
      box.append(ul);
      root.append(box);
    }

    for (const m of body.mentions ?? []) {
      const art = el("article", "mention");
      const head = document.createElement("header");
      const left = el("span", "", `${m.platform} · ${m.author}`);
      const right = el("span", "", fmtTime(m.timestamp));
      head.append(left, right);
      if (m.intent) head.append(el("span", "intent", String(m.intent)));
      const href = httpUrl(m.url);
      const text = href ? link(href, m.text ?? href, "mention-link") : el("p", "", m.text ?? "");
      if (href && text.tagName === "A") {
        const wrap = el("p", "");
        wrap.append(text);
        art.append(head, wrap);
      } else {
        art.append(head, text);
      }
      const bar = el("div", "sent");
      bar.setAttribute("role", "img");
      bar.setAttribute("aria-label", `sentiment ${m.sentiment}`);
      const fill = document.createElement("span");
      const pct = Math.max(0, Math.min(100, Math.round(((Number(m.sentiment) || 0) + 1) * 50)));
      fill.style.width = `${pct}%`;
      bar.append(fill);
      art.append(bar);
      root.append(art);
    }
  }
})();
