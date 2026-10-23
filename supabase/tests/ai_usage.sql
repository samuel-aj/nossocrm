INSERT INTO public.organizations VALUES(usage_test.id(1)),(usage_test.id(2));
INSERT INTO public.contacts VALUES(usage_test.id(10),usage_test.id(1),NULL),(usage_test.id(11),usage_test.id(1),NULL),(usage_test.id(20),usage_test.id(2),NULL);
INSERT INTO public.profiles VALUES(usage_test.id(100),usage_test.id(1)),(usage_test.id(200),usage_test.id(2));
INSERT INTO public.deals VALUES(usage_test.id(901),usage_test.id(1)),(usage_test.id(902),usage_test.id(2));
INSERT INTO public.wa_messages VALUES(usage_test.id(903),usage_test.id(1),usage_test.id(101),'Synthetic existing message'),(usage_test.id(904),usage_test.id(1),usage_test.id(103),'Synthetic orphan history');
CREATE TABLE usage_test.retention AS SELECT
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.contacts t) contacts,
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.deals t) deals,
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.wa_messages t) messages;
INSERT INTO public.wa_conversations(id,organization_id,contact_id,wa_phone,is_group) VALUES
 (usage_test.id(101),usage_test.id(1),usage_test.id(10),'551111',false),
 (usage_test.id(102),usage_test.id(1),usage_test.id(10),'552222',false),
 (usage_test.id(103),usage_test.id(1),NULL,'553333',false),
 (usage_test.id(104),usage_test.id(1),usage_test.id(11),'554444',false),
 (usage_test.id(105),usage_test.id(1),NULL,'group-a',true),
 (usage_test.id(106),usage_test.id(1),NULL,'group-a',true),
 (usage_test.id(201),usage_test.id(2),usage_test.id(20),'551111',false);
CREATE FUNCTION usage_test.reserve(conv int,key text,amount numeric,unit text DEFAULT 'tokens') RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.ai_usage_reserve(jsonb_build_object('organization_id',usage_test.id(CASE WHEN conv>200 THEN 2 ELSE 1 END),'conversation_id',usage_test.id(conv),
 'account_id',public.ai_usage_context(usage_test.id(CASE WHEN conv>200 THEN 2 ELSE 1 END),usage_test.id(conv)),
 'scope','conversation','idempotency_key',key,'operation','reply','provider','fixture','model','fixture-model','unit',unit,'reserved_amount',amount,'metadata','{"enforcementChecked":true}'::jsonb))
