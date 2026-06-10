ALTER TABLE filter_block_events
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'block',
  ADD COLUMN IF NOT EXISTS original_score NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS result_outcome TEXT;

CREATE INDEX IF NOT EXISTS idx_filter_block_events_event_type
  ON filter_block_events(event_type);

UPDATE signal_history
SET minimum_score = CASE
  WHEN LOWER(COALESCE(mode, 'balanced')) IN ('conservador', 'conservative') THEN 86
  WHEN LOWER(COALESCE(mode, 'balanced')) IN ('agressivo', 'aggressive') THEN 60
  ELSE 68
END
WHERE minimum_score IS NULL
   OR minimum_score = 0
   OR minimum_score IN (70, 72, 78, 88);
