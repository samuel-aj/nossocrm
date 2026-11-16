-- Synthetic data only, run in the isolated PGlite harness. No external calls.
CREATE FUNCTION usage_test.rejection_reserve(org int,conv int,key text,amount numeric,provider_name text DEFAULT 'openai')
RETURNS uuid LANGUAGE sql AS $$
 SELECT (public.ai_usage_reserve(jsonb_build_object('organization_id',usage_test.id(org),'conversation_id',usage_test.id(conv),
  'account_id',public.ai_usage_context(usage_test.id(org),usage_test.id(conv)),
  'scope','conversation','idempotency_key',key,'operation','reply','provider',provider_name,'model','gpt-4.1',
  'unit','tokens','reserved_amount',amount,'metadata','{"enforcementChecked":true}'::jsonb))->>'attempt_id')::uuid
$$;
CREATE FUNCTION usage_test.quota_rejection(code text DEFAULT 'credit_balance_exhausted') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('status','rejected','metadata',jsonb_build_object('reason','provider_insufficient_quota',
  'evidenceVersion','openai-quota-v1','providerStatusCode',429,'providerErrorCode',code,'providerErrorType','insufficient_quota'))
$$;
INSERT INTO public.organizations VALUES(usage_test.id(30)),(usage_test.id(31)),(usage_test.id(32));
INSERT INTO public.profiles VALUES(usage_test.id(30000),usage_test.id(30));
INSERT INTO public.wa_conversations(id,organization_id,wa_phone) VALUES
 (usage_test.id(30001),usage_test.id(30),'provider-rejected-main'),
 (usage_test.id(30002),usage_test.id(30),'provider-rejected-other'),
 (usage_test.id(32001),usage_test.id(32),'provider-rejected-measurement');
SELECT public.ai_usage_policy_set(usage_test.id(30),'{"enabled":true,"conversation_tokens":300000,"organization_daily_tokens":null,"conversation_audio_seconds":null}');

DO $$ DECLARE org uuid:=usage_test.id(30); conv uuid:=usage_test.id(30001); attempt uuid; rejected uuid; before_usage jsonb; b jsonb; err boolean; BEGIN
 attempt:=usage_test.rejection_reserve(30,30001,'provider-completed',90000);
 PERFORM usage_test.assert(public.ai_usage_dispatch(org,attempt),'completed setup dispatched');
 PERFORM public.ai_usage_settle(org,attempt,'{"status":"completed","actualAmount":73082,"inputTokens":70000,"outputTokens":3082,"totalTokens":73082}');
 rejected:=usage_test.rejection_reserve(30,30001,'provider-billing',99804);
 PERFORM usage_test.assert(public.ai_usage_dispatch(org,rejected),'billing request dispatched once');
 b:=public.ai_usage_budget(org,conv);
 PERFORM usage_test.assert((b->>'tokens_used')::int=73082 AND (b->>'tokens_reserved')::int=99804,'case reproduces known usage and pending reservation');
 err:=false; BEGIN
  PERFORM public.ai_usage_settle(usage_test.id(31),rejected,usage_test.quota_rejection());
 EXCEPTION WHEN raise_exception THEN err:=SQLERRM='Usage attempt not found'; END;
 PERFORM usage_test.assert(err AND (SELECT status='dispatched' FROM public.ai_usage_attempts WHERE id=rejected),'foreign organization cannot settle attempt');
 PERFORM usage_test.assert(public.ai_usage_settle(org,rejected,usage_test.quota_rejection()),'definitive billing rejection settles');
 b:=public.ai_usage_budget(org,conv);
 PERFORM usage_test.assert((b->>'tokens_used')::int=73082 AND (b->>'tokens_reserved')::int=0,'rejection releases only reservation and preserves actual usage');
 PERFORM usage_test.assert((b->'policy'->>'conversation_tokens')::int=300000 AND (b->>'tokens_granted')::int=0,'rejection does not inflate policy or grants');
 PERFORM usage_test.assert(b->>'blocked_reason'='provider_insufficient_quota' AND b->>'blocked_at' IS NOT NULL,'provider billing reason remains manually blocked');
 PERFORM usage_test.assert((SELECT ai_status='paused' AND ai_resume_at IS NULL FROM public.wa_conversations WHERE id=conv),'native AI is paused without automatic resume');
 PERFORM usage_test.assert((SELECT status='rejected' AND actual_amount IS NULL AND total_tokens IS NULL AND estimated_cost_usd IS NULL AND settled_at IS NOT NULL AND reserved_amount=99804 FROM public.ai_usage_attempts WHERE id=rejected),'rejected attempt retains evidence without fabricated zero usage');
 SELECT to_jsonb(a) INTO before_usage FROM public.ai_usage_attempts a WHERE id=rejected;
 PERFORM usage_test.assert(NOT public.ai_usage_settle(org,rejected,usage_test.quota_rejection()),'rejection settlement replay is idempotent');
 PERFORM usage_test.assert(NOT public.ai_usage_settle(org,rejected,'{"status":"completed","actualAmount":1}'),'terminal rejected attempt cannot be rewritten');
 PERFORM usage_test.assert(before_usage=(SELECT to_jsonb(a) FROM public.ai_usage_attempts a WHERE id=rejected),'terminal rejected audit evidence remains unchanged');
 PERFORM usage_test.assert(NOT public.ai_usage_dispatch(org,rejected) AND (SELECT count(*)=1 FROM public.ai_usage_notices WHERE organization_id=org AND resolved_at IS NULL),'no redispatch or duplicate notice');
 SELECT to_jsonb(a) INTO before_usage FROM public.ai_usage_attempts a WHERE id=attempt;
 PERFORM usage_test.assert(NOT public.ai_usage_settle(org,attempt,usage_test.quota_rejection()) AND before_usage=(SELECT to_jsonb(a) FROM public.ai_usage_attempts a WHERE id=attempt),'confirmed consumption cannot be rejected later');
 PERFORM public.ai_usage_policy_set(org,'{"organization_daily_tokens":74082}');
 attempt:=usage_test.rejection_reserve(30,30002,'provider-daily-independent',1000);
 PERFORM usage_test.assert(attempt IS NOT NULL AND public.ai_usage_dispatch(org,attempt),'rejected reserve does not consume organization daily limit');
 PERFORM public.ai_usage_settle(org,attempt,'{"status":"completed","actualAmount":1000}');
 PERFORM public.ai_usage_policy_set(org,'{"organization_daily_tokens":null}');
 PERFORM public.ai_usage_grant(jsonb_build_object('organization_id',org,'conversation_id',conv,'actor_id',usage_test.id(30000),'reason','Responsible reviewed billing','tokens',1,'idempotency_key','provider-manual-review'));
 PERFORM usage_test.assert(public.ai_usage_budget(org,conv)->>'blocked_at' IS NULL AND (SELECT ai_status='paused' FROM public.wa_conversations WHERE id=conv),'manual grant clears block without resuming agent');
