-- Rolling 30-day plan quota for disclosed mention / risk IDs.
CREATE TABLE IF NOT EXISTS x_id_usage (
  day TEXT PRIMARY KEY,
  ids INTEGER NOT NULL DEFAULT 0
);
