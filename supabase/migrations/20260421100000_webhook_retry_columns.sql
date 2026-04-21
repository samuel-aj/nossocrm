-- Add retry/backoff columns to webhook_deliveries and status to webhook_events_out
-- Required for outbound webhook retry with exponential backoff

-- 1) Add status tracking to outbound events (pending → delivered | failed)
ALTER TABLE public.webhook_events_out
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

-- 2) Add retry and response tracking to deliveries
ALTER TABLE public.webhook_deliveries
  ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS response_body TEXT,
  ADD COLUMN IF NOT EXISTS duration_ms INT;

-- 3) Index for the cron retry query: find deliveries that need retry
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry
  ON public.webhook_deliveries (next_retry_at)
  WHERE status = 'queued' AND next_retry_at IS NOT NULL;

-- 4) Index for finding pending events
CREATE INDEX IF NOT EXISTS idx_webhook_events_out_status
  ON public.webhook_events_out (status)
  WHERE status = 'pending';
