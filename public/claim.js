(function () {
  const originLink = document.getElementById("origin-link");
  if (originLink) {
    originLink.textContent = location.host;
    originLink.setAttribute("href", `${location.origin}/`);
  }

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
})();
