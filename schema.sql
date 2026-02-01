-- Hydration Bot D1 Schema
-- Agent Logic: This schema defines the persistence layer for water tracking.
-- Two tables: user_preferences (singleton per user) and water_logs (append-only).

-- user_preferences: Stores per-user configuration (single-user pattern)
CREATE TABLE IF NOT EXISTS user_preferences (
  chat_id            TEXT PRIMARY KEY,
  target_ml          INTEGER DEFAULT 3500,
  bottle_size_ml     INTEGER DEFAULT 750,
  onboarding_complete INTEGER DEFAULT 0,  -- 0 = pending, 1 = complete
  timezone           TEXT DEFAULT 'Asia/Kolkata',
  created_at         INTEGER NOT NULL
);

-- Migration: Add onboarding_complete column if it doesn't exist (for existing DBs)
-- Run this manually if table already exists:
-- ALTER TABLE user_preferences ADD COLUMN onboarding_complete INTEGER DEFAULT 0;

-- water_logs: Append-only log of water intake events
CREATE TABLE IF NOT EXISTS water_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id     TEXT NOT NULL,
  amount_ml   INTEGER NOT NULL,
  log_time    TEXT NOT NULL,
  input_raw   TEXT,
  created_at  INTEGER DEFAULT (unixepoch())
);

-- Index for efficient queries by user and time range (daily summaries, today's logs)
CREATE INDEX IF NOT EXISTS idx_water_logs_chat_time 
  ON water_logs(chat_id, log_time);
