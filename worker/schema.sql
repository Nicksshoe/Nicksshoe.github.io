CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,          -- 'daily' or 'free'
  period TEXT NOT NULL,        -- daily: YYYY-MM-DD, free: patch like 16.23
  client TEXT NOT NULL,        -- random per-browser id (never shown publicly)
  name TEXT NOT NULL,
  champ TEXT NOT NULL,
  items TEXT NOT NULL,         -- comma-separated item ids
  score INTEGER NOT NULL,      -- computed by the server
  created TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_daily_per_client ON scores (mode, period, client) WHERE mode = 'daily';
CREATE INDEX IF NOT EXISTS board_lookup ON scores (mode, period, score DESC);
CREATE TABLE IF NOT EXISTS tickets (seed TEXT PRIMARY KEY, used TEXT NOT NULL);
