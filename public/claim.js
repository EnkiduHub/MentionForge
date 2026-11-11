/*
 * API key claim page script (loaded only by /v1/keys/claim). Progressive enhancement:
 * reveals the copy buttons, copies the one-time key and snippets, and announces the result.
 */
(function () {
  "use strict";
  document.documentElement.classList.add("js");

  const originLink = document.getElementById("origin-link");
  if (originLink) {
    originLink.textContent = location.host;
    originLink.setAttribute("href", `${location.origin}/`);
  }

  let live = null;
  function announce(msg) {
    if (!live) {
      live = document.createElement("div");
      live.className = "sr-only";
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
      const el = id ? document.getElementById(id) : null;
      if (!el) return;
      const text = el.dataset.copyLine || el.textContent || "";
      const ok = await copyText(text);
      btn.setAttribute("data-state", ok ? "copied" : "failed");
      if (label) label.textContent = ok ? "Copied" : "Select & copy";
      else btn.textContent = ok ? "Copied" : "Select & copy";
      announce(ok ? "Copied to clipboard" : "Copy failed. Select the text and copy it manually.");
      setTimeout(() => {
        btn.removeAttribute("data-state");
        if (label) label.textContent = idle;
        else btn.textContent = idle;
      }, 1600);
    });
  });

  document.querySelectorAll("details.menu").forEach((menu) => {
    menu.addEventListener("click", (e) => {
      if (e.target instanceof Element && e.target.closest("a")) menu.removeAttribute("open");
    });
  });
})();
