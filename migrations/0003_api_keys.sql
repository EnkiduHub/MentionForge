-- Stripe Key plan ($29/mo, 1,500 calls per billing period). Hash only after claim.
CREATE TABLE IF NOT EXISTS api_keys (
  key_hash TEXT PRIMARY KEY,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  checkout_session_id TEXT UNIQUE,
  claimed INTEGER NOT NULL DEFAULT 0,
  pending_key TEXT
);

CREATE TABLE IF NOT EXISTS plan_usage (
  key_hash TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_hash, period_start)
);

CREATE TABLE IF NOT EXISTS stripe_events (
  event_id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);