$$;
DO $$ DECLARE org uuid:=usage_test.id(1); a uuid; b uuid; r jsonb; id uuid; before_count int; data jsonb; err boolean; BEGIN
 PERFORM usage_test.assert((public.ai_usage_policy_get(org)->>'enabled')::boolean=false,'default measurement-only');
 a:=public.ai_usage_context(org,usage_test.id(101)); b:=public.ai_usage_context(org,usage_test.id(102));
 PERFORM usage_test.assert(a=b,'same contact across different numbers shares account');
 PERFORM usage_test.assert(public.ai_usage_context(usage_test.id(2),usage_test.id(201))<>a,'organization isolated');
 PERFORM usage_test.assert(public.ai_usage_context(org,usage_test.id(105))<>public.ai_usage_context(org,usage_test.id(106)),'groups stay independent');
 r:=usage_test.reserve(101,'unlimited',120); id:=(r->>'attempt_id')::uuid;
 PERFORM usage_test.assert((r->>'allowed')::boolean,'measurement-only still reserves and measures');
 PERFORM usage_test.assert(public.ai_usage_dispatch(org,id),'first dispatch allowed');
 PERFORM usage_test.assert(NOT public.ai_usage_dispatch(org,id),'duplicate dispatch denied');
 PERFORM public.ai_usage_settle(org,id,'{"status":"completed","actualAmount":80,"inputTokens":60,"outputTokens":20,"totalTokens":80}');
 PERFORM usage_test.assert(NOT (usage_test.reserve(101,'unlimited',120)->>'allowed')::boolean,'replay never authorizes provider');
 PERFORM usage_test.assert(NOT public.ai_usage_settle(org,id,'{"status":"completed","actualAmount":1}'),'settlement idempotent');
 PERFORM public.ai_usage_policy_set(org,'{"enabled":true,"conversation_tokens":100,"organization_daily_tokens":500,"conversation_audio_seconds":60}');
 r:=usage_test.reserve(102,'pending',15); id:=(r->>'attempt_id')::uuid;
 PERFORM usage_test.assert((r->>'allowed')::boolean,'remaining quota reserves');
 PERFORM usage_test.assert(NOT (usage_test.reserve(101,'over-concurrent',10)->>'allowed')::boolean,'pending reservations prevent overspend');
 PERFORM usage_test.assert((public.ai_usage_budget(org,usage_test.id(102))->>'blocked_at') IS NOT NULL,'alias sees block');
 PERFORM usage_test.assert((SELECT bool_and(c.ai_status='paused' AND c.ai_resume_at IS NULL) FROM public.wa_conversations c WHERE c.id IN(usage_test.id(101),usage_test.id(102))),'block pauses both aliases');
 PERFORM usage_test.assert(NOT public.ai_usage_dispatch(org,id),'block cancels not-yet-dispatched attempt');
 PERFORM public.ai_usage_policy_set(org,'{"enabled":false}');
 PERFORM usage_test.assert(NOT (usage_test.reserve(101,'disabled-blocked',1)->>'allowed')::boolean,'disabling policy cannot remove block');
 PERFORM public.ai_usage_grant(jsonb_build_object('organization_id',org,'conversation_id',usage_test.id(101),'actor_id',usage_test.id(100),'reason','Review completed','tokens',100,'idempotency_key','grant-1'));
 PERFORM usage_test.assert((public.ai_usage_budget(org,usage_test.id(101))->>'tokens_used')::int=80,'grant preserves history');
 PERFORM usage_test.assert((SELECT c.ai_status FROM public.wa_conversations c WHERE c.id=usage_test.id(101))='paused','grant never resumes automatically');
 PERFORM usage_test.assert(NOT public.ai_usage_grant(jsonb_build_object('organization_id',org,'conversation_id',usage_test.id(101),'actor_id',usage_test.id(100),'reason','Review completed','tokens',100,'idempotency_key','grant-1')),'grant idempotent');
 PERFORM public.ai_usage_policy_set(org,'{"enabled":true}');
 r:=usage_test.reserve(101,'unknown',50); id:=(r->>'attempt_id')::uuid; PERFORM public.ai_usage_dispatch(org,id);
 PERFORM public.ai_usage_settle(org,id,'{"status":"unknown"}');
 data:=public.ai_usage_budget(org,usage_test.id(101));
 PERFORM usage_test.assert(data->>'blocked_reason'='usage_unknown' AND (data->>'tokens_reserved')::int=50,'timeout holds reserve and blocks');
 err:=false; BEGIN PERFORM public.ai_usage_settle(org,id,'{"status":"cancelled"}'); EXCEPTION WHEN OTHERS THEN err:=true; END;
 PERFORM usage_test.assert(err,'cannot refund ambiguous dispatch');
 PERFORM public.ai_usage_settle(org,id,'{"status":"completed","actualAmount":20,"totalTokens":20}');
 PERFORM usage_test.assert(public.ai_usage_budget(org,usage_test.id(101))->>'blocked_at' IS NOT NULL,'late usage does not silently unblock');
 PERFORM usage_test.assert((public.ai_usage_budget(org,usage_test.id(101))->>'tokens_used')::int=100,'late usage reconciles once');
 -- Two independent accounts, then verified contact association: accumulate both, never reset.
 a:=public.ai_usage_context(org,usage_test.id(103)); b:=public.ai_usage_context(org,usage_test.id(104));
 r:=usage_test.reserve(103,'orphan',30); id:=(r->>'attempt_id')::uuid; PERFORM public.ai_usage_dispatch(org,id); PERFORM public.ai_usage_settle(org,id,'{"status":"completed","actualAmount":30}');
 r:=usage_test.reserve(104,'contact',40); id:=(r->>'attempt_id')::uuid; PERFORM public.ai_usage_dispatch(org,id); PERFORM public.ai_usage_settle(org,id,'{"status":"completed","actualAmount":40}');
 PERFORM public.ai_usage_block(org,a,usage_test.id(103),'manual-test');
 UPDATE public.wa_conversations c SET contact_id=usage_test.id(11) WHERE c.id=usage_test.id(103);
 PERFORM usage_test.assert(public.ai_usage_context(org,usage_test.id(103))=b,'orphan joins canonical contact account');
 data:=public.ai_usage_budget(org,usage_test.id(104));
 PERFORM usage_test.assert((data->>'tokens_used')::int=70 AND data->>'blocked_at' IS NOT NULL,'merge preserves sum and prior block');
 DELETE FROM public.wa_conversations c WHERE c.id=usage_test.id(103);
 PERFORM usage_test.assert((public.ai_usage_budget(org,usage_test.id(104))->>'tokens_used')::int=70,'deleting chat cannot delete consumption');
 err:=false; BEGIN UPDATE public.ai_usage_grants SET tokens=0; EXCEPTION WHEN OTHERS THEN err:=true; END;
 PERFORM usage_test.assert(err,'grant history immutable');
 err:=false; BEGIN PERFORM public.ai_usage_context(org,usage_test.id(201)); EXCEPTION WHEN OTHERS THEN err:=true; END;
 PERFORM usage_test.assert(err,'cross-org conversation refused');
 err:=false; BEGIN PERFORM public.ai_usage_grant(jsonb_build_object('organization_id',org,'conversation_id',usage_test.id(101),'actor_id',usage_test.id(200),'reason','Wrong actor','tokens',100,'idempotency_key','foreign')); EXCEPTION WHEN OTHERS THEN err:=true; END;
 PERFORM usage_test.assert(err,'cross-org actor refused');
 PERFORM usage_test.assert(NOT has_function_privilege('authenticated','public.ai_usage_reserve(jsonb)','EXECUTE'),'browser cannot reserve');
 PERFORM usage_test.assert(NOT has_table_privilege('authenticated','public.ai_usage_attempts','INSERT'),'browser cannot write ledger');
 PERFORM usage_test.assert(has_function_privilege('service_role','public.ai_usage_reserve(jsonb)','EXECUTE'),'service may reserve');
 INSERT INTO usage_test.results VALUES('PASS: 30 isolated usage-budget assertions');
