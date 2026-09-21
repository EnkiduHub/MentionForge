/** Compact AFINN-style lexicon + negation/intensifiers. CPU-cheap for Workers Free. */

const POS: Record<string, number> = {
  good: 2, great: 3, excellent: 3, amazing: 3, love: 3, awesome: 3, best: 3, happy: 2,
  like: 1, helpful: 2, recommend: 2, fast: 1, reliable: 2, quality: 1, impressive: 2,
  win: 2, won: 2, success: 2, successful: 2, solid: 1, clean: 1, easy: 1, useful: 2,
  perfect: 3, wonderful: 3, fantastic: 3, delighted: 2, pleased: 2, outstanding: 3,
  brilliant: 3, enjoy: 2, enjoyed: 2, favorite: 2, favourite: 2, wow: 2, yes: 1,
  worth: 1, stable: 2, smooth: 1, fair: 1, polite: 1,
};

const NEG: Record<string, number> = {
  bad: -2, terrible: -3, awful: -3, hate: -3, worst: -3, slow: -1, buggy: -2, crash: -2,
  broken: -2, expensive: -1, scam: -3, fraud: -3, delay: -1, delayed: -1, issue: -1,
  issues: -1, problem: -1, problems: -1, disappointing: -2, disappointed: -2, poor: -2,
  fail: -2, failed: -2, failure: -2, angry: -2, annoying: -2, useless: -2, refund: -1,
  outage: -2, down: -1, lag: -1, laggy: -1, overpriced: -2, regret: -2, avoid: -2,
  never: -1, no: -1, not: 0, rude: -2, downtime: -2, insecure: -2, pricey: -1,
  unfair: -2, unreliable: -2, complaint: -1,
};

const NEGATORS = new Set(["not", "never", "no", "n't", "cannot", "cant", "hardly"]);
const INTENSIFIERS: Record<string, number> = { very: 1.4, extremely: 1.6, super: 1.4, really: 1.3, so: 1.2 };

const EMOJI_POS = /[😀😃😄😁🙂😊😍🥰👍❤️🔥]/u;
const EMOJI_NEG = /[😠😡🤬👎💔😢😭]/u;

export function scoreText(text: string, queryTokens: string[] = []): { score: number; label: "positive" | "neutral" | "negative" } {
  const tokens = tokenize(text);
  const skip = new Set(queryTokens.map((t) => t.toLowerCase()));
  let sum = 0;
  let weight = 0;
  let negate = false;
  let intensifier = 1;
  for (const tok of tokens) {
    if (skip.has(tok)) continue;
    if (NEGATORS.has(tok)) {
      negate = true;
      continue;
    }
    if (INTENSIFIERS[tok]) {
      intensifier *= INTENSIFIERS[tok]!;
      continue;
    }
    const raw = POS[tok] ?? NEG[tok];
    if (raw === undefined) {
      negate = false;
      intensifier = 1;
      continue;
    }
    let v = raw * intensifier;
    if (negate) v = -v;
    sum += v;
    weight += Math.abs(v);
    negate = false;
    intensifier = 1;
  }
  if (EMOJI_POS.test(text)) {
    sum += 1;
    weight += 1;
  }
  if (EMOJI_NEG.test(text)) {
    sum -= 1;
    weight += 1;
  }
  if (weight === 0) return { score: 0, label: "neutral" };
  let score = Math.max(-1, Math.min(1, sum / (weight + 2)));
  const mixed = /\bbut\b|\bhowever\b|\balthough\b/i.test(text);
  if (mixed) score *= 0.6;
  const label = score > 0.12 ? "positive" : score < -0.12 ? "negative" : "neutral";
  return { score: Number(score.toFixed(4)), label };
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/n't/g, " n't ")
    .split(/[^a-z0-9']+/i)
    .filter((t) => t.length > 1);
}
