CREATE TABLE IF NOT EXISTS public.strategy_statistics (
  id SERIAL PRIMARY KEY,
  strategy_name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  hour INTEGER NOT NULL CHECK (hour >= 0 AND hour <= 23),
  market_regime TEXT NOT NULL DEFAULT 'NORMAL',
  signals INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  win_rate NUMERIC(10,4) NOT NULL DEFAULT 0,
  avg_score NUMERIC(10,2) NOT NULL DEFAULT 0,
  avg_confidence NUMERIC(10,2) NOT NULL DEFAULT 0,
  avg_duration NUMERIC(10,2) NOT NULL DEFAULT 0,
  last_updated TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (strategy_name, symbol, hour, market_regime)
);

CREATE INDEX IF NOT EXISTS idx_strategy_statistics_lookup
  ON public.strategy_statistics (strategy_name, symbol, hour, market_regime);

CREATE INDEX IF NOT EXISTS idx_strategy_statistics_last_updated
  ON public.strategy_statistics (last_updated DESC);

ALTER TABLE public.signal_history
  ADD COLUMN IF NOT EXISTS historical_strategy_weight NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS historical_adjustment NUMERIC DEFAULT 0;
