CREATE TABLE IF NOT EXISTS shadow_mode_events (
  id SERIAL PRIMARY KEY,
  filter_block_event_id INTEGER REFERENCES filter_block_events(id) ON DELETE SET NULL,
  user_id INTEGER,
  filter_name TEXT NOT NULL,
  filter_label TEXT NOT NULL,
  symbol TEXT NOT NULL,
  original_signal JSONB NOT NULL DEFAULT '{}'::jsonb,
  original_direction TEXT NOT NULL,
  original_score NUMERIC DEFAULT 0,
  original_confidence NUMERIC DEFAULT 0,
  entry_price NUMERIC,
  result_price NUMERIC,
  block_reason TEXT NOT NULL,
  filter_decision TEXT NOT NULL DEFAULT 'blocked',
  result TEXT NOT NULL DEFAULT 'pending',
  comparison TEXT,
  mode TEXT,
  market_regime TEXT,
  strategy_name TEXT,
  source TEXT NOT NULL DEFAULT 'engine',
  expires_at TIMESTAMP,
  checked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shadow_mode_events_filter_name
  ON shadow_mode_events(filter_name);

CREATE INDEX IF NOT EXISTS idx_shadow_mode_events_result
  ON shadow_mode_events(result);

CREATE INDEX IF NOT EXISTS idx_shadow_mode_events_expires_at
  ON shadow_mode_events(expires_at)
  WHERE result = 'pending';

CREATE INDEX IF NOT EXISTS idx_shadow_mode_events_created_at
  ON shadow_mode_events(created_at DESC);