END $$;

DO $$ DECLARE n int:=0; code text; conv int; attempt uuid; err boolean; payload jsonb; BEGIN
 -- All supported provider response forms, including the older type-only shape.
 FOREACH code IN ARRAY ARRAY['credit_balance_exhausted','organization_usage_limit_exceeded','insufficient_quota',NULL] LOOP
  n:=n+1; conv:=30100+n;
  INSERT INTO public.wa_conversations(id,organization_id,wa_phone) VALUES(usage_test.id(conv),usage_test.id(30),'provider-code-'||n);
  attempt:=usage_test.rejection_reserve(30,conv,'provider-code-'||n,100);
  PERFORM public.ai_usage_dispatch(usage_test.id(30),attempt);
  PERFORM usage_test.assert(public.ai_usage_settle(usage_test.id(30),attempt,usage_test.quota_rejection(code)),'supported billing code settles '||coalesce(code,'type only'));
 END LOOP;
 -- Unsupported or incomplete evidence can never refund a dispatched request.
 FOR n IN 1..12 LOOP
  conv:=30200+n;
  INSERT INTO public.wa_conversations(id,organization_id,wa_phone) VALUES(usage_test.id(conv),usage_test.id(30),'provider-invalid-'||n);
  attempt:=usage_test.rejection_reserve(30,conv,'provider-invalid-'||n,100,CASE WHEN n=1 THEN 'anthropic' ELSE 'openai' END);
  IF n<>2 THEN PERFORM public.ai_usage_dispatch(usage_test.id(30),attempt); END IF;
  payload:=usage_test.quota_rejection();
  CASE n
   WHEN 3 THEN payload:=jsonb_set(payload,'{metadata,providerStatusCode}','500');
   WHEN 4 THEN payload:=jsonb_set(payload,'{metadata,providerErrorCode}','"rate_limit_exceeded"');
   WHEN 5 THEN payload:=payload#-'{metadata,evidenceVersion}';
   WHEN 6 THEN payload:=payload#-'{metadata,reason}';
   WHEN 7 THEN payload:=payload||'{"actualAmount":0}';
   WHEN 8 THEN payload:=payload||'{"totalTokens":0}';
   WHEN 9 THEN payload:=payload||'{"estimatedCostUsd":0}';
   WHEN 10 THEN payload:=jsonb_set(payload,'{metadata,providerStatusCode}','"429"');
   WHEN 11 THEN payload:=payload#-'{metadata,providerErrorCode}'#-'{metadata,providerErrorType}';
   WHEN 12 THEN payload:=jsonb_set(payload,'{metadata,providerErrorCode}','"unknown_error"');
   ELSE NULL;
  END CASE;
  err:=false; BEGIN
   PERFORM public.ai_usage_settle(usage_test.id(30),attempt,payload);
  EXCEPTION WHEN raise_exception THEN err:=SQLERRM='Definitive provider rejection evidence required'; END;
  PERFORM usage_test.assert(err,'invalid rejection evidence denied '||n);
  PERFORM usage_test.assert((public.ai_usage_budget(usage_test.id(30),usage_test.id(conv))->>'tokens_reserved')::int=100,'invalid rejection keeps full reservation '||n);
 END LOOP;