END $$;
DO $$ DECLARE org uuid:=usage_test.id(1); r jsonb; attempt uuid; data jsonb; n int; err boolean; BEGIN
 r:=usage_test.reserve(105,'audio-a',10,'seconds'); attempt:=(r->>'attempt_id')::uuid;
 PERFORM usage_test.assert((r->>'allowed')::boolean,'audio uses independent configured unit');
 PERFORM public.ai_usage_dispatch(org,attempt); PERFORM public.ai_usage_settle(org,attempt,'{"status":"completed","actualAmount":4}');
 data:=public.ai_usage_budget(org,usage_test.id(105));
 PERFORM usage_test.assert((data->>'seconds_used')::int=4 AND (data->>'tokens_used')::int=0,'audio is not counted as zero-cost tokens');
 PERFORM usage_test.assert(NOT (usage_test.reserve(105,'audio-b',57,'seconds')->>'allowed')::boolean,'audio reservation enforces remaining seconds');
 PERFORM public.ai_usage_policy_set(org,'{"conversation_audio_seconds":null}');
 PERFORM usage_test.assert((usage_test.reserve(106,'unconfigured-audio',1,'seconds')->>'allowed')::boolean,'audio without optional quota remains measured and available');
 PERFORM public.ai_usage_policy_set(usage_test.id(2),'{"enabled":true,"conversation_tokens":100,"organization_daily_tokens":60}');
 r:=usage_test.reserve(201,'org-used',50); attempt:=(r->>'attempt_id')::uuid;
 PERFORM public.ai_usage_dispatch(usage_test.id(2),attempt); PERFORM public.ai_usage_settle(usage_test.id(2),attempt,'{"status":"completed","actualAmount":40}');
 r:=public.ai_usage_reserve(jsonb_build_object('organization_id',usage_test.id(2),'scope','configuration','idempotency_key','config-reserved',
   'operation','assist','provider','fixture','model','fixture','unit','tokens','reserved_amount',20,'metadata','{"enforcementChecked":true}'::jsonb));
 PERFORM usage_test.assert((r->>'allowed')::boolean,'configuration usage reserves organization quota');
 PERFORM usage_test.assert(usage_test.reserve(201,'daily-denied',1)->>'reason'='organization_daily_token_limit','org budget includes usage outside conversations');
 INSERT INTO public.wa_conversations(id,organization_id,contact_id,wa_phone) VALUES(usage_test.id(107),org,usage_test.id(10),'551111');
 SELECT count(*) INTO n FROM public.ai_usage_memberships;
 data:=public.ai_usage_budget(org,usage_test.id(107));
 PERFORM usage_test.assert(data->>'blocked_at' IS NOT NULL,'new channel reads existing canonical block');
 PERFORM usage_test.assert(n=(SELECT count(*) FROM public.ai_usage_memberships),'budget read never creates memberships');
 UPDATE public.wa_conversations c SET contact_id=NULL WHERE c.id=usage_test.id(107);
 PERFORM usage_test.assert(public.ai_usage_context(org,usage_test.id(107))=(public.ai_usage_budget(org,usage_test.id(101))->>'account_id')::uuid,'unlinked same phone retains canonical budget');
 -- Existing human/approval/external state must not be overwritten by usage blocks.
 INSERT INTO public.wa_conversations(id,organization_id,contact_id,wa_phone,ai_status,ai_paused_by,ai_resume_at,ai_agent_id) VALUES
 (usage_test.id(111),org,usage_test.id(10),'human','paused',usage_test.id(100),'2030-01-01',usage_test.id(999)),
 (usage_test.id(112),org,usage_test.id(10),'approval','awaiting_approval',NULL,NULL,usage_test.id(999)),
 (usage_test.id(113),org,usage_test.id(10),'stopped','stopped',NULL,NULL,usage_test.id(999)),
 (usage_test.id(114),org,usage_test.id(10),'external','active',NULL,NULL,NULL);
 PERFORM public.ai_usage_context(org,usage_test.id(111)); PERFORM public.ai_usage_context(org,usage_test.id(112));
 PERFORM public.ai_usage_context(org,usage_test.id(113)); PERFORM public.ai_usage_context(org,usage_test.id(114));
 PERFORM usage_test.assert((SELECT c.ai_resume_at='2030-01-01'::timestamptz AND c.ai_paused_by=usage_test.id(100) FROM public.wa_conversations c WHERE c.id=usage_test.id(111)),'human pause remains unchanged');
 PERFORM usage_test.assert((SELECT c.ai_status='awaiting_approval' FROM public.wa_conversations c WHERE c.id=usage_test.id(112)),'approval preserved');
 PERFORM usage_test.assert((SELECT c.ai_status='stopped' FROM public.wa_conversations c WHERE c.id=usage_test.id(113)),'human stop preserved');
 PERFORM usage_test.assert((SELECT c.ai_status='active' FROM public.wa_conversations c WHERE c.id=usage_test.id(114)),'external agent state preserved');
 err:=false; BEGIN PERFORM public.ai_usage_policy_set(org,'{"timezone":"invalid/zone"}'); EXCEPTION WHEN OTHERS THEN err:=true; END;
 PERFORM usage_test.assert(err,'invalid timezone refused');
 PERFORM usage_test.assert(NOT has_table_privilege('service_role','public.ai_usage_grants','TRUNCATE'),'grants cannot be truncated by service role');
 PERFORM usage_test.assert(NOT has_table_privilege('service_role','public.ai_usage_attempts','DELETE') AND NOT has_table_privilege('service_role','public.ai_usage_attempts','TRUNCATE'),'attempt history cannot be removed by service role');
 PERFORM usage_test.assert((SELECT contacts=(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.contacts t) FROM usage_test.retention),'contacts unchanged by all usage operations');
 PERFORM usage_test.assert((SELECT deals=(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.deals t) FROM usage_test.retention),'cards unchanged by all usage operations');
 PERFORM usage_test.assert((SELECT messages=(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.wa_messages t) FROM usage_test.retention),'message contents and associations unchanged by usage and relinking');
