-- Optional: unlock mode/tool props on analytics_events.
-- Safe to re-run. App works without it (track API falls back).
ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS meta jsonb;