END $$;

DO $$ DECLARE org uuid:=usage_test.id(30); conv uuid:=usage_test.id(30301); attempt uuid; before_usage jsonb; err boolean; BEGIN
 INSERT INTO public.wa_conversations(id,organization_id,wa_phone) VALUES(conv,org,'provider-ambiguous');
 attempt:=usage_test.rejection_reserve(30,30301,'provider-timeout',99804);
 PERFORM public.ai_usage_dispatch(org,attempt);
 PERFORM public.ai_usage_settle(org,attempt,'{"status":"unknown","metadata":{"reason":"provider_or_settlement_error"}}');
 SELECT to_jsonb(a) INTO before_usage FROM public.ai_usage_attempts a WHERE id=attempt;
 err:=false; BEGIN PERFORM public.ai_usage_settle(org,attempt,usage_test.quota_rejection());
 EXCEPTION WHEN raise_exception THEN err:=SQLERRM='Definitive provider rejection evidence required'; END;
 PERFORM usage_test.assert(err AND before_usage=(SELECT to_jsonb(a) FROM public.ai_usage_attempts a WHERE id=attempt),'unknown history is never silently reconciled as rejected');
 PERFORM usage_test.assert((public.ai_usage_budget(org,conv)->>'tokens_reserved')::int=99804 AND public.ai_usage_budget(org,conv)->>'blocked_reason'='usage_unknown','timeout remains reserved with original manual block');
 err:=false; BEGIN PERFORM public.ai_usage_settle(org,attempt,'{"status":"cancelled"}');
 EXCEPTION WHEN raise_exception THEN err:=SQLERRM='Dispatched usage cannot be refunded as cancelled'; END;
 PERFORM usage_test.assert(err,'ambiguous request cannot be cancelled either');
 PERFORM public.ai_usage_settle(org,attempt,'{"status":"completed","actualAmount":1200}');
 PERFORM usage_test.assert((public.ai_usage_budget(org,conv)->>'tokens_used')::int=1200 AND public.ai_usage_budget(org,conv)->>'blocked_at' IS NOT NULL,'actual late settlement still preserves manual release');
END $$;

SET ROLE service_role;
DO $$ DECLARE org uuid:=usage_test.id(32); conv uuid:=usage_test.id(32001); attempt uuid; BEGIN
 attempt:=usage_test.rejection_reserve(32,32001,'provider-measurement',100);
 PERFORM public.ai_usage_dispatch(org,attempt);
 PERFORM usage_test.assert(public.ai_usage_settle(org,attempt,usage_test.quota_rejection()),'measurement-only rejection is recorded');
 PERFORM usage_test.assert(public.ai_usage_budget(org,conv)->>'blocked_at' IS NULL AND (public.ai_usage_budget(org,conv)->>'tokens_reserved')::int=0 AND (SELECT ai_status='active' FROM public.wa_conversations WHERE id=conv),'measurement-only mode neither creates a permanent block nor keeps a rejected reserve');
END $$;
RESET ROLE;

SELECT usage_test.assert(NOT has_function_privilege('anon','public.ai_usage_settle(uuid,uuid,jsonb)','EXECUTE') AND NOT has_function_privilege('authenticated','public.ai_usage_settle(uuid,uuid,jsonb)','EXECUTE') AND has_function_privilege('service_role','public.ai_usage_settle(uuid,uuid,jsonb)','EXECUTE'),'provider rejection settlement remains service-only');
SELECT usage_test.assert((SELECT relrowsecurity FROM pg_class WHERE oid='public.ai_usage_attempts'::regclass),'usage RLS remains enabled');
SELECT 'PASS: provider rejection evidence, unchanged actual consumption, reservation release, manual pause, timeout safety, replay and organization isolation' AS result;