END $$;
DO $$ DECLARE org uuid:=usage_test.id(3); conv uuid:=usage_test.id(301); input jsonb; r jsonb; attempt uuid; err boolean; BEGIN
 INSERT INTO public.organizations VALUES(org);
 INSERT INTO public.profiles VALUES(usage_test.id(300),org);
 INSERT INTO public.wa_conversations(id,organization_id,wa_phone) VALUES(conv,org,'race-fixture');
 input:=jsonb_build_object('organization_id',org,'conversation_id',conv,'account_id',public.ai_usage_context(org,conv),
  'scope','conversation','idempotency_key','before-enabling','operation','reply','provider','fixture','model','unverified','unit','tokens','reserved_amount',40,'metadata','{"enforcementChecked":false}'::jsonb);
 r:=public.ai_usage_reserve(input); attempt:=(r->>'attempt_id')::uuid;
 PERFORM usage_test.assert((r->>'allowed')::boolean,'measurement-only attempt may reserve before activation');
 err:=false; BEGIN PERFORM public.ai_usage_policy_set(org,'{"enabled":true,"organization_daily_tokens":500}'); EXCEPTION WHEN OTHERS THEN err:=true; END;
 PERFORM usage_test.assert(err,'activation requires a conversation quota even through direct RPC');
 PERFORM public.ai_usage_policy_set(org,'{"enabled":true,"conversation_tokens":100,"organization_daily_tokens":500}');
 PERFORM usage_test.assert(NOT public.ai_usage_dispatch(org,attempt),'activation between reserve and dispatch rejects unchecked provider');
 PERFORM usage_test.assert(public.ai_usage_budget(org,conv)->>'blocked_reason'='enforcement_not_checked','activation race persists a block');
 PERFORM public.ai_usage_grant(jsonb_build_object('organization_id',org,'conversation_id',conv,'actor_id',usage_test.id(300),'reason','Review model','tokens',1,'idempotency_key','review-race-1'));
 r:=public.ai_usage_reserve(input||'{"idempotency_key":"stale-context"}');
 PERFORM usage_test.assert(r->>'reason'='enforcement_not_checked' AND NOT(r->>'allowed')::boolean,'activation before reserve rejects stale context');
 PERFORM public.ai_usage_grant(jsonb_build_object('organization_id',org,'conversation_id',conv,'actor_id',usage_test.id(300),'reason','Review quota','tokens',1,'idempotency_key','review-race-2'));
 r:=public.ai_usage_reserve(input||'{"idempotency_key":"lower-policy","metadata":{"enforcementChecked":true}}'); attempt:=(r->>'attempt_id')::uuid;
 PERFORM public.ai_usage_policy_set(org,'{"conversation_tokens":30}');
 PERFORM usage_test.assert(NOT public.ai_usage_dispatch(org,attempt),'lowered quota between reserve and dispatch is enforced');
 PERFORM usage_test.assert((SELECT status='cancelled' AND actual_amount=0 FROM public.ai_usage_attempts WHERE id=attempt),'undispatched denied attempt releases only its reservation');
