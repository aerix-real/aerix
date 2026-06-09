CREATE TABLE IF NOT EXISTS filter_block_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  filter_name TEXT NOT NULL,
  filter_label TEXT NOT NULL,
  symbol TEXT NOT NULL,
  score NUMERIC DEFAULT 0,
  reason TEXT NOT NULL,
  signal TEXT DEFAULT 'WAIT',
  mode TEXT,
  market_regime TEXT,
  strategy_name TEXT,
  source TEXT NOT NULL DEFAULT 'engine',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_filter_block_events_filter_name
  ON filter_block_events(filter_name);

CREATE INDEX IF NOT EXISTS idx_filter_block_events_symbol
  ON filter_block_events(symbol);

CREATE INDEX IF NOT EXISTS idx_filter_block_events_created_at
  ON filter_block_events(created_at DESC);
