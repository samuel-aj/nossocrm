-- Adds the opt-in agent path; does not update any existing document or enable an agent.
BEGIN;
ALTER TABLE public.deal_signatures DROP CONSTRAINT deal_signatures_origin_check;
ALTER TABLE public.deal_signatures ADD CONSTRAINT deal_signatures_origin_check CHECK (origin IN ('rule', 'manual', 'agent'));
CREATE UNIQUE INDEX deal_signatures_agent_template_once
  ON public.deal_signatures (organization_id, deal_id, template_token) WHERE origin = 'agent';
-- An ambiguous provider response must never be retried by the old signature worker.
ALTER TABLE public.deal_signatures ADD CONSTRAINT deal_signatures_agent_no_queue
  CHECK (origin <> 'agent' OR (status <> 'queued' AND lock_until IS NULL AND template_token IS NOT NULL));
COMMIT;
