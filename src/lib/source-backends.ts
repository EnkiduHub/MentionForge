/** Non-secret adapter modes. Reddit OAuth and X recent-search are optional upgrades. */
export function sourceBackends(env: Env) {
  return {
    reddit: env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET ? ("oauth" as const) : ("public" as const),
    x: env.X_BEARER_TOKEN ? ("api" as const) : ("web" as const),
    web: env.BRAVE_API_KEY ? ("brave+wiki" as const) : ("wiki" as const),
    news: "public" as const,
    reviews: "web+reddit" as const,
  };
}

export function sourcesConfigured(env: Env) {
  return {
    reddit: Boolean(env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET),
    x: Boolean(env.X_BEARER_TOKEN),
    brave: Boolean(env.BRAVE_API_KEY),
    sandbox: Boolean(env.SANDBOX_KEY),
    cdp: Boolean(env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET),
  };
}
