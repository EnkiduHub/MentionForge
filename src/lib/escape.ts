/** Escape text for HTML element content and double- or single-quoted attribute values. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Serialize a value for an inline `<script type="application/ld+json">` block (no `</script>` breakout). */
export function jsonLdScript(value: unknown): string {
  const json = JSON.stringify(value).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}
