import type { ResearchRequest } from "../schemas/research";
import { splitBrands } from "./research/query-plan";

export function nextQueries(req: ResearchRequest): string[] {
  const q = req.query.trim();
  const brands = splitBrands(q);
  const brand = brands?.[0] || q.split(/\s+/).slice(0, 3).join(" ");
  const counterpart = brands?.[1];
  const out = [
    `${brand} complaints`,
    req.timeframe === "24h" ? `${brand} reviews` : `${brand} last 24 hours`,
    counterpart ? `${brand} vs ${counterpart}` : `${brand} vs competitors`,
  ];
  return out.slice(0, 3);
}
