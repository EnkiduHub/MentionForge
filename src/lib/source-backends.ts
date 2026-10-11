import { disabledSourcesFromEnv, isBraveDisabled } from "./disabled-sources";

/** Non-secret adapter modes. Reddit OAuth and X recent-search are optional upgrades. */
export function sourceBackends(env: Env) {
  const disabled = disabledSourcesFromEnv(env);
  const braveOff = isBraveDisabled(env);
  return {
    reddit: disabled.has("reddit")
      ? ("disabled" as const)
      : env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET
        ? ("oauth" as const)
        : ("public" as const),
    x: disabled.has("x") ? ("disabled" as const) : env.X_BEARER_TOKEN ? ("api" as const) : ("web" as const),
    web: disabled.has("web") ? ("disabled" as const) : env.BRAVE_API_KEY && !braveOff ? ("brave+wiki" as const) : ("wiki" as const),
    news: disabled.has("news") ? ("disabled" as const) : ("public" as const),
    reviews: disabled.has("reviews") ? ("disabled" as const) : disabled.has("reddit") ? ("web" as const) : ("web+reddit" as const),
  };
}

export function sourcesConfigured(env: Env) {
  return {
    reddit: Boolean(env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET),
    x: Boolean(env.X_BEARER_TOKEN),
    brave: Boolean(env.BRAVE_API_KEY) && !isBraveDisabled(env),
    sandbox: Boolean(env.SANDBOX_KEY),
    cdp: Boolean(env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET),
  };
}
