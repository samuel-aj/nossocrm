-- Idempotency for POST /api/public/v1/deals.
-- n8n (and any integration) can send `external_id` to avoid creating duplicate deals
-- when the webhook is re-delivered. Unique per organization, partial (allows NULL).

ALTER TABLE public.deals
ADD COLUMN IF NOT EXISTS external_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS deals_org_external_id_unique
ON public.deals (organization_id, external_id)
WHERE external_id IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN public.deals.external_id IS
'Caller-provided idempotency key (e.g., n8n execution id, Meta Lead id). Unique per organization for active deals. If absent, no idempotency is enforced.';
