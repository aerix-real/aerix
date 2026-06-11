BEGIN;

CREATE TABLE IF NOT EXISTS public.analytics (
  id SERIAL PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  symbol TEXT,
  strategy_name TEXT,
  market_regime TEXT,
  total INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  winrate NUMERIC(8,2) NOT NULL DEFAULT 0,
  lossrate NUMERIC(8,2) NOT NULL DEFAULT 0,
  drawrate NUMERIC(8,2) NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE public.analytics
  ADD COLUMN IF NOT EXISTS scope_type TEXT NOT NULL DEFAULT 'global',
  ADD COLUMN IF NOT EXISTS scope_key TEXT NOT NULL DEFAULT 'global',
  ADD COLUMN IF NOT EXISTS symbol TEXT,
  ADD COLUMN IF NOT EXISTS strategy_name TEXT,
  ADD COLUMN IF NOT EXISTS market_regime TEXT,
  ADD COLUMN IF NOT EXISTS total INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wins INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS losses INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS draws INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS winrate NUMERIC(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lossrate NUMERIC(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drawrate NUMERIC(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_analytics_scope
  ON public.analytics (scope_type, scope_key);

CREATE INDEX IF NOT EXISTS idx_analytics_scope_winrate
  ON public.analytics (scope_type, winrate DESC, total DESC);

CREATE OR REPLACE FUNCTION public.calculate_signal_outcome(
  p_signal TEXT,
  p_direction TEXT,
  p_entry_price NUMERIC,
  p_result_price NUMERIC
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_direction TEXT := UPPER(COALESCE(NULLIF(p_signal, ''), NULLIF(p_direction, '')));
BEGIN
  IF p_entry_price IS NULL OR p_result_price IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_result_price = p_entry_price THEN
    RETURN 'draw';
  END IF;

  IF v_direction IN ('CALL', 'BUY', 'LONG') THEN
    IF p_result_price > p_entry_price THEN
      RETURN 'win';
    END IF;
    RETURN 'loss';
  END IF;

  IF v_direction IN ('PUT', 'SELL', 'SHORT') THEN
    IF p_result_price < p_entry_price THEN
      RETURN 'win';
    END IF;
    RETURN 'loss';
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_signal_outcome()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_outcome TEXT;
BEGIN
  v_outcome := public.calculate_signal_outcome(
    NEW.signal,
    NEW.direction,
    NEW.entry_price,
    NEW.result_price
  );

  IF v_outcome IS NOT NULL THEN
    NEW.result := v_outcome;
    NEW.checked_at := COALESCE(NEW.checked_at, NOW());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_history_apply_outcome ON public.signal_history;
CREATE TRIGGER trg_signal_history_apply_outcome
  BEFORE INSERT OR UPDATE OF signal, direction, entry_price, result_price
  ON public.signal_history
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_signal_outcome();

CREATE OR REPLACE FUNCTION public.refresh_outcome_analytics()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM public.analytics
  WHERE scope_type IN ('global', 'asset', 'strategy', 'regime');

  INSERT INTO public.analytics (
    scope_type,
    scope_key,
    symbol,
    strategy_name,
    market_regime,
    total,
    wins,
    losses,
    draws,
    winrate,
    lossrate,
    drawrate,
    metadata,
    updated_at,
    created_at
  )
  WITH base AS (
    SELECT
      COALESCE(NULLIF(symbol, ''), 'UNKNOWN') AS symbol,
      COALESCE(NULLIF(strategy_name, ''), NULLIF(strategy, ''), 'unknown') AS strategy_name,
      COALESCE(NULLIF(market_regime, ''), 'UNKNOWN') AS market_regime,
      LOWER(result) AS result
    FROM public.signal_history
    WHERE entry_price IS NOT NULL
      AND result_price IS NOT NULL
      AND LOWER(COALESCE(result, '')) IN ('win', 'loss', 'draw')
  ), aggregated AS (
    SELECT 'global'::TEXT AS scope_type, 'global'::TEXT AS scope_key, NULL::TEXT AS symbol, NULL::TEXT AS strategy_name, NULL::TEXT AS market_regime, result
    FROM base
    UNION ALL
    SELECT 'asset'::TEXT, symbol, symbol, NULL::TEXT, NULL::TEXT, result
    FROM base
    UNION ALL
    SELECT 'strategy'::TEXT, strategy_name, NULL::TEXT, strategy_name, NULL::TEXT, result
    FROM base
    UNION ALL
    SELECT 'regime'::TEXT, market_regime, NULL::TEXT, NULL::TEXT, market_regime, result
    FROM base
  ), metrics AS (
    SELECT
      scope_type,
      scope_key,
      MAX(symbol) AS symbol,
      MAX(strategy_name) AS strategy_name,
      MAX(market_regime) AS market_regime,
      COUNT(*)::INTEGER AS total,
      COUNT(*) FILTER (WHERE result = 'win')::INTEGER AS wins,
      COUNT(*) FILTER (WHERE result = 'loss')::INTEGER AS losses,
      COUNT(*) FILTER (WHERE result = 'draw')::INTEGER AS draws
    FROM aggregated
    GROUP BY scope_type, scope_key
  )
  SELECT
    scope_type,
    scope_key,
    symbol,
    strategy_name,
    market_regime,
    total,
    wins,
    losses,
    draws,
    CASE WHEN total > 0 THEN ROUND((wins::NUMERIC / total::NUMERIC) * 100, 2) ELSE 0 END,
    CASE WHEN total > 0 THEN ROUND((losses::NUMERIC / total::NUMERIC) * 100, 2) ELSE 0 END,
    CASE WHEN total > 0 THEN ROUND((draws::NUMERIC / total::NUMERIC) * 100, 2) ELSE 0 END,
    jsonb_build_object('source', 'signal_history', 'calculation', 'entry_price_result_price'),
    NOW(),
    NOW()
  FROM metrics;

  IF NOT EXISTS (
    SELECT 1
    FROM public.analytics
    WHERE scope_type = 'global'
      AND scope_key = 'global'
  ) THEN
    INSERT INTO public.analytics (
      scope_type,
      scope_key,
      total,
      wins,
      losses,
      draws,
      winrate,
      lossrate,
      drawrate,
      metadata,
      updated_at,
      created_at
    ) VALUES (
      'global',
      'global',
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      jsonb_build_object('source', 'signal_history', 'calculation', 'entry_price_result_price'),
      NOW(),
      NOW()
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_outcome_analytics_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.refresh_outcome_analytics();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_history_refresh_outcome_analytics ON public.signal_history;
CREATE TRIGGER trg_signal_history_refresh_outcome_analytics
  AFTER INSERT OR UPDATE OR DELETE
  ON public.signal_history
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.refresh_outcome_analytics_trigger();

UPDATE public.signal_history
SET result = public.calculate_signal_outcome(signal, direction, entry_price, result_price),
    checked_at = COALESCE(checked_at, NOW())
WHERE entry_price IS NOT NULL
  AND result_price IS NOT NULL
  AND public.calculate_signal_outcome(signal, direction, entry_price, result_price) IS NOT NULL;

SELECT public.refresh_outcome_analytics();

COMMIT;
