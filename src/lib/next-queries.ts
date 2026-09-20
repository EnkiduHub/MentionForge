import type { ResearchRequest } from "../schemas/research";

export function nextQueries(req: ResearchRequest): string[] {
  const q = req.query.trim();
  const vs = /\s+vs\.?\s+/i.exec(q);
  const brand = vs ? q.slice(0, vs.index).trim() : q.split(/\s+/).slice(0, 3).join(" ");
  const out = [
    `${brand} vs competitors`,
    `${brand} complaints`,
    `${brand} last 24 hours`,
  ];
  return out.slice(0, 3);
}
