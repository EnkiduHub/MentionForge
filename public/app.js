/*
 * MENTION//FORGE site script. Progressive enhancement only: every page works without it.
 * CSP-safe (script-src 'self'): no eval, no inline handlers; DOM is built with createElement.
 * Landing markup it refreshes is server-rendered by src/lib/landing.ts in the same shape,
 * so live updates never shift layout.
 */
(function () {
  "use strict";
  const doc = document.documentElement;
  doc.classList.add("js");
  const origin = location.origin;

  /* ---------- helpers ---------- */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function networkLabel(caip) {
    if (caip === "eip155:8453") return "Base";
    if (caip === "eip155:84532") return "Base Sepolia";
    return location.host.includes("-staging.") ? "Base Sepolia" : "Base";
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

  function fmtTime(iso) {
    if (typeof iso !== "string" || !iso) return "";
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return iso;
    return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }

  /* ---------- this deployment's host in the footer ---------- */
  const originLink = document.getElementById("origin-link");
  if (originLink) {
    originLink.textContent = location.host;
    originLink.setAttribute("href", `${origin}/`);
  }

  /* ---------- menus: close on Escape, outside click, or link click ---------- */
  const menus = Array.from(document.querySelectorAll("details.menu"));
  function closeMenus(except) {
    for (const m of menus) if (m !== except) m.removeAttribute("open");
  }
  for (const m of menus) {
    m.addEventListener("toggle", () => {
      if (m.open) closeMenus(m);
    });
    m.addEventListener("click", (e) => {
      if (e.target instanceof Element && e.target.closest("a")) m.removeAttribute("open");
    });
  }
  document.addEventListener("click", (e) => {
    if (!(e.target instanceof Element) || !e.target.closest("details.menu")) closeMenus();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = menus.find((m) => m.open);
    if (!open) return;
    open.removeAttribute("open");
    open.querySelector("summary")?.focus();
  });

  /* ---------- syntax highlighting for small code samples ---------- */
  const JSON_TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\b\d+(?:\.\d+)?\b)|\b(true|false|null)\b/g;
  const SHELL_TOKEN = /(^|\s)(curl|claude)(?=\s)|(\s)(-{1,2}[A-Za-z][\w-]*)|('[^']*')|(https?:\/\/[^\s'"]+)/g;

  function appendTokens(frag, text, re, classify) {
    let last = 0;
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m.index > last) frag.append(text.slice(last, m.index));
      classify(frag, m);
      last = re.lastIndex;
    }
    if (last < text.length) frag.append(text.slice(last));
  }

  function highlight(node) {
    const lang = node.getAttribute("data-lang");
    const text = node.textContent || "";
    const frag = document.createDocumentFragment();
    if (lang === "json") {
      appendTokens(frag, text, JSON_TOKEN, (f, m) => {
        if (m[1]) {
          f.append(el("span", m[2] ? "tok-k" : "tok-s", m[1]));
          if (m[2]) f.append(m[2]);
        } else {
          f.append(el("span", "tok-n", m[3] || m[4]));
        }
      });
    } else if (lang === "shell") {
      text.split("\n").forEach((line, i) => {
        if (i) frag.append("\n");
        if (/^\s*#/.test(line)) {
          frag.append(el("span", "tok-c", line));
          return;
        }
        appendTokens(frag, line, SHELL_TOKEN, (f, m) => {
          if (m[2]) f.append(m[1], el("span", "tok-cmd", m[2]));
          else if (m[4]) f.append(m[3], el("span", "tok-f", m[4]));
          else if (m[5]) f.append(el("span", "tok-s", m[5]));
          else f.append(el("span", "tok-u", m[6]));
        });
      });
    } else {
      return;
    }
    node.replaceChildren(frag);
  }

  function setCode(node, text) {
    if (!node) return;
    if (node.textContent !== text) node.textContent = text;
    highlight(node);
  }

  /* ---------- copy to clipboard ---------- */
  let live = null;
  function announce(msg) {
    if (!live) {
      live = el("div", "sr-only");
      live.setAttribute("role", "status");
      live.setAttribute("aria-live", "polite");
      document.body.append(live);
    }
    live.textContent = "";
    setTimeout(() => {
      live.textContent = msg;
    }, 30);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.className = "sr-only";
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

  document.querySelectorAll("[data-copy]").forEach((btn) => {
    const label = btn.querySelector(".copy-label");
    const idle = label ? label.textContent : btn.textContent;
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-copy");
      const target = id ? document.getElementById(id) : null;
      if (!target) return;
      const text = target.dataset.copyLine || target.textContent || "";
      const ok = await copyText(text);
      const msg = ok ? "Copied" : "Select & copy";
      btn.setAttribute("data-state", ok ? "copied" : "failed");
      if (label && !label.classList.contains("sr-only")) label.textContent = msg;
      else if (!label) btn.textContent = msg;
      announce(ok ? "Copied to clipboard" : "Copy failed. Select the text and copy it manually.");
      setTimeout(() => {
        btn.removeAttribute("data-state");
        if (label && !label.classList.contains("sr-only")) label.textContent = idle;
        else if (!label) btn.textContent = idle;
      }, 1600);
    });
  });

  /* ---------- install snippets (origin-aware) + query builder presets ---------- */
  const PRESETS = {
    brand: { query: "Cloudflare Workers", timeframe: "7d" },
    vs: { query: "Cloudflare Workers vs AWS Lambda", timeframe: "7d" },
    reviews: { query: "Cloudflare Workers reviews", timeframe: "30d" },
    risk: { query: "Cloudflare Workers", timeframe: "24h" },
  };

  function paintCurl(netName, preset, fresh) {
    const node = document.getElementById("curl");
    if (!node) return;
    const spec = preset || PRESETS.brand;
    const key = fresh ? crypto.randomUUID() : "(new UUID per unique body)";
    const body = JSON.stringify({ query: spec.query, timeframe: spec.timeframe, limit: 20, include_summary: true });
    const lines = [
      `curl -sS -X POST ${origin}/v1/research \\`,
      `  -H 'content-type: application/json' \\`,
      `  -H 'Idempotency-Key: ${key}' \\`,
      `  -d '${body}'`,
      `# HTTP 402 → retry with PAYMENT-SIGNATURE (0.02 USDC on ${netName})`,
      `# Free trial → add -H 'X-Wallet: (your wallet address)'`,
    ];
    node.dataset.copyLine = lines.join("\n");
    setCode(node, lines.join("\n"));
  }

  function paintMcp(preset) {
    const node = document.getElementById("mcp");
    if (!node) return;
    const config = { mcpServers: { mentionforge: { url: `${origin}/mcp` } } };
    if (preset) config.example = { query: preset.query, timeframe: preset.timeframe, include_summary: true };
    setCode(node, JSON.stringify(config, null, 2));
  }

  const claudeCmd = `claude mcp add --transport http mentionforge ${origin}/mcp`;
  const heroCmd = document.getElementById("hero-cmd");
  if (heroCmd && heroCmd.textContent !== claudeCmd) {
    heroCmd.setAttribute("data-lang", "shell");
    setCode(heroCmd, claudeCmd);
  }
  setCode(document.getElementById("claude-cmd"), claudeCmd);
  paintMcp();
  paintCurl(networkLabel());
  document.querySelectorAll("pre[data-lang]").forEach((node) => {
    if (!node.querySelector("span")) highlight(node);
  });

  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const spec = PRESETS[btn.getAttribute("data-preset") || ""];
      if (!spec) return;
      document.querySelectorAll("[data-preset]").forEach((b) => b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
      paintCurl(networkLabel(), spec, true);
      paintMcp(spec);
    });
  });

  /* ---------- scroll reveals (one-shot; skipped for reduced motion) ---------- */
  const revealables = document.querySelectorAll("[data-reveal]");
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (revealables.length) {
    if (reduced || !("IntersectionObserver" in window)) {
      revealables.forEach((n) => n.classList.add("is-in"));
    } else {
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        },
        { rootMargin: "0px 0px -6% 0px", threshold: 0.06 },
      );
      revealables.forEach((n) => io.observe(n));
    }
  }

  /* ---------- discovery pages: summary chips (server-rendered; this is the fallback) ---------- */
  function paintFacts() {
    const pre = document.getElementById("payload");
    const host = document.getElementById("facts");
    if (!pre || !host || host.children.length) return;
    let data;
    try {
      data = JSON.parse(pre.textContent || "");
    } catch {
      return;
    }
    if (!data || typeof data !== "object") return;
    const chips = [];
    if (typeof data.status === "string") chips.push(`status ${data.status}`);
    if (typeof data.payments_ready === "boolean") chips.push(data.payments_ready ? "payments ready" : "payments degraded");
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
      for (const [name, mode] of Object.entries(data.source_backends)) chips.push(`${name}: ${String(mode)}`);
    }
    if (!chips.length) return;
    host.hidden = false;
    host.replaceChildren(...chips.map((label) => el("li", "", label)));
  }
  paintFacts();

  /* ---------- landing: live status, sources, usage, pricing ---------- */
  const wantsLanding = Boolean(document.getElementById("fixture-root") || document.getElementById("live-status"));
  if (!wantsLanding) return;

  function clampPct(pct) {
    const n = Number(pct);
    return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
  }

  function paintFill(fill, pct) {
    const p = clampPct(pct);
    fill.setAttribute("data-pct", String(p));
    fill.setAttribute("data-w", String(Math.round(p / 5) * 5));
    fill.style.width = `${p}%`;
  }

  document.querySelectorAll("[data-pct]").forEach((node) => paintFill(node, node.getAttribute("data-pct")));

  const SOURCE_LABELS = { web: "Web search", news: "News", reviews: "Review sites", reddit: "Reddit (native)", x: "X (native)" };
  const SOURCE_ORDER = Object.keys(SOURCE_LABELS);
  function sourceRank(name) {
    const i = SOURCE_ORDER.indexOf(name);
    return i === -1 ? SOURCE_ORDER.length : i;
  }

  function paintBackends(list, backends) {
    const items = Object.entries(backends)
      .sort(([a], [b]) => sourceRank(a) - sourceRank(b))
      .map(([name, mode]) => {
        const li = el("li", "src");
        li.setAttribute("data-state", mode === "disabled" ? "off" : "on");
        const dot = el("span", "src-dot");
        dot.setAttribute("aria-hidden", "true");
        li.append(dot, el("span", "src-name", SOURCE_LABELS[name] || name), el("code", "", `${name}: ${String(mode)}`));
        return li;
      });
    list.replaceChildren(...items);
  }

  function liveJson(path, cache) {
    return fetch(path, { cache: cache || "default", headers: { Accept: "application/json" } }).then((res) =>
      res.ok ? res.json() : Promise.reject(new Error(String(res.status))),
    );
  }

  const root = document.getElementById("fixture-root");
  const needsFixture = Boolean(root && root.textContent && root.textContent.includes("Loading snapshot"));

  Promise.all([
    liveJson("/stats").catch(() => null),
    liveJson("/health").catch(() => null),
    liveJson("/v1/pricing").catch(() => null),
    needsFixture ? liveJson("/v1/research/example", "no-cache").catch(() => null) : Promise.resolve(null),
  ])
    .then(([stats, health, pricing, example]) => {
      const calls = document.getElementById("calls");
      if (calls && stats && stats.calls != null) calls.textContent = Number(stats.calls).toLocaleString("en-US");

      const status = document.getElementById("live-status");
      const dot = status ? status.querySelector(".dot") : null;
      const label = document.getElementById("live-label");
      if (health) {
        const ready = Boolean(health.payments_ready);
        const named = networkLabel(health.network);
        if (dot) dot.setAttribute("data-ready", ready ? "true" : "false");
        if (label) label.textContent = ready ? ` Live · ${named}` : ` Degraded · ${named}`;
        const chip = document.getElementById("network-chip");
        if (chip) chip.textContent = named;
        document.querySelectorAll(".net-name").forEach((n) => {
          if (n.closest("#curl") == null) n.textContent = named;
        });
        paintCurl(named);
        const list = document.getElementById("backends");
        if (list && health.source_backends && typeof health.source_backends === "object") {
          paintBackends(list, health.source_backends);
        }
      } else {
        if (dot) dot.setAttribute("data-ready", "false");
        if (label) label.textContent = " Status unavailable";
      }

      const pay = document.getElementById("payto");
      if (pay && pricing) {
        const netName = networkLabel(pricing.network);
        const pricingLink = el("a", "", "GET /v1/pricing");
        pricingLink.href = "/v1/pricing";
        const named = el("span", "net-name", netName);
        pay.replaceChildren(
          document.createTextNode(`Settle ${pricing.price_usdc ?? "0.02"} ${pricing.asset ?? "USDC"} on `),
          named,
          document.createTextNode(". Agents read the payment address ("),
          el("code", "", "payTo"),
          document.createTextNode(") from "),
          pricingLink,
          document.createTextNode("."),
        );
      }

      if (needsFixture) {
        if (example) renderFixture(example);
        else if (root) root.textContent = "Snapshot unavailable. Open /v1/research/example directly.";
      }
    })
    .catch(() => {
      const label = document.getElementById("live-label");
      if (label) label.textContent = " Status unavailable";
      if (needsFixture && root) root.textContent = "Snapshot unavailable. Open /v1/research/example directly.";
    });

  /* No-SSR fallback: render the example with the same building blocks the server uses. */
  function renderBars(host, rows, title) {
    if (!rows.length) return;
    host.append(el("h4", "", title));
    const box = el("div", "bars");
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", title);
    for (const [label, pct] of rows) {
      const row = el("div", "bar-row");
      const bar = el("div", "bar");
      bar.setAttribute("role", "img");
      bar.setAttribute("aria-label", `${label} ${clampPct(pct)} percent`);
      const fill = document.createElement("span");
      paintFill(fill, pct);
      bar.append(fill);
      row.append(el("span", "", label), bar, el("span", "bar-n", `${Math.round(clampPct(pct))}%`));
      box.append(row);
    }
    host.append(box);
  }

  function renderFixture(body) {
    if (!root) return;
    const report = el("article", "fixture-summary report");
    const head = el("header", "report-head");
    const title = el("div");
    title.append(el("h3", "", `${body.query ?? "Cloudflare Workers"} · ${body.volume?.total ?? 0} mentions`));
    head.append(title);
    report.append(head, el("p", "report-summary", body.summary ?? ""));
    const grid = el("div", "report-grid");
    const left = el("div", "report-col");
    const right = el("div", "report-col");
    renderBars(left, [
      ["positive", Number(body.sentiment?.positive) || 0],
      ["neutral", Number(body.sentiment?.neutral) || 0],
      ["negative", Number(body.sentiment?.negative) || 0],
    ], "Sentiment mix");
    renderBars(left, (body.share_of_voice ?? []).map((r) => [r.brand, (Number(r.share) || 0) * 100]), "Share of voice");
    const themes = el("ul", "themes");
    for (const t of body.themes ?? []) themes.append(el("li", "", t.theme));
    left.append(el("h4", "", "Themes"), themes);
    right.append(el("h4", "", "Top mentions"));
    for (const m of (body.mentions ?? []).slice(0, 4)) {
      const art = el("article", "mention");
      const header = document.createElement("header");
      header.append(el("span", "", `${m.platform} · ${m.author}`), el("span", "", fmtTime(m.timestamp)));
      if (m.intent) header.append(el("span", "intent", String(m.intent)));
      const p = el("p");
      const href = httpUrl(m.url);
      if (href) {
        const a = el("a", "mention-link", m.text ?? href);
        a.href = href;
        a.rel = "nofollow noopener";
        p.append(a);
      } else {
        p.textContent = m.text ?? "";
      }
      const sent = el("div", "sent");
      sent.setAttribute("role", "img");
      sent.setAttribute("aria-label", `sentiment ${m.sentiment}`);
      const fill = document.createElement("span");
      paintFill(fill, Math.round(((Number(m.sentiment) || 0) + 1) * 50));
      sent.append(fill);
      art.append(header, p, sent);
      right.append(art);
    }
    const cites = (body.citations ?? []).map((c) => [httpUrl(c.url), c]).filter(([href]) => href);
    if (cites.length) {
      right.append(el("h4", "", "Citations"));
      const ul = el("ul", "cite-list");
      for (const [href, c] of cites.slice(0, 6)) {
        const li = el("li");
        const a = el("a", "", c.title || href);
        a.href = href;
        a.rel = "nofollow noopener";
        li.append(a, el("span", "cite-src", c.source ?? ""));
        ul.append(li);
      }
      right.append(ul);
    }
    grid.append(left, right);
    report.append(grid);
    root.replaceChildren(report);
  }
})();
