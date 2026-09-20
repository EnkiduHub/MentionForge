import { describe, expect, it } from "vitest";
import { scoreText, tokenize } from "../../src/lib/research/sentiment";
import { isSpam } from "../../src/lib/research/spam";

describe("sentiment + spam", () => {
  it("negates and scores", () => {
    const q = tokenize("ForgeCo");
    expect(scoreText("ForgeCo is not good", q).label).toBe("negative");
    expect(scoreText("ForgeCo is extremely good", q).label).toBe("positive");
  });

  it("drops pump spam", () => {
    expect(
      isSpam({
        platform: "reddit",
        url: "https://www.reddit.com/r/x/1",
        author: "u/bot",
        timestamp: new Date().toISOString(),
        text: "guaranteed returns to the moon 100x",
        engagement: 1,
      }),
    ).toBe(true);
  });
});
