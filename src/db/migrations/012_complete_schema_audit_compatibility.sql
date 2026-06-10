BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  role TEXT NOT NULL DEFAULT 'user',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'inactive',
  premium_until TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'inactive',
  ADD COLUMN IF NOT EXISTS premium_until TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

UPDATE public.users
SET subscription_status = 'inactive'
WHERE subscription_status IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
  ON public.users (email);

CREATE INDEX IF NOT EXISTS idx_users_plan
  ON public.users (plan);

CREATE INDEX IF NOT EXISTS idx_users_role
  ON public.users (role);

CREATE INDEX IF NOT EXISTS idx_users_stripe_customer
  ON public.users (stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription
  ON public.users (stripe_subscription_id);

CREATE TABLE IF NOT EXISTS public.user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_sessions
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
  ON public.user_sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_refresh_token
  ON public.user_sessions (refresh_token);

CREATE TABLE IF NOT EXISTS public.user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'equilibrado',
  preferred_timeframe TEXT NOT NULL DEFAULT 'M5',
  premium_unlocked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'equilibrado',
  ADD COLUMN IF NOT EXISTS preferred_timeframe TEXT NOT NULL DEFAULT 'M5',
  ADD COLUMN IF NOT EXISTS premium_unlocked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_settings_user_id_unique
  ON public.user_settings (user_id);

CREATE TABLE IF NOT EXISTS public.user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  trading_mode TEXT DEFAULT 'balanced',
  preferred_symbols JSONB DEFAULT '[]'::jsonb,
  ai_explanations_enabled BOOLEAN DEFAULT TRUE,
  notifications_enabled BOOLEAN DEFAULT TRUE,
  panel_layout TEXT DEFAULT 'default',
  theme TEXT DEFAULT 'dark',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS trading_mode TEXT DEFAULT 'balanced',
  ADD COLUMN IF NOT EXISTS preferred_symbols JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_explanations_enabled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS panel_layout TEXT DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'dark',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

ALTER TABLE public.user_preferences
  ALTER COLUMN preferred_symbols TYPE JSONB
  USING CASE
    WHEN preferred_symbols IS NULL THEN '[]'::jsonb
    ELSE to_jsonb(preferred_symbols)
  END;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_preferences_user_id_unique
  ON public.user_preferences (user_id);

CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  plan TEXT,
  status TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_end TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE public.billing_subscriptions
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS plan TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMP,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_user_id
  ON public.billing_subscriptions (user_id);

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_stripe_customer
  ON public.billing_subscriptions (stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_stripe_subscription
  ON public.billing_subscriptions (stripe_subscription_id);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL DEFAULT 'system_event',
  description TEXT NOT NULL DEFAULT '',
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'system_event',
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created
  ON public.audit_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_event_created
  ON public.audit_logs (event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.signal_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL DEFAULT 'UNKNOWN',
  direction TEXT,
  signal TEXT,
  timeframe TEXT,
  score NUMERIC DEFAULT 0,
  confidence NUMERIC DEFAULT 0,
  final_score NUMERIC DEFAULT 0,
  adjusted_score NUMERIC DEFAULT 0,
  minimum_score NUMERIC DEFAULT 0,
  entry_quality TEXT,
  strategy TEXT,
  strategy_name TEXT,
  result TEXT NOT NULL DEFAULT 'pending',
  mode TEXT DEFAULT 'balanced',
  trend_direction TEXT,
  trend_strength NUMERIC DEFAULT 0,
  volatility NUMERIC DEFAULT 0,
  entry_price NUMERIC,
  result_price NUMERIC,
  expires_at TIMESTAMP,
  checked_at TIMESTAMP,
  blocked BOOLEAN DEFAULT FALSE,
  block_reason TEXT,
  explanation TEXT,
  timing TEXT,
  entry_in_seconds INTEGER DEFAULT 0,
  timing_mode TEXT,
  timing_confidence NUMERIC,
  market_regime TEXT,
  institutional_quality TEXT,
  adaptive_adjustment NUMERIC DEFAULT 0,
  tuning_weight NUMERIC DEFAULT 1,
  execution_allowed BOOLEAN DEFAULT TRUE,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE public.signal_history
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS symbol TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS direction TEXT,
  ADD COLUMN IF NOT EXISTS signal TEXT,
  ADD COLUMN IF NOT EXISTS timeframe TEXT,
  ADD COLUMN IF NOT EXISTS score NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_score NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjusted_score NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS minimum_score NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS entry_quality TEXT,
  ADD COLUMN IF NOT EXISTS strategy TEXT,
  ADD COLUMN IF NOT EXISTS strategy_name TEXT,
  ADD COLUMN IF NOT EXISTS result TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'balanced',
  ADD COLUMN IF NOT EXISTS trend_direction TEXT,
  ADD COLUMN IF NOT EXISTS trend_strength NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS volatility NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS entry_price NUMERIC,
  ADD COLUMN IF NOT EXISTS result_price NUMERIC,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS checked_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS block_reason TEXT,
  ADD COLUMN IF NOT EXISTS explanation TEXT,
  ADD COLUMN IF NOT EXISTS timing TEXT,
  ADD COLUMN IF NOT EXISTS entry_in_seconds INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS timing_mode TEXT,
  ADD COLUMN IF NOT EXISTS timing_confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS market_regime TEXT,
  ADD COLUMN IF NOT EXISTS institutional_quality TEXT,
  ADD COLUMN IF NOT EXISTS adaptive_adjustment NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tuning_weight NUMERIC DEFAULT 1,
  ADD COLUMN IF NOT EXISTS execution_allowed BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

UPDATE public.signal_history
SET signal = direction
WHERE signal IS NULL
  AND direction IS NOT NULL;

UPDATE public.signal_history
SET strategy_name = strategy
WHERE strategy_name IS NULL
  AND strategy IS NOT NULL;

UPDATE public.signal_history
SET result = 'pending'
WHERE result IS NULL;

UPDATE public.signal_history
SET final_score = COALESCE(NULLIF(final_score, 0), confidence, score, 0)
WHERE final_score IS NULL OR final_score = 0;

UPDATE public.signal_history
SET adjusted_score = COALESCE(NULLIF(adjusted_score, 0), final_score, confidence, score, 0)
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
    AND COALESCE(NULLIF(adjusted_score, 0), final_score, confidence, score, 0) >= minimum_score
  THEN TRUE
  ELSE FALSE
END
WHERE execution_allowed IS NULL;

CREATE INDEX IF NOT EXISTS idx_signal_history_created_at
  ON public.signal_history (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_history_symbol_created
  ON public.signal_history (symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_history_result_created
  ON public.signal_history (result, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_history_expires_result
  ON public.signal_history (result, expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signal_history_execution_allowed
  ON public.signal_history (execution_allowed, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_history_confirmed_operational
  ON public.signal_history (created_at DESC)
  WHERE COALESCE(blocked, false) = false
    AND COALESCE(execution_allowed, false) = true
    AND signal IN ('CALL', 'PUT');

CREATE INDEX IF NOT EXISTS idx_signal_history_strategy_created
  ON public.signal_history (strategy_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_history_market_regime_created
  ON public.signal_history (market_regime, created_at DESC);

CREATE TABLE IF NOT EXISTS public.filter_block_events (
  id SERIAL PRIMARY KEY,
  user_id UUID,
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

ALTER TABLE public.filter_block_events
  ADD COLUMN IF NOT EXISTS user_id UUID,
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

CREATE INDEX IF NOT EXISTS idx_filter_block_events_filter_label
  ON public.filter_block_events (filter_name, filter_label);

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

CREATE INDEX IF NOT EXISTS idx_threshold_history_scope_created
  ON public.threshold_history (scope_type, scope_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_threshold_history_symbol_created
  ON public.threshold_history (symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_threshold_history_strategy_created
  ON public.threshold_history (strategy_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_threshold_history_regime_created
  ON public.threshold_history (market_regime, created_at DESC);

CREATE TABLE IF NOT EXISTS public.threshold_changes (
  id SERIAL PRIMARY KEY,
  scope_type TEXT NOT NULL DEFAULT 'composite',
  scope_key TEXT NOT NULL DEFAULT 'global',
  threshold_name TEXT NOT NULL DEFAULT 'unknown',
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

CREATE INDEX IF NOT EXISTS idx_threshold_changes_scope_created
  ON public.threshold_changes (scope_type, scope_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_threshold_changes_name_created
  ON public.threshold_changes (threshold_name, created_at DESC);

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_threshold_performance_scope_unique
  ON public.threshold_performance (scope_type, scope_key);

CREATE INDEX IF NOT EXISTS idx_threshold_performance_scope
  ON public.threshold_performance (scope_type, scope_key);

CREATE TABLE IF NOT EXISTS public.ai_loss_memory (
  id SERIAL PRIMARY KEY,
  memory_key TEXT UNIQUE NOT NULL,
  symbol TEXT,
  direction TEXT,
  strategy TEXT,
  hour INTEGER,
  total INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  last_results JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE public.ai_loss_memory
  ADD COLUMN IF NOT EXISTS memory_key TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS symbol TEXT,
  ADD COLUMN IF NOT EXISTS direction TEXT,
  ADD COLUMN IF NOT EXISTS strategy TEXT,
  ADD COLUMN IF NOT EXISTS hour INTEGER,
  ADD COLUMN IF NOT EXISTS total INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wins INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS losses INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_results JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_loss_memory_key_unique
  ON public.ai_loss_memory (memory_key);

CREATE INDEX IF NOT EXISTS idx_ai_loss_memory_bad_patterns
  ON public.ai_loss_memory (total DESC, losses DESC, updated_at DESC);

COMMIT;
