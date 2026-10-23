-- Conversation tokens are the required cap. Optional organization/audio limits use NULL as no cap.
-- No policies, usage history, grants, blocks or operational records are changed by this migration.
ALTER TABLE public.ai_usage_policies
  DROP CONSTRAINT ai_usage_policies_check,
  ADD CONSTRAINT ai_usage_policies_conversation_limit_required CHECK (NOT enabled OR conversation_tokens IS NOT NULL);

CREATE OR REPLACE FUNCTION public.ai_usage_reserve(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE org uuid:=(p_input->>'organization_id')::uuid; conv uuid:=(p_input->>'conversation_id')::uuid;
 account uuid; p public.ai_usage_policies; prior public.ai_usage_attempts; b jsonb; reason text;
 amount numeric:=(p_input->>'reserved_amount')::numeric; unit text:=p_input->>'unit'; org_used numeric; attempt uuid;
BEGIN
 PERFORM ai_usage_internal.lock_org(org);
 SELECT * INTO p FROM public.ai_usage_policies WHERE organization_id=org;
 SELECT * INTO prior FROM public.ai_usage_attempts WHERE organization_id=org AND idempotency_key=p_input->>'idempotency_key';
 IF FOUND THEN RETURN jsonb_build_object('allowed',false,'attempt_id',prior.id,'replay',true,'status',prior.status,'reason','replayed_attempt'); END IF;
 IF amount IS NULL OR amount<=0 OR amount>=1e15 OR unit NOT IN('tokens','seconds') THEN RAISE EXCEPTION 'Invalid reservation'; END IF;
 IF conv IS NOT NULL THEN
   account:=public.ai_usage_context(org,conv);
   IF ai_usage_internal.root(org,(p_input->>'account_id')::uuid) IS DISTINCT FROM account THEN RAISE EXCEPTION 'Usage account mismatch'; END IF;
   b:=public.ai_usage_budget(org,conv);
   IF b->>'blocked_at' IS NOT NULL THEN reason:=b->>'blocked_reason'; END IF;
 ELSIF p_input->>'account_id' IS NOT NULL OR p_input->>'scope'='conversation' THEN RAISE EXCEPTION 'Conversation identity required'; END IF;
 IF p_input->>'deal_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.deals WHERE id=(p_input->>'deal_id')::uuid AND organization_id=org) THEN RAISE EXCEPTION 'Deal scope mismatch'; END IF;
 IF p.enabled AND p_input#>'{metadata,enforcementChecked}' IS DISTINCT FROM 'true'::jsonb THEN reason:=coalesce(reason,'enforcement_not_checked'); END IF;
 IF p.enabled AND reason IS NULL THEN
   IF account IS NOT NULL AND unit='tokens' AND (b->>'tokens_used')::numeric+(b->>'tokens_reserved')::numeric+amount > p.conversation_tokens+(b->>'tokens_granted')::numeric THEN reason:='conversation_token_limit'; END IF;
   IF account IS NOT NULL AND unit='seconds' AND p.conversation_audio_seconds IS NOT NULL AND (b->>'seconds_used')::numeric+(b->>'seconds_reserved')::numeric+amount > p.conversation_audio_seconds+(b->>'seconds_granted')::numeric THEN reason:='conversation_audio_limit'; END IF;
   IF unit='tokens' AND p.organization_daily_tokens IS NOT NULL THEN
    SELECT coalesce(sum(CASE WHEN u.status='completed' THEN u.actual_amount ELSE u.reserved_amount END),0) INTO org_used
    FROM public.ai_usage_attempts u WHERE u.organization_id=org AND u.unit='tokens'
      AND ((u.status='completed' AND coalesce(u.dispatched_at,u.created_at)>=now()-interval '24 hours') OR u.status IN('reserved','dispatched','unknown'));
    IF org_used+amount>p.organization_daily_tokens THEN reason:=coalesce(reason,'organization_daily_token_limit'); END IF;
   END IF;
 END IF;
 IF reason IS NOT NULL AND account IS NOT NULL THEN PERFORM public.ai_usage_block(org,account,conv,reason); END IF;
 INSERT INTO public.ai_usage_attempts(organization_id,account_id,conversation_id,agent_id,run_id,deal_id,scope,idempotency_key,operation,provider,model,unit,reserved_amount,status,metadata)
 VALUES(org,account,conv,(p_input->>'agent_id')::uuid,p_input->>'run_id',(p_input->>'deal_id')::uuid,p_input->>'scope',p_input->>'idempotency_key',
 p_input->>'operation',p_input->>'provider',p_input->>'model',unit,amount,CASE WHEN reason IS NULL THEN 'reserved' ELSE 'denied' END,coalesce(p_input->'metadata','{}')) RETURNING id INTO attempt;
 RETURN jsonb_build_object('allowed',reason IS NULL,'attempt_id',attempt,'replay',false,'status',CASE WHEN reason IS NULL THEN 'reserved' ELSE 'denied' END,'reason',reason);
END $$;

CREATE OR REPLACE FUNCTION public.ai_usage_dispatch(p_org uuid,p_attempt uuid) RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $$
DECLARE a public.ai_usage_attempts; account uuid; p public.ai_usage_policies; b jsonb; reason text; org_used numeric;
BEGIN
 PERFORM ai_usage_internal.lock_org(p_org);
 SELECT * INTO a FROM public.ai_usage_attempts WHERE id=p_attempt AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND OR a.status<>'reserved' THEN RETURN false; END IF;
 account:=ai_usage_internal.root(p_org,a.account_id);
 IF EXISTS(SELECT 1 FROM public.ai_usage_accounts WHERE id=account AND blocked_at IS NOT NULL) THEN
  UPDATE public.ai_usage_attempts SET status='cancelled',actual_amount=0,settled_at=now() WHERE id=p_attempt; RETURN false;
 END IF;
 SELECT * INTO p FROM public.ai_usage_policies WHERE organization_id=p_org;
 IF p.enabled THEN
  IF a.metadata->'enforcementChecked' IS DISTINCT FROM 'true'::jsonb THEN reason:='enforcement_not_checked'; END IF;
  IF account IS NOT NULL THEN
   b:=public.ai_usage_budget(p_org,a.conversation_id);
   IF a.unit='tokens' AND (b->>'tokens_used')::numeric+(b->>'tokens_reserved')::numeric > p.conversation_tokens+(b->>'tokens_granted')::numeric THEN reason:=coalesce(reason,'conversation_token_limit'); END IF;
   IF a.unit='seconds' AND p.conversation_audio_seconds IS NOT NULL AND (b->>'seconds_used')::numeric+(b->>'seconds_reserved')::numeric > p.conversation_audio_seconds+(b->>'seconds_granted')::numeric THEN reason:=coalesce(reason,'conversation_audio_limit'); END IF;
  END IF;
  IF a.unit='tokens' AND p.organization_daily_tokens IS NOT NULL THEN
   SELECT coalesce(sum(CASE WHEN u.status='completed' THEN u.actual_amount ELSE u.reserved_amount END),0) INTO org_used
   FROM public.ai_usage_attempts u WHERE u.organization_id=p_org AND u.unit='tokens'
    AND ((u.status='completed' AND coalesce(u.dispatched_at,u.created_at)>=now()-interval '24 hours') OR u.status IN('reserved','dispatched','unknown'));
   IF org_used>p.organization_daily_tokens THEN reason:=coalesce(reason,'organization_daily_token_limit'); END IF;
  END IF;
 END IF;
 IF reason IS NOT NULL THEN
  UPDATE public.ai_usage_attempts SET status='cancelled',actual_amount=0,settled_at=now(),metadata=metadata||jsonb_build_object('dispatch_denied',reason) WHERE id=p_attempt;
  IF account IS NOT NULL THEN PERFORM public.ai_usage_block(p_org,account,a.conversation_id,reason); END IF;
  RETURN false;
 END IF;
 UPDATE public.ai_usage_attempts SET status='dispatched',dispatched_at=now() WHERE id=p_attempt;
 RETURN true;
END $$;

