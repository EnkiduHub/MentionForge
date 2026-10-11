import { describe, expect, it } from "vitest";
import {
  bindingsFromWrangler,
  isAllowedXRowUrl,
  parseJsonc,
  sanitizeStoredRecord,
  scanStoreRecords,
} from "../../src/lib/purge-forbidden";
import { WRANGLER_DISABLED_SOURCES } from "../../src/lib/disabled-sources";

const allowedXRow = {
  id: "1234567890",
  url: "https://x.com/i/status/1234567890",
  created_bucket: "2026-10-11T00:00:00.000Z",
};

describe("purge-forbidden sanitizer", () => {
  it("keeps Google News and HN URLs; still flags reddit URLs", () => {
    const gnews = sanitizeStoredRecord({
      citations: [{ url: "https://news.google.com/rss/articles/abc", title: "ForgeCo ships", source: "google-news" }],
    });
    expect(gnews.hits.some((h) => h.host === "news.google.com")).toBe(false);
    expect(gnews.action).toBe("keep");

    const hn = sanitizeStoredRecord({
      citations: [{ url: "https://news.ycombinator.com/item?id=1", title: "ForgeCo on HN", source: "hn" }],
    });
    expect(hn.hits.some((h) => h.host === "news.ycombinator.com")).toBe(false);
    expect(hn.action).toBe("keep");

    const algolia = sanitizeStoredRecord({
      mentions: [{ platform: "news", url: "https://hn.algolia.com/api/v1/search?query=a", text: "ForgeCo story" }],
    });
    expect(algolia.hits.some((h) => h.host === "hn.algolia.com")).toBe(false);
    expect(algolia.action).toBe("keep");

    const reddit = sanitizeStoredRecord({
      mentions: [{ platform: "reddit", url: "https://www.reddit.com/r/saas/comments/abc", text: "ForgeCo thread" }],
    });
    expect(reddit.hits.some((h) => h.host === "reddit.com")).toBe(true);

    const redditShort = sanitizeStoredRecord({
      citations: [{ url: "https://redd.it/abc", title: "r", source: "reddit" }],
    });
    expect(redditShort.hits.some((h) => h.host === "redd.it")).toBe(true);
  });

  it("flags X raw text/author/handle/username/user objects", () => {
    const text = sanitizeStoredRecord({
      mentions: [{ platform: "x", id: "1", url: "https://x.com/i/status/1", text: "raw post body here", author: "@ops" }],
    });
    expect(text.hits.some((h) => h.field.includes("text"))).toBe(true);
    expect(text.hits.some((h) => h.field.includes("author"))).toBe(true);

    const user = sanitizeStoredRecord({
      mentions: [{ platform: "x", id: "1", url: "https://x.com/i/status/1", username: "ops", user: { id: "u", username: "ops" } }],
    });
    expect(user.hits.some((h) => h.reason.includes("username") || h.field.includes("username"))).toBe(true);
    expect(user.hits.some((h) => h.field.includes("user"))).toBe(true);
  });

  it("keeps an allowed X row {id, url, created_bucket}", () => {
    const result = sanitizeStoredRecord({ mentions: [allowedXRow] });
    expect(result.hits).toEqual([]);
    expect(result.action).toBe("keep");
    expect(result.value).toEqual({ mentions: [allowedXRow] });
    expect(isAllowedXRowUrl(allowedXRow.url)).toBe(true);
  });

  it("catches an x.com status URL inside citations", () => {
    const result = sanitizeStoredRecord({
      mentions: [allowedXRow],
      citations: [{ url: "https://x.com/ops/status/1234567890", title: "post", source: "x" }],
    });
    expect(result.hits.some((h) => h.field.includes("citations") && h.host === "x.com")).toBe(true);
    expect(result.action).toBe("update");
    const next = result.value as { citations: unknown[]; mentions: unknown[] };
    expect(next.citations).toEqual([]);
    expect(next.mentions).toEqual([allowedXRow]);
  });

  it("rewrites a handle-form X row url to https://x.com/i/status/<id>", () => {
    const result = sanitizeStoredRecord({
      mentions: [{ id: "99", url: "https://x.com/some_handle/status/99", created_bucket: "2026-10" }],
    });
    expect(result.hits.some((h) => h.field.includes("url"))).toBe(true);
    expect(result.action).toBe("update");
    const next = result.value as { mentions: Array<{ url: string }> };
    expect(next.mentions).toEqual([{ id: "99", url: "https://x.com/i/status/99", created_bucket: "2026-10" }]);
  });

  it("rewrites twitter.com handle-form urls too", () => {
    const result = sanitizeStoredRecord({
      mentions: [{ platform: "x", id: "77", url: "https://twitter.com/ops/status/77", created_bucket: "2026-10" }],
    });
    const next = result.value as { mentions: Array<{ url: string }> };
    expect(next.mentions[0]?.url).toBe("https://x.com/i/status/77");
  });

  it("leaves https://x.com/i/status/<id> untouched", () => {
    const result = sanitizeStoredRecord({ mentions: [allowedXRow] });
    const next = result.value as { mentions: Array<{ url: string }> };
    expect(next.mentions[0]?.url).toBe("https://x.com/i/status/1234567890");
    expect(result.hits).toEqual([]);
  });

  it("drops an unparseable X row url", () => {
    const result = sanitizeStoredRecord({
      mentions: [{ platform: "x", id: "nope", url: "https://x.com/home", created_bucket: "2026-10" }],
    });
    expect(result.hits.some((h) => /drop/i.test(h.reason))).toBe(true);
    const next = result.value as { mentions: unknown[] };
    expect(next.mentions).toEqual([]);
  });

  it("aggregates per store for mixed fixtures", () => {
    const scanned = scanStoreRecords("d1:idempotency", [
      { id: "keep", store: "d1:idempotency", value: { mentions: [allowedXRow] } },
      {
        id: "cite",
        store: "d1:idempotency",
        value: { citations: [{ url: "https://x.com/ops/status/1", title: "x", source: "x" }] },
      },
    ]);
    expect(scanned.scanned).toBe(2);
    expect(scanned.hit_records).toBe(1);
    expect(scanned.by_host["x.com"]).toBeGreaterThan(0);
  });

  it("parses wrangler.jsonc bindings for production D1 and no KV", () => {
    const doc = parseJsonc(
      `{
        "account_id": "abc",
        // comment
        "d1_databases": [{ "binding": "DB", "database_name": "mentionforge", "database_id": "id" }],
        "env": {
          "production": {
            "d1_databases": [{ "binding": "DB", "database_name": "mentionforge", "database_id": "id" }]
          }
        }
      }`,
    );
    const b = bindingsFromWrangler(doc, "production");
    expect(b.d1_databases[0]?.database_name).toBe("mentionforge");
    expect(b.kv_namespaces).toEqual([]);
    expect(WRANGLER_DISABLED_SOURCES).toBe("x,reddit");
    expect(WRANGLER_DISABLED_SOURCES).not.toContain("gnews");
  });
});