END $$;
DO $$ DECLARE org uuid:=usage_test.id(1); data jsonb; clean uuid; prior_count int; BEGIN
 INSERT INTO public.contacts VALUES(usage_test.id(12),org,NULL);
 INSERT INTO public.wa_conversations(id,organization_id,contact_id,wa_phone) VALUES
  (usage_test.id(115),org,usage_test.id(12),'clean-contact'),
  (usage_test.id(116),org,usage_test.id(12),'553333'),
  (usage_test.id(117),org,NULL,'clean-membership');
 clean:=public.ai_usage_context(org,usage_test.id(115));
 PERFORM public.ai_usage_context(org,usage_test.id(117));
 SELECT count(*) INTO prior_count FROM public.ai_usage_memberships;
 data:=public.ai_usage_budget(org,usage_test.id(116));
 PERFORM usage_test.assert(data->>'blocked_at' IS NOT NULL AND (data->>'tokens_used')::int=70,'read guard includes blocked historical phone before new-contact merge');
 PERFORM usage_test.assert((data->>'account_id')::uuid=clean,'read guard returns the future canonical root while respecting alias block');
 PERFORM usage_test.assert(prior_count=(SELECT count(*) FROM public.ai_usage_memberships),'union guard remains readonly');
 UPDATE public.wa_conversations SET contact_id=usage_test.id(10) WHERE id=usage_test.id(117);
 data:=public.ai_usage_budget(org,usage_test.id(117));
 PERFORM usage_test.assert(data->>'blocked_at' IS NOT NULL AND (data->>'tokens_used')::int=100,'read guard includes blocked contact before existing-membership merge');
 PERFORM public.ai_usage_context(org,usage_test.id(116));
 PERFORM usage_test.assert((public.ai_usage_budget(org,usage_test.id(116))->>'tokens_used')::int=70,'resolved aliases do not double-count the readonly union');
