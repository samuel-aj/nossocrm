-- A provider's explicit billing rejection is not an ambiguous paid operation.
-- Keep the attempt as evidence, release only its reservation and retain a
-- manual block with the provider-specific reason. No historical rows change.
ALTER TABLE public.ai_usage_attempts DROP CONSTRAINT ai_usage_attempts_status_check;
ALTER TABLE public.ai_usage_attempts ADD CONSTRAINT ai_usage_attempts_status_check
  CHECK (status IN ('reserved','dispatched','completed','unknown','cancelled','denied','rejected'));

CREATE OR REPLACE FUNCTION public.ai_usage_settle(p_org uuid,p_attempt uuid,p_result jsonb)
RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
 a public.ai_usage_attempts;
 target text:=p_result->>'status';
 amount numeric:=(p_result->>'actualAmount')::numeric;
 enabled boolean;
 evidence jsonb:=p_result->'metadata';
 provider_code text:=p_result#>>'{metadata,providerErrorCode}';
 provider_type text:=p_result#>>'{metadata,providerErrorType}';
BEGIN
 PERFORM ai_usage_internal.lock_org(p_org);
 SELECT * INTO a FROM public.ai_usage_attempts WHERE id=p_attempt AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Usage attempt not found'; END IF;
 IF a.status IN('completed','cancelled','denied','rejected') THEN RETURN false; END IF;
 IF target NOT IN('completed','unknown','cancelled','rejected') THEN RAISE EXCEPTION 'Invalid settlement state'; END IF;
 IF target='cancelled' AND a.status<>'reserved' THEN RAISE EXCEPTION 'Dispatched usage cannot be refunded as cancelled'; END IF;
 IF target='completed' AND (a.status NOT IN('dispatched','unknown') OR amount IS NULL OR amount<0 OR amount>=1e15) THEN RAISE EXCEPTION 'Actual provider usage required'; END IF;
 IF target='unknown' AND a.status NOT IN('dispatched','unknown') THEN RAISE EXCEPTION 'Only dispatched usage may be ambiguous'; END IF;
 IF target='rejected' THEN
  -- Only the server's narrowly classified HTTP 429 billing response can release
  -- a dispatched reservation. Timeouts, 5xx and legacy unknowns stay reserved.
  IF a.status<>'dispatched' OR a.provider<>'openai'
   OR evidence->>'reason' IS DISTINCT FROM 'provider_insufficient_quota'
   OR evidence->>'evidenceVersion' IS DISTINCT FROM 'openai-quota-v1'
   OR evidence->'providerStatusCode' IS DISTINCT FROM '429'::jsonb
   OR NOT coalesce(provider_code IN ('insufficient_quota','credit_balance_exhausted','organization_usage_limit_exceeded')
     OR (provider_code IS NULL AND provider_type='insufficient_quota'),false)
   OR p_result->>'actualAmount' IS NOT NULL OR p_result->>'inputTokens' IS NOT NULL
   OR p_result->>'outputTokens' IS NOT NULL OR p_result->>'cachedInputTokens' IS NOT NULL
   OR p_result->>'reasoningTokens' IS NOT NULL OR p_result->>'totalTokens' IS NOT NULL
   OR p_result->>'estimatedCostUsd' IS NOT NULL OR p_result->>'pricingVersion' IS NOT NULL THEN
   RAISE EXCEPTION 'Definitive provider rejection evidence required';
  END IF;
 END IF;
 UPDATE public.ai_usage_attempts SET status=target,
 actual_amount=CASE WHEN target='completed' THEN amount WHEN target='cancelled' THEN 0 ELSE NULL END,
 input_tokens=(p_result->>'inputTokens')::bigint,output_tokens=(p_result->>'outputTokens')::bigint,cached_input_tokens=(p_result->>'cachedInputTokens')::bigint,
 reasoning_tokens=(p_result->>'reasoningTokens')::bigint,total_tokens=(p_result->>'totalTokens')::bigint,
 estimated_cost_usd=(p_result->>'estimatedCostUsd')::numeric,pricing_version=p_result->>'pricingVersion',
 metadata=metadata||coalesce(p_result->'metadata','{}'),settled_at=CASE WHEN target='unknown' THEN NULL ELSE now() END WHERE id=p_attempt;
 SELECT p.enabled INTO enabled FROM public.ai_usage_policies p WHERE organization_id=p_org;
 IF a.account_id IS NOT NULL AND enabled AND (target IN ('unknown','rejected') OR amount>a.reserved_amount) THEN
  PERFORM public.ai_usage_block(p_org,a.account_id,a.conversation_id,
   CASE WHEN target='rejected' THEN 'provider_insufficient_quota' WHEN target='unknown' THEN 'usage_unknown' ELSE 'usage_bound_exceeded' END);
 END IF;
 RETURN true;
END $$;

-- CREATE OR REPLACE preserves ACLs; repeat the service-only boundary explicitly.
REVOKE ALL ON FUNCTION public.ai_usage_settle(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ai_usage_settle(uuid,uuid,jsonb) TO service_role;
