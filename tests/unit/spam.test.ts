import { describe, expect, it } from "vitest";
import { canonicalizeUrl, relevantToQuery } from "../../src/lib/research/spam";

describe("mention relevance", () => {
  it("keeps Cloudflare encyclopedia hits for Cloudflare Workers", () => {
    expect(
      relevantToQuery(
        {
          text: "Cloudflare, Inc., is an American technology company.",
          url: "https://en.wikipedia.org/wiki/Cloudflare",
        },
        ["cloudflare", "workers"],
      ),
    ).toBe(true);
  });

  it("drops unrelated HN stories that only matched a generic token", () => {
    expect(
      relevantToQuery(
        {
          text: "Show HN: Seal – Letters and passwords that open for your family after you die",
          url: "https://github.com/jasonepage/Seal",
        },
        ["cloudflare", "workers"],
      ),
    ).toBe(false);
    expect(
      relevantToQuery(
        {
          text: "Ask HN: How do remote workers stay focused?",
          url: "https://news.ycombinator.com/item?id=1",
        },
        ["cloudflare", "workers"],
      ),
    ).toBe(false);
  });

  it("upgrades Wikidata entity URLs to https", () => {
    expect(canonicalizeUrl("http://www.wikidata.org/entity/Q131417404")).toBe(
      "https://www.wikidata.org/entity/Q131417404",
    );
  });
});
