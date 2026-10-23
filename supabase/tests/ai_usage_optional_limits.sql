-- Synthetic regression data only. Apply after ai_usage.sql in an isolated database.
CREATE FUNCTION usage_test.optional_reserve(org int,conv int,key text,amount numeric,unit text DEFAULT 'tokens') RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.ai_usage_reserve(jsonb_build_object('organization_id',usage_test.id(org),'conversation_id',usage_test.id(conv),
  'account_id',public.ai_usage_context(usage_test.id(org),usage_test.id(conv)),
  'scope','conversation','idempotency_key',key,'operation','reply','provider','fixture','model','fixture-model',
  'unit',unit,'reserved_amount',amount,'metadata','{"enforcementChecked":true}'::jsonb))
$$;
INSERT INTO public.organizations VALUES(usage_test.id(10)),(usage_test.id(11)),(usage_test.id(12)),(usage_test.id(13));
INSERT INTO public.profiles VALUES(usage_test.id(10000),usage_test.id(10)),(usage_test.id(11000),usage_test.id(11));
INSERT INTO public.wa_conversations(id,organization_id,wa_phone,ai_status,ai_paused_by) VALUES
 (usage_test.id(10001),usage_test.id(10),'optional-10','active',NULL),
 (usage_test.id(11001),usage_test.id(11),'optional-11-a','active',NULL),
 (usage_test.id(11002),usage_test.id(11),'optional-11-b','active',NULL),
 (usage_test.id(12001),usage_test.id(12),'optional-12','paused',usage_test.id(10000)),
 (usage_test.id(13001),usage_test.id(13),'optional-13','stopped',NULL);
DO $$ DECLARE org uuid:=usage_test.id(10); r jsonb; attempt uuid; data jsonb; states jsonb; attempts jsonb; err boolean; n int; BEGIN
 r:=usage_test.optional_reserve(10,10001,'before-activation',250000); attempt:=(r->>'attempt_id')::uuid;
 PERFORM public.ai_usage_dispatch(org,attempt);
 PERFORM public.ai_usage_settle(org,attempt,'{"status":"completed","actualAmount":250000,"totalTokens":250000}');
 SELECT jsonb_agg(to_jsonb(c) ORDER BY id) INTO states FROM public.wa_conversations c;
 SELECT jsonb_agg(to_jsonb(a) ORDER BY id) INTO attempts FROM public.ai_usage_attempts a;
 -- The three chosen synthetic organizations are activated; a fourth remains untouched.
 FOR n IN 10..12 LOOP
  PERFORM public.ai_usage_policy_set(usage_test.id(n),'{"enabled":true,"conversation_tokens":300000,"organization_daily_tokens":null,"conversation_audio_seconds":null}');
 END LOOP;
 PERFORM usage_test.assert((SELECT count(*)=3 FROM public.ai_usage_policies WHERE organization_id IN(usage_test.id(10),usage_test.id(11),usage_test.id(12)) AND enabled AND conversation_tokens=300000 AND organization_daily_tokens IS NULL AND conversation_audio_seconds IS NULL),'three selected organizations enable only 300k per conversation');
 PERFORM usage_test.assert(NOT (public.ai_usage_policy_get(usage_test.id(13))->>'enabled')::boolean,'unselected organization remains disabled');
 PERFORM usage_test.assert(states=(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.wa_conversations c),'enabling limits never changes or resumes any conversation');
 PERFORM usage_test.assert(attempts=(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.ai_usage_attempts a),'enabling limits preserves every usage attempt');
 PERFORM usage_test.assert((public.ai_usage_budget(org,usage_test.id(10001))->>'tokens_used')::int=250000,'consumption before activation counts towards the quota');
 err:=false; BEGIN PERFORM public.ai_usage_policy_set(org,'{"conversation_tokens":null}'); EXCEPTION WHEN check_violation THEN err:=true; END;
 PERFORM usage_test.assert(err,'conversation quota cannot be removed while enabled');
 r:=usage_test.optional_reserve(10,10001,'exact-boundary',50000); attempt:=(r->>'attempt_id')::uuid;
 PERFORM usage_test.assert((r->>'allowed')::boolean AND public.ai_usage_dispatch(org,attempt),'exact 300k boundary permits one reserved call');
 PERFORM public.ai_usage_settle(org,attempt,'{"status":"completed","actualAmount":50000,"totalTokens":50000}');
 r:=usage_test.optional_reserve(10,10001,'over-boundary',1);
 PERFORM usage_test.assert(r->>'reason'='conversation_token_limit' AND NOT(r->>'allowed')::boolean,'one token beyond 300k is denied');
 PERFORM usage_test.assert((SELECT ai_status='paused' FROM public.wa_conversations WHERE id=usage_test.id(10001)) AND (SELECT count(*)=1 FROM public.ai_usage_notices WHERE organization_id=org AND resolved_at IS NULL),'exhaustion pauses native AI and creates one internal notice');
 r:=usage_test.optional_reserve(10,10001,'blocked-audio',1,'seconds');
 PERFORM usage_test.assert(NOT(r->>'allowed')::boolean,'persisted token block also prevents paid audio without a seconds cap');
 PERFORM public.ai_usage_policy_set(org,'{"enabled":false,"organization_daily_tokens":null,"conversation_audio_seconds":null}');
 PERFORM usage_test.assert(public.ai_usage_budget(org,usage_test.id(10001))->>'blocked_at' IS NOT NULL,'disabling all optional limits never clears a previous block');
 PERFORM public.ai_usage_grant(jsonb_build_object('organization_id',org,'conversation_id',usage_test.id(10001),'actor_id',usage_test.id(10000),'reason','Manual review fixture','tokens',1000,'idempotency_key','optional-manual-grant'));
 data:=public.ai_usage_budget(org,usage_test.id(10001));
 PERFORM usage_test.assert(data->>'blocked_at' IS NULL AND (data->>'tokens_used')::int=300000 AND (data->>'tokens_granted')::int=1000,'manual grant preserves 300k history and adds a credit');
 PERFORM usage_test.assert((SELECT ai_status='paused' FROM public.wa_conversations WHERE id=usage_test.id(10001)),'manual credit never resumes the conversation');
