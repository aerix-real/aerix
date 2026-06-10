ALTER TABLE public.signal_history
  ADD COLUMN IF NOT EXISTS signal TEXT,
  ADD COLUMN IF NOT EXISTS final_score NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS execution_allowed BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS minimum_score NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjusted_score NUMERIC DEFAULT 0;

UPDATE public.signal_history
SET signal = direction
WHERE signal IS NULL
  AND direction IS NOT NULL;

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
END;

CREATE INDEX IF NOT EXISTS idx_signal_history_execution_allowed
  ON public.signal_history(execution_allowed, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_history_confirmed_operational
  ON public.signal_history(created_at DESC)
  WHERE COALESCE(blocked, false) = false
    AND COALESCE(execution_allowed, false) = true
    AND signal IN ('CALL', 'PUT');

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status TEXT,
  ADD COLUMN IF NOT EXISTS premium_until TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_users_stripe_customer
  ON public.users(stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription
  ON public.users(stripe_subscription_id);