END $$;
DO $$ DECLARE org uuid:=usage_test.id(4); conv uuid:=usage_test.id(401); account uuid; blocked text; BEGIN
 INSERT INTO public.organizations VALUES(org);
 INSERT INTO public.wa_conversations(id,organization_id,wa_phone) VALUES(conv,org,'measurement-only-fixture');
 account:=public.ai_usage_context(org,conv);
 PERFORM usage_test.assert(NOT public.ai_usage_block(org,account,conv,'usage_unknown'),'measurement-only failure cannot create durable block');
 PERFORM usage_test.assert(public.ai_usage_budget(org,conv)->>'blocked_at' IS NULL AND
  NOT EXISTS(SELECT 1 FROM public.ai_usage_notices WHERE organization_id=org) AND
  (SELECT ai_status='active' FROM public.wa_conversations WHERE id=conv),'measurement-only block has no notice or state side effects');
 PERFORM public.ai_usage_policy_set(org,'{"enabled":true,"conversation_tokens":100,"organization_daily_tokens":500}');
 PERFORM usage_test.assert(public.ai_usage_block(org,account,conv,'conversation_token_limit'),'enabled policy creates durable block');
 blocked:=public.ai_usage_budget(org,conv)->>'blocked_at';
 PERFORM public.ai_usage_policy_set(org,'{"enabled":false}');
 PERFORM public.ai_usage_block(org,account,conv,'usage_unknown');
 PERFORM usage_test.assert(public.ai_usage_budget(org,conv)->>'blocked_at'=blocked AND
  public.ai_usage_budget(org,conv)->>'blocked_reason'='conversation_token_limit','disabling policy preserves a pre-existing block');
END $$;
GRANT USAGE ON SCHEMA usage_test TO service_role,authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA usage_test TO service_role,authenticated;
SET ROLE authenticated;
SELECT usage_test.assert((SELECT count(*) FROM public.ai_usage_attempts)=0,'RLS hides foreign/nonadmin usage');
RESET ROLE;
SET ROLE service_role;
SELECT usage_test.assert((public.ai_usage_policy_get(usage_test.id(2))->>'enabled')::boolean,'invoker service functions work without owner privileges');
SELECT usage_test.assert(public.ai_usage_context(usage_test.id(2),usage_test.id(201)) IS NOT NULL,'service resolves accounts and native pause');
RESET ROLE;
SELECT 'PASS: usage controls, immutable grants, identity merges, unit quotas, organization budget, native state and role permissions' AS result;
