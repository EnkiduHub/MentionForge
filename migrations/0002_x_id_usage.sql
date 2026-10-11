-- Rolling 30-day X Post-ID disclosure cap (Compliance MF-X).
CREATE TABLE IF NOT EXISTS x_id_usage (
  day TEXT PRIMARY KEY,
  ids INTEGER NOT NULL DEFAULT 0
);
