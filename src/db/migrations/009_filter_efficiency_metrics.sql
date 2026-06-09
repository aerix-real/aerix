ALTER TABLE IF EXISTS public.filter_block_events
  ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT 'block',
  ADD COLUMN IF NOT EXISTS original_score NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjusted_score NUMERIC DEFAULT 0;

UPDATE public.filter_block_events
SET
  action = COALESCE(NULLIF(action, ''), 'block'),
  original_score = COALESCE(NULLIF(original_score, 0), score, final_score, 0),
  adjusted_score = COALESCE(NULLIF(adjusted_score, 0), final_score, score, 0)
WHERE action IS NULL
   OR action = ''
   OR original_score IS NULL
   OR adjusted_score IS NULL
   OR original_score = 0
   OR adjusted_score = 0;

CREATE INDEX IF NOT EXISTS idx_filter_block_events_action
  ON public.filter_block_events(action);