END $$;
DO $$ DECLARE org uuid:=usage_test.id(11); r jsonb; a uuid; b uuid; data jsonb; BEGIN
 r:=usage_test.optional_reserve(11,11001,'independent-a',200000); a:=(r->>'attempt_id')::uuid;
 PERFORM usage_test.assert((r->>'allowed')::boolean,'first conversation can reserve its own quota');
 r:=usage_test.optional_reserve(11,11002,'independent-b',200000); b:=(r->>'attempt_id')::uuid;
 PERFORM usage_test.assert((r->>'allowed')::boolean AND public.ai_usage_dispatch(org,a) AND public.ai_usage_dispatch(org,b),'separate conversations may jointly exceed 300k when daily cap is null');
 PERFORM public.ai_usage_settle(org,a,'{"status":"completed","actualAmount":180000,"totalTokens":180000}');
 PERFORM public.ai_usage_settle(org,b,'{"status":"completed","actualAmount":180000,"totalTokens":180000}');
 r:=usage_test.optional_reserve(11,11001,'uncapped-audio',15,'seconds'); a:=(r->>'attempt_id')::uuid;
 PERFORM usage_test.assert((r->>'allowed')::boolean AND public.ai_usage_dispatch(org,a),'null audio quota permits reserve and dispatch under token protection');
 PERFORM public.ai_usage_settle(org,a,'{"status":"completed","actualAmount":3.25,"estimatedCostUsd":0.000325,"pricingVersion":"fixture"}');
 data:=public.ai_usage_budget(org,usage_test.id(11001));
 PERFORM usage_test.assert((data->>'seconds_used')::numeric=3.25 AND (data->>'tokens_used')::int=180000,'uncapped audio measures fractional seconds independently from tokens');
 PERFORM usage_test.assert((SELECT estimated_cost_usd=0.000325 FROM public.ai_usage_attempts WHERE id=a),'uncapped audio retains its cost measurement');
 PERFORM public.ai_usage_policy_set(org,'{"conversation_audio_seconds":5}');
 r:=usage_test.optional_reserve(11,11001,'capped-audio',2,'seconds');
 PERFORM usage_test.assert(r->>'reason'='conversation_audio_limit','an explicit seconds limit still includes prior audio usage');
 PERFORM public.ai_usage_policy_set(org,'{"conversation_audio_seconds":null}');
 PERFORM usage_test.assert(public.ai_usage_budget(org,usage_test.id(11001))->>'blocked_reason'='conversation_audio_limit','removing audio limit does not erase its persistent block');
 PERFORM public.ai_usage_grant(jsonb_build_object('organization_id',org,'conversation_id',usage_test.id(11001),'actor_id',usage_test.id(11000),'reason','Manual audio review','tokens',0,'seconds',1,'idempotency_key','optional-audio-grant'));
 r:=usage_test.optional_reserve(11,11001,'unknown-audio',100,'seconds'); a:=(r->>'attempt_id')::uuid;
 PERFORM usage_test.assert((r->>'allowed')::boolean AND public.ai_usage_dispatch(org,a),'audio resumes only after explicit credit clears its block');
 PERFORM public.ai_usage_settle(org,a,'{"status":"unknown"}');
 data:=public.ai_usage_budget(org,usage_test.id(11001));
 PERFORM usage_test.assert(data->>'blocked_reason'='usage_unknown' AND (data->>'seconds_reserved')::numeric=100,'ambiguous uncapped audio keeps its reservation and requires manual review');
 PERFORM public.ai_usage_settle(org,a,'{"status":"completed","actualAmount":5}');
 PERFORM usage_test.assert(public.ai_usage_budget(org,usage_test.id(11001))->>'blocked_at' IS NOT NULL,'late audio settlement cannot resume a blocked conversation');
 PERFORM usage_test.assert(NOT public.ai_usage_dispatch(org,a),'completed uncapped audio cannot be dispatched again');
 PERFORM usage_test.assert(NOT has_function_privilege('authenticated','public.ai_usage_reserve(jsonb)','EXECUTE') AND NOT has_function_privilege('authenticated','public.ai_usage_dispatch(uuid,uuid)','EXECUTE'),'replaced RPCs retain service-only permissions');
END $$;
SELECT 'PASS: 25 optional-limit assertions, selective activation, 300k boundary, independent accounts and measured audio' AS result;
