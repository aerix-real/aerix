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

CREATE INDEX IF NOT EXISTS idx_threshold_history_scope_created
  ON public.threshold_history (scope_type, scope_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_threshold_changes_scope_created
  ON public.threshold_changes (scope_type, scope_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_threshold_performance_scope
  ON public.threshold_performance (scope_type, scope_key);
