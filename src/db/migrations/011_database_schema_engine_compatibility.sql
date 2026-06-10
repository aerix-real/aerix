BEGIN;

CREATE TABLE IF NOT EXISTS public.signal_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  symbol TEXT,
  direction TEXT,
  signal TEXT,
  confidence NUMERIC DEFAULT 0,
  final_score NUMERIC DEFAULT 0,
  strategy_name TEXT,
  result TEXT DEFAULT 'pending',
  mode TEXT DEFAULT 'balanced',
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE public.signal_history
  ADD COLUMN IF NOT EXISTS user_id INTEGER,
  ADD COLUMN IF NOT EXISTS execution_allowed BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS strategy_name TEXT,
  ADD COLUMN IF NOT EXISTS block_reason TEXT,
  ADD COLUMN IF NOT EXISTS signal TEXT,
  ADD COLUMN IF NOT EXISTS final_score NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS minimum_score NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjusted_score NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS entry_quality TEXT,
  ADD COLUMN IF NOT EXISTS trend_direction TEXT,
  ADD COLUMN IF NOT EXISTS trend_strength NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS volatility NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS entry_price NUMERIC,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS explanation TEXT,
  ADD COLUMN IF NOT EXISTS timing TEXT,
  ADD COLUMN IF NOT EXISTS entry_in_seconds INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS timing_mode TEXT,
  ADD COLUMN IF NOT EXISTS timing_confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS market_regime TEXT,
  ADD COLUMN IF NOT EXISTS institutional_quality TEXT,
  ADD COLUMN IF NOT EXISTS adaptive_adjustment NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tuning_weight NUMERIC DEFAULT 1;

ALTER TABLE public.signal_history
  ALTER COLUMN confidence TYPE NUMERIC USING confidence::numeric,
  ALTER COLUMN confidence SET DEFAULT 0;

UPDATE public.signal_history
SET signal = direction
WHERE signal IS NULL
  AND direction IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'signal_history'
      AND column_name = 'strategy'
  ) THEN
    UPDATE public.signal_history
    SET strategy_name = strategy
    WHERE strategy_name IS NULL;
  END IF;
END $$;

UPDATE public.signal_history
SET final_score = COALESCE(NULLIF(final_score, 0), confidence, 0)
WHERE final_score IS NULL OR final_score = 0;

UPDATE public.signal_history
SET adjusted_score = COALESCE(NULLIF(adjusted_score, 0), final_score, confidence, 0)
WHERE adjusted_score IS NULL OR adjusted_score = 0;

UPDATE public.signal_history
SET minimum_score = CASE
  WHEN LOWER(COALESCE(mode, 'balanced')) IN ('conservador', 'conservative') THEN 86
  WHEN LOWER(COALESCE(mode, 'balanced')) IN ('agressivo', 'aggressive') THEN 60
  ELSE 68
END
WHERE minimum_score IS NULL OR minimum_score = 0;

UPDATE public.signal_history
SET execution_allowed = CASE
  WHEN COALESCE(blocked, false) = false
    AND signal IN ('CALL', 'PUT')
    AND COALESCE(adjusted_score, final_score, confidence, 0) >= minimum_score
  THEN TRUE
  ELSE FALSE
END
WHERE execution_allowed IS NULL;

CREATE TABLE IF NOT EXISTS public.threshold_history (
  id SERIAL PRIMARY KEY,
  scope_type TEXT NOT NULL DEFAULT 'composite',
  scope_key TEXT NOT NULL DEFAULT 'global',
  symbol TEXT,
  hour INTEGER,
  strategy_name TEXT,
  market_regime TEXT,
  mode TEXT DEFAULT 'balanced',
  minimum_score NUMERIC DEFAULT 72,
  confidence NUMERIC DEFAULT 72,
  sniper_timing NUMERIC DEFAULT 88,
  adaptive_adjustment NUMERIC DEFAULT 0,
  performance_snapshot JSONB DEFAULT '{}'::jsonb,
  reasons JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE public.threshold_history
  ADD COLUMN IF NOT EXISTS scope_type TEXT NOT NULL DEFAULT 'composite',
  ADD COLUMN IF NOT EXISTS scope_key TEXT NOT NULL DEFAULT 'global',
  ADD COLUMN IF NOT EXISTS symbol TEXT,
  ADD COLUMN IF NOT EXISTS hour INTEGER,
  ADD COLUMN IF NOT EXISTS strategy_name TEXT,
  ADD COLUMN IF NOT EXISTS market_regime TEXT,
  ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'balanced',
  ADD COLUMN IF NOT EXISTS minimum_score NUMERIC DEFAULT 72,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC DEFAULT 72,
  ADD COLUMN IF NOT EXISTS sniper_timing NUMERIC DEFAULT 88,
  ADD COLUMN IF NOT EXISTS adaptive_adjustment NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS performance_snapshot JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reasons JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.threshold_changes (
  id SERIAL PRIMARY KEY,
  scope_type TEXT NOT NULL DEFAULT 'composite',
  scope_key TEXT NOT NULL DEFAULT 'global',
  threshold_name TEXT NOT NULL,
  previous_value NUMERIC DEFAULT 0,
  new_value NUMERIC DEFAULT 0,
  delta NUMERIC DEFAULT 0,
  reason TEXT,
  context JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE public.threshold_changes
  ADD COLUMN IF NOT EXISTS scope_type TEXT NOT NULL DEFAULT 'composite',
  ADD COLUMN IF NOT EXISTS scope_key TEXT NOT NULL DEFAULT 'global',
  ADD COLUMN IF NOT EXISTS threshold_name TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS previous_value NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_value NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delta NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS context JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.threshold_performance (
  id SERIAL PRIMARY KEY,
  scope_type TEXT NOT NULL DEFAULT 'composite',
  scope_key TEXT NOT NULL DEFAULT 'global',
  symbol TEXT,
  hour INTEGER,
  strategy_name TEXT,
  market_regime TEXT,
  total INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  winrate NUMERIC DEFAULT 0,
  lossrate NUMERIC DEFAULT 0,
  last_thresholds JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (scope_type, scope_key)
);

ALTER TABLE public.threshold_performance
  ADD COLUMN IF NOT EXISTS scope_type TEXT NOT NULL DEFAULT 'composite',
  ADD COLUMN IF NOT EXISTS scope_key TEXT NOT NULL DEFAULT 'global',
  ADD COLUMN IF NOT EXISTS symbol TEXT,
  ADD COLUMN IF NOT EXISTS hour INTEGER,
  ADD COLUMN IF NOT EXISTS strategy_name TEXT,
  ADD COLUMN IF NOT EXISTS market_regime TEXT,
  ADD COLUMN IF NOT EXISTS total INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wins INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS losses INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS winrate NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lossrate NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_thresholds JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_signal_history_execution_allowed
  ON public.signal_history (execution_allowed, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_history_confirmed_operational
  ON public.signal_history (created_at DESC)
  WHERE COALESCE(blocked, false) = false
    AND COALESCE(execution_allowed, false) = true
    AND signal IN ('CALL', 'PUT');

CREATE INDEX IF NOT EXISTS idx_signal_history_symbol_created
  ON public.signal_history (symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_history_strategy_created
  ON public.signal_history (strategy_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_threshold_history_scope_created
  ON public.threshold_history (scope_type, scope_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_threshold_history_symbol_created
  ON public.threshold_history (symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_threshold_history_strategy_created
  ON public.threshold_history (strategy_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_threshold_changes_scope_created
  ON public.threshold_changes (scope_type, scope_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_threshold_performance_scope
  ON public.threshold_performance (scope_type, scope_key);

COMMIT;
