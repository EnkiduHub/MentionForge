-- MentionForge D1: trial CAS, idempotency (global), operator counters.
-- Analytics Engine is write-only from the Worker; dashboards read these tables.

CREATE TABLE IF NOT EXISTS trial_wallets (
  wallet TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT PRIMARY KEY,
  body_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  response TEXT,
  billing TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency (created_at);

CREATE TABLE IF NOT EXISTS stats_daily (
  day TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0,
  usdc_micros INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  trial INTEGER NOT NULL DEFAULT 0
);
