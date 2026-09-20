const ALLOWED = new Set([
  "www.reddit.com",
  "oauth.reddit.com",
  "api.gdeltproject.org",
  "news.google.com",
  "hn.algolia.com",
  "en.wikipedia.org",
  "www.wikidata.org",
  "query.wikidata.org",
  "api.search.brave.com",
  "api.x.com",
  "api.twitter.com",
]);

const MAX_REDIRECTS = 3;

export function assertAllowedUrl(url: string): URL {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("blocked: non-https");
  const host = u.hostname.toLowerCase();
  if (!ALLOWED.has(host)) throw new Error(`blocked host: ${host}`);
  return u;
}

export async function allowedFetch(
  url: string,
  init: RequestInit & { pool?: { run: <T>(j: () => Promise<T>) => Promise<T> } } = {},
): Promise<Response> {
  const { pool, ...rest } = init;
  const run = () => followAllowed(url, rest);
  return pool ? pool.run(run) : run();
}

async function followAllowed(url: string, init: RequestInit): Promise<Response> {
  let current = assertAllowedUrl(url).href;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status < 300 || res.status >= 400) return res;
    const loc = res.headers.get("location");
    cancelBody(res);
    if (!loc) throw new Error("blocked: redirect");
    if (hop === MAX_REDIRECTS) throw new Error("blocked: redirect");
    current = assertAllowedUrl(new URL(loc, current).href).href;
  }
  throw new Error("blocked: redirect");
}

export function cancelBody(res: Response): void {
  if (res.body) void res.body.cancel();
}
