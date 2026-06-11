BEGIN;

-- Runtime compatibility patch for databases created before the complete schema audit.
-- This migration is intentionally additive/idempotent and does not rewrite or drop data.

CREATE TABLE IF NOT EXISTS public.filter_block_events (
  id SERIAL PRIMARY KEY,
  filter_name TEXT NOT NULL DEFAULT 'institutional_quality_filter',
  filter_label TEXT NOT NULL DEFAULT 'Filtro de qualidade institucional',
  symbol TEXT NOT NULL DEFAULT 'UNKNOWN',
  score NUMERIC DEFAULT 0,
  final_score NUMERIC DEFAULT 0,
  reason TEXT NOT NULL DEFAULT 'Bloqueio institucional sem motivo detalhado.',
  signal TEXT DEFAULT 'WAIT',
  mode TEXT,
  market_regime TEXT,
  strategy_name TEXT,
  source TEXT NOT NULL DEFAULT 'engine',
  event_type TEXT NOT NULL DEFAULT 'block',
  original_score NUMERIC DEFAULT 0,
  result_outcome TEXT,
  event_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$
DECLARE
  users_id_type TEXT;
  filter_user_type TEXT;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO users_id_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'users'
    AND a.attname = 'id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  filter_user_type := COALESCE(users_id_type, 'TEXT');

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'filter_block_events'
      AND column_name = 'user_id'
  ) THEN
    EXECUTE format('ALTER TABLE public.filter_block_events ADD COLUMN user_id %s', filter_user_type);
  END IF;
END $$;

ALTER TABLE public.filter_block_events
  ADD COLUMN IF NOT EXISTS filter_name TEXT NOT NULL DEFAULT 'institutional_quality_filter',
  ADD COLUMN IF NOT EXISTS filter_label TEXT NOT NULL DEFAULT 'Filtro de qualidade institucional',
  ADD COLUMN IF NOT EXISTS symbol TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS score NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_score NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT 'Bloqueio institucional sem motivo detalhado.',
  ADD COLUMN IF NOT EXISTS signal TEXT DEFAULT 'WAIT',
  ADD COLUMN IF NOT EXISTS mode TEXT,
  ADD COLUMN IF NOT EXISTS market_regime TEXT,
  ADD COLUMN IF NOT EXISTS strategy_name TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'engine',
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'block',
  ADD COLUMN IF NOT EXISTS original_score NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS result_outcome TEXT,
  ADD COLUMN IF NOT EXISTS event_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

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
  updated_at TIMESTAMP DEFAULT NOW()
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

UPDATE public.threshold_performance
SET last_thresholds = '{}'::jsonb
WHERE last_thresholds IS NULL;

CREATE INDEX IF NOT EXISTS idx_filter_block_events_filter_name
  ON public.filter_block_events (filter_name);

CREATE INDEX IF NOT EXISTS idx_filter_block_events_symbol
  ON public.filter_block_events (symbol);

CREATE INDEX IF NOT EXISTS idx_filter_block_events_created_at
  ON public.filter_block_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_filter_block_events_event_timestamp
  ON public.filter_block_events (event_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_filter_block_events_event_type
  ON public.filter_block_events (event_type);

CREATE INDEX IF NOT EXISTS idx_filter_block_events_symbol_signal_timestamp
  ON public.filter_block_events (symbol, signal, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_threshold_performance_scope
  ON public.threshold_performance (scope_type, scope_key);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.threshold_performance
    GROUP BY scope_type, scope_key
    HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_threshold_performance_scope_unique
      ON public.threshold_performance (scope_type, scope_key);
  ELSE
    RAISE NOTICE 'idx_threshold_performance_scope_unique not created: duplicate threshold_performance scope rows require manual consolidation.';
  END IF;
END $$;

COMMIT;
