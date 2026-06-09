ALTER TABLE public.signal_history
  ADD COLUMN IF NOT EXISTS execution_allowed BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS minimum_score NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjusted_score NUMERIC DEFAULT 0;

UPDATE public.signal_history
SET adjusted_score = COALESCE(NULLIF(adjusted_score, 0), final_score, confidence, 0)
WHERE adjusted_score IS NULL OR adjusted_score = 0;

UPDATE public.signal_history
SET minimum_score = CASE
  WHEN LOWER(COALESCE(mode, 'balanced')) IN ('conservador', 'conservative') THEN 88
  WHEN LOWER(COALESCE(mode, 'balanced')) IN ('agressivo', 'aggressive') THEN 70
  ELSE 78
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

CREATE INDEX IF NOT EXISTS idx_signal_history_confirmed_entries
  ON public.signal_history(created_at DESC)
  WHERE COALESCE(blocked, false) = false
    AND COALESCE(execution_allowed, false) = true
    AND signal IN ('CALL', 'PUT');
