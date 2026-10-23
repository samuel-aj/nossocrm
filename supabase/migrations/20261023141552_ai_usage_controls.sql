-- Durable usage accounting. Additive schema; only an enforced block pauses AI.
-- Never changes message contents, contacts or deals.
-- Enforcement is explicitly opt-in. A persisted block can only be cleared by a grant.
CREATE SCHEMA IF NOT EXISTS ai_usage_internal;
REVOKE ALL ON SCHEMA ai_usage_internal FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA ai_usage_internal TO service_role;

CREATE TABLE public.ai_usage_policies (
  organization_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  conversation_tokens bigint CHECK (conversation_tokens>0),
  organization_daily_tokens bigint CHECK (organization_daily_tokens>0),
  conversation_audio_seconds numeric CHECK (conversation_audio_seconds>0),
  timezone text NOT NULL DEFAULT 'America/Manaus',
  measurement_started_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT enabled OR (conversation_tokens IS NOT NULL AND organization_daily_tokens IS NOT NULL))
);
-- Identifiers intentionally have no FK to operational records: deletion of a chat
-- or agent must never delete consumption or reopen the same identity's budget.
CREATE TABLE public.ai_usage_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  merged_into uuid REFERENCES public.ai_usage_accounts(id),
  blocked_at timestamptz, blocked_reason text, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (merged_into IS DISTINCT FROM id), UNIQUE(organization_id,id)
);
CREATE INDEX ai_usage_accounts_org ON public.ai_usage_accounts(organization_id);
CREATE TABLE public.ai_usage_identities (
  organization_id uuid NOT NULL, identity_key text NOT NULL, account_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,identity_key),
  FOREIGN KEY(organization_id,account_id) REFERENCES public.ai_usage_accounts(organization_id,id)
);
CREATE TABLE public.ai_usage_memberships (
  organization_id uuid NOT NULL, conversation_id uuid NOT NULL, account_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,conversation_id),
  FOREIGN KEY(organization_id,account_id) REFERENCES public.ai_usage_accounts(organization_id,id)
);
CREATE TABLE public.ai_usage_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, account_id uuid NOT NULL,
  actor_id uuid NOT NULL, reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 1000),
  tokens bigint NOT NULL DEFAULT 0 CHECK(tokens>=0), seconds numeric NOT NULL DEFAULT 0 CHECK(seconds>=0),
  idempotency_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(tokens>0 OR seconds>0), UNIQUE(organization_id,idempotency_key),
  FOREIGN KEY(organization_id,account_id) REFERENCES public.ai_usage_accounts(organization_id,id)
);
CREATE TABLE public.ai_usage_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, account_id uuid,
  conversation_id uuid, agent_id uuid, run_id text, deal_id uuid,
  scope text NOT NULL CHECK(scope IN ('conversation','test','configuration','knowledge','crm')),
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 250),
  operation text NOT NULL, provider text NOT NULL, model text NOT NULL,
  unit text NOT NULL CHECK(unit IN ('tokens','seconds')),
  reserved_amount numeric NOT NULL CHECK(reserved_amount>0 AND reserved_amount<1e15),
  actual_amount numeric CHECK(actual_amount>=0 AND actual_amount<1e15),
  status text NOT NULL CHECK(status IN ('reserved','dispatched','completed','unknown','cancelled','denied')),
  input_tokens bigint CHECK(input_tokens>=0), output_tokens bigint CHECK(output_tokens>=0),
  cached_input_tokens bigint CHECK(cached_input_tokens>=0), reasoning_tokens bigint CHECK(reasoning_tokens>=0),
  total_tokens bigint CHECK(total_tokens>=0), estimated_cost_usd numeric CHECK(estimated_cost_usd>=0),
  pricing_version text, metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), dispatched_at timestamptz, settled_at timestamptz,
  UNIQUE(organization_id,idempotency_key),
  FOREIGN KEY(organization_id,account_id) REFERENCES public.ai_usage_accounts(organization_id,id),
  CHECK(scope<>'conversation' OR (account_id IS NOT NULL AND conversation_id IS NOT NULL))
);
CREATE INDEX ai_usage_attempts_org_date ON public.ai_usage_attempts(organization_id,created_at);
CREATE INDEX ai_usage_attempts_account ON public.ai_usage_attempts(account_id,unit,status);
CREATE TABLE public.ai_usage_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, account_id uuid NOT NULL,
  conversation_id uuid, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
  FOREIGN KEY(organization_id,account_id) REFERENCES public.ai_usage_accounts(organization_id,id)
);
CREATE UNIQUE INDEX ai_usage_notices_active ON public.ai_usage_notices(account_id) WHERE resolved_at IS NULL;

CREATE FUNCTION ai_usage_internal.immutable_grant() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Usage grants are append-only'; END $$;
CREATE TRIGGER ai_usage_grants_immutable BEFORE UPDATE OR DELETE ON public.ai_usage_grants
FOR EACH ROW EXECUTE FUNCTION ai_usage_internal.immutable_grant();

CREATE FUNCTION ai_usage_internal.lock_org(p_org uuid) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org) THEN RAISE EXCEPTION 'Organization not found'; END IF;
  INSERT INTO public.ai_usage_policies(organization_id) VALUES(p_org) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM public.ai_usage_policies WHERE organization_id=p_org FOR UPDATE;
END $$;
CREATE FUNCTION ai_usage_internal.root(p_org uuid,p_account uuid) RETURNS uuid LANGUAGE sql STABLE SET search_path='' AS $$
  WITH RECURSIVE chain AS (
    SELECT id,merged_into FROM public.ai_usage_accounts WHERE id=p_account AND organization_id=p_org
    UNION ALL SELECT a.id,a.merged_into FROM public.ai_usage_accounts a JOIN chain c ON a.id=c.merged_into WHERE a.organization_id=p_org
  ) SELECT id FROM chain WHERE merged_into IS NULL LIMIT 1
$$;
CREATE FUNCTION ai_usage_internal.members(p_org uuid,p_account uuid) RETURNS SETOF uuid LANGUAGE sql STABLE SET search_path='' AS $$
  WITH RECURSIVE chain AS (
    SELECT id FROM public.ai_usage_accounts WHERE id=ai_usage_internal.root(p_org,p_account) AND organization_id=p_org
    UNION ALL SELECT a.id FROM public.ai_usage_accounts a JOIN chain c ON a.merged_into=c.id WHERE a.organization_id=p_org
  ) SELECT id FROM chain
$$;

CREATE FUNCTION public.ai_usage_policy_get(p_org uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce((SELECT to_jsonb(p) FROM public.ai_usage_policies p WHERE organization_id=p_org),
 jsonb_build_object('organization_id',p_org,'enabled',false,'conversation_tokens',NULL,'organization_daily_tokens',NULL,
 'conversation_audio_seconds',NULL,'timezone','America/Manaus','measurement_started_at',NULL,'created_at',NULL,'updated_at',NULL))
$$;
CREATE FUNCTION public.ai_usage_policy_set(p_org uuid,p_patch jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 PERFORM ai_usage_internal.lock_org(p_org);
 IF p_patch ? 'timezone' AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_patch->>'timezone') THEN RAISE EXCEPTION 'Invalid timezone'; END IF;
 UPDATE public.ai_usage_policies SET
  enabled=CASE WHEN p_patch?'enabled' THEN (p_patch->>'enabled')::boolean ELSE enabled END,
  conversation_tokens=CASE WHEN p_patch?'conversation_tokens' THEN (p_patch->>'conversation_tokens')::bigint ELSE conversation_tokens END,
  organization_daily_tokens=CASE WHEN p_patch?'organization_daily_tokens' THEN (p_patch->>'organization_daily_tokens')::bigint ELSE organization_daily_tokens END,
  conversation_audio_seconds=CASE WHEN p_patch?'conversation_audio_seconds' THEN (p_patch->>'conversation_audio_seconds')::numeric ELSE conversation_audio_seconds END,
  timezone=CASE WHEN p_patch?'timezone' THEN p_patch->>'timezone' ELSE timezone END, updated_at=now()
 WHERE organization_id=p_org;
 RETURN public.ai_usage_policy_get(p_org);
END $$;

CREATE FUNCTION public.ai_usage_context(p_org uuid,p_conversation uuid) RETURNS uuid LANGUAGE plpgsql SET search_path='' AS $$
DECLARE c record; identity text; account uuid; prior uuid; alias_account uuid; merge_from uuid;
BEGIN
 PERFORM ai_usage_internal.lock_org(p_org);
 SELECT v.*, (SELECT x.id FROM public.contacts x WHERE x.id=v.contact_id AND x.organization_id=p_org AND x.deleted_at IS NULL) verified_contact
 INTO c FROM public.wa_conversations v WHERE v.id=p_conversation AND v.organization_id=p_org;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found'; END IF;
 identity:=CASE WHEN c.is_group THEN 'group:'||c.id::text WHEN c.verified_contact IS NOT NULL THEN 'contact:'||c.verified_contact::text
   ELSE 'phone:'||c.wa_phone END;
 IF identity IS NULL OR identity='phone:' THEN RAISE EXCEPTION 'Missing conversation identity'; END IF;
 SELECT ai_usage_internal.root(p_org,m.account_id) INTO prior FROM public.ai_usage_memberships m WHERE m.organization_id=p_org AND m.conversation_id=p_conversation;
 SELECT ai_usage_internal.root(p_org,i.account_id) INTO account FROM public.ai_usage_identities i WHERE i.organization_id=p_org AND i.identity_key=identity;
 -- A freshly linked contact inherits an orphan phone identity's existing usage.
 IF NOT c.is_group THEN
   SELECT ai_usage_internal.root(p_org,i.account_id) INTO alias_account FROM public.ai_usage_identities i WHERE i.organization_id=p_org AND i.identity_key='phone:'||c.wa_phone;
   prior:=coalesce(prior,alias_account);
 END IF;
 IF account IS NULL THEN
   account:=prior;
   IF account IS NULL THEN INSERT INTO public.ai_usage_accounts(organization_id) VALUES(p_org) RETURNING id INTO account; END IF;
   INSERT INTO public.ai_usage_identities(organization_id,identity_key,account_id) VALUES(p_org,identity,account);
 END IF;
 FOREACH merge_from IN ARRAY ARRAY[prior,alias_account] LOOP
  merge_from:=ai_usage_internal.root(p_org,merge_from);
  IF merge_from IS NOT NULL AND merge_from<>account THEN
   UPDATE public.ai_usage_accounts target SET blocked_at=coalesce(target.blocked_at,old.blocked_at),
    blocked_reason=CASE WHEN target.blocked_at IS NULL THEN old.blocked_reason ELSE target.blocked_reason END
   FROM public.ai_usage_accounts old WHERE target.id=account AND old.id=merge_from;
   UPDATE public.ai_usage_accounts SET merged_into=account WHERE id=merge_from AND organization_id=p_org;
  END IF;
 END LOOP;
 IF NOT c.is_group THEN
  INSERT INTO public.ai_usage_identities(organization_id,identity_key,account_id) VALUES(p_org,'phone:'||c.wa_phone,account) ON CONFLICT DO NOTHING;
 END IF;
 INSERT INTO public.ai_usage_memberships(organization_id,conversation_id,account_id) VALUES(p_org,p_conversation,account) ON CONFLICT DO NOTHING;
 IF EXISTS(SELECT 1 FROM public.ai_usage_accounts WHERE id=account AND blocked_at IS NOT NULL) THEN
   PERFORM public.ai_usage_block(p_org,account,p_conversation,(SELECT blocked_reason FROM public.ai_usage_accounts WHERE id=account));
 END IF;
 RETURN account;
END $$;

CREATE FUNCTION public.ai_usage_budget(p_org uuid,p_conversation uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE account uuid; prior uuid; identity_account uuid; phone_account uuid; accounts uuid[]; c record; a record; totals record; grants record;
BEGIN
 SELECT ai_usage_internal.root(p_org,m.account_id) INTO prior FROM public.ai_usage_memberships m WHERE m.organization_id=p_org AND m.conversation_id=p_conversation;
 SELECT v.*,x.id verified_contact INTO c FROM public.wa_conversations v
 LEFT JOIN public.contacts x ON x.id=v.contact_id AND x.organization_id=p_org AND x.deleted_at IS NULL
 WHERE v.id=p_conversation AND v.organization_id=p_org;
 IF FOUND THEN
  SELECT ai_usage_internal.root(p_org,i.account_id) INTO identity_account FROM public.ai_usage_identities i
  WHERE i.organization_id=p_org AND i.identity_key=CASE WHEN c.is_group THEN 'group:'||c.id::text
   WHEN c.verified_contact IS NOT NULL THEN 'contact:'||c.verified_contact::text ELSE 'phone:'||c.wa_phone END;
  IF NOT c.is_group THEN
   SELECT ai_usage_internal.root(p_org,i.account_id) INTO phone_account FROM public.ai_usage_identities i WHERE i.organization_id=p_org AND i.identity_key='phone:'||c.wa_phone;
  END IF;
 END IF;
 -- Same candidates that context() will merge, without mutating a GET. An old
 -- phone/membership block wins even before a newly linked contact is resolved.
 account:=coalesce(identity_account,prior,phone_account);
 accounts:=ARRAY(SELECT DISTINCT id FROM unnest(ARRAY[identity_account,prior,phone_account]) AS ids(id) WHERE id IS NOT NULL);
 SELECT blocked_at,blocked_reason INTO a FROM public.ai_usage_accounts
 WHERE organization_id=p_org AND id=ANY(accounts) AND blocked_at IS NOT NULL ORDER BY blocked_at,id LIMIT 1;
 SELECT coalesce(sum(actual_amount) FILTER(WHERE unit='tokens' AND status='completed'),0) used_tokens,
  coalesce(sum(reserved_amount) FILTER(WHERE unit='tokens' AND status IN ('reserved','dispatched','unknown')),0) reserved_tokens,
  coalesce(sum(actual_amount) FILTER(WHERE unit='seconds' AND status='completed'),0) used_seconds,
  coalesce(sum(reserved_amount) FILTER(WHERE unit='seconds' AND status IN ('reserved','dispatched','unknown')),0) reserved_seconds
 INTO totals FROM public.ai_usage_attempts WHERE organization_id=p_org AND account_id IN(SELECT ai_usage_internal.members(p_org,roots.id) FROM unnest(accounts) AS roots(id));
 SELECT coalesce(sum(tokens),0) tokens,coalesce(sum(seconds),0) seconds INTO grants FROM public.ai_usage_grants
 WHERE organization_id=p_org AND account_id IN(SELECT ai_usage_internal.members(p_org,roots.id) FROM unnest(accounts) AS roots(id));
 RETURN jsonb_build_object('account_id',account,'blocked_at',a.blocked_at,'blocked_reason',a.blocked_reason,
  'tokens_used',totals.used_tokens,'tokens_reserved',totals.reserved_tokens,'tokens_granted',grants.tokens,
  'seconds_used',totals.used_seconds,'seconds_reserved',totals.reserved_seconds,'seconds_granted',grants.seconds,
  'policy',public.ai_usage_policy_get(p_org));
END $$;

CREATE FUNCTION public.ai_usage_block(p_org uuid,p_account uuid,p_conversation uuid,p_reason text) RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $$
DECLARE account uuid;
BEGIN
 PERFORM ai_usage_internal.lock_org(p_org);
 account:=ai_usage_internal.root(p_org,p_account);
 IF account IS NULL THEN RAISE EXCEPTION 'Usage account not found'; END IF;
 UPDATE public.ai_usage_accounts SET blocked_at=coalesce(blocked_at,now()),blocked_reason=coalesce(blocked_reason,left(p_reason,200)) WHERE id=account;
 INSERT INTO public.ai_usage_notices(organization_id,account_id,conversation_id,reason) VALUES(p_org,account,p_conversation,left(p_reason,200)) ON CONFLICT DO NOTHING;
 UPDATE public.wa_conversations SET ai_status='paused',ai_resume_at=NULL,ai_status_changed_at=now()
 WHERE organization_id=p_org AND id IN(SELECT m.conversation_id FROM public.ai_usage_memberships m
   WHERE m.organization_id=p_org AND m.account_id IN(SELECT ai_usage_internal.members(p_org,account)))
   AND ai_agent_id IS NOT NULL
   AND (ai_status='active' OR (ai_status='paused' AND ai_paused_by IS NULL));
 RETURN true;
END $$;

CREATE FUNCTION public.ai_usage_reserve(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
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
   IF account IS NOT NULL AND unit='seconds' AND p.conversation_audio_seconds IS NULL THEN reason:='audio_limit_not_configured';
   ELSIF account IS NOT NULL AND unit='seconds' AND (b->>'seconds_used')::numeric+(b->>'seconds_reserved')::numeric+amount > p.conversation_audio_seconds+(b->>'seconds_granted')::numeric THEN reason:='conversation_audio_limit'; END IF;
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

CREATE FUNCTION public.ai_usage_dispatch(p_org uuid,p_attempt uuid) RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $$
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
   IF a.unit='seconds' AND p.conversation_audio_seconds IS NULL THEN reason:=coalesce(reason,'audio_limit_not_configured');
   ELSIF a.unit='seconds' AND (b->>'seconds_used')::numeric+(b->>'seconds_reserved')::numeric > p.conversation_audio_seconds+(b->>'seconds_granted')::numeric THEN reason:=coalesce(reason,'conversation_audio_limit'); END IF;
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

CREATE FUNCTION public.ai_usage_settle(p_org uuid,p_attempt uuid,p_result jsonb) RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $$
DECLARE a public.ai_usage_attempts; target text:=p_result->>'status'; amount numeric:=(p_result->>'actualAmount')::numeric; enabled boolean;
BEGIN
 PERFORM ai_usage_internal.lock_org(p_org);
 SELECT * INTO a FROM public.ai_usage_attempts WHERE id=p_attempt AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Usage attempt not found'; END IF;
 IF a.status IN('completed','cancelled','denied') THEN RETURN false; END IF;
 IF target NOT IN('completed','unknown','cancelled') THEN RAISE EXCEPTION 'Invalid settlement state'; END IF;
 IF target='cancelled' AND a.status<>'reserved' THEN RAISE EXCEPTION 'Dispatched usage cannot be refunded as cancelled'; END IF;
 IF target='completed' AND (a.status NOT IN('dispatched','unknown') OR amount IS NULL OR amount<0 OR amount>=1e15) THEN RAISE EXCEPTION 'Actual provider usage required'; END IF;
 IF target='unknown' AND a.status NOT IN('dispatched','unknown') THEN RAISE EXCEPTION 'Only dispatched usage may be ambiguous'; END IF;
 UPDATE public.ai_usage_attempts SET status=target,actual_amount=CASE WHEN target='completed' THEN amount WHEN target='cancelled' THEN 0 ELSE NULL END,
 input_tokens=(p_result->>'inputTokens')::bigint,output_tokens=(p_result->>'outputTokens')::bigint,cached_input_tokens=(p_result->>'cachedInputTokens')::bigint,
 reasoning_tokens=(p_result->>'reasoningTokens')::bigint,total_tokens=(p_result->>'totalTokens')::bigint,
 estimated_cost_usd=(p_result->>'estimatedCostUsd')::numeric,pricing_version=p_result->>'pricingVersion',
 metadata=metadata||coalesce(p_result->'metadata','{}'),settled_at=CASE WHEN target='unknown' THEN NULL ELSE now() END WHERE id=p_attempt;
 SELECT p.enabled INTO enabled FROM public.ai_usage_policies p WHERE organization_id=p_org;
 IF a.account_id IS NOT NULL AND enabled AND (target='unknown' OR amount>a.reserved_amount) THEN
  PERFORM public.ai_usage_block(p_org,a.account_id,a.conversation_id,CASE WHEN target='unknown' THEN 'usage_unknown' ELSE 'usage_bound_exceeded' END);
 END IF;
 RETURN true;
END $$;

CREATE FUNCTION public.ai_usage_grant(p_input jsonb) RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $$
DECLARE org uuid:=(p_input->>'organization_id')::uuid; conv uuid:=(p_input->>'conversation_id')::uuid; actor uuid:=(p_input->>'actor_id')::uuid;
 account uuid; prior public.ai_usage_grants;
BEGIN
 PERFORM ai_usage_internal.lock_org(org);
 account:=public.ai_usage_context(org,conv);
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=actor AND organization_id=org)
  AND NOT EXISTS(SELECT 1 FROM public.user_organizations WHERE user_id=actor AND organization_id=org) THEN RAISE EXCEPTION 'Actor outside organization'; END IF;
 SELECT * INTO prior FROM public.ai_usage_grants WHERE organization_id=org AND idempotency_key=p_input->>'idempotency_key';
 IF FOUND THEN
  IF ai_usage_internal.root(org,prior.account_id)<>account OR prior.actor_id<>actor OR prior.tokens<>(p_input->>'tokens')::bigint
   OR prior.seconds<>coalesce((p_input->>'seconds')::numeric,0) OR prior.reason<>p_input->>'reason' THEN RAISE EXCEPTION 'Conflicting grant replay'; END IF;
  RETURN false;
 END IF;
 INSERT INTO public.ai_usage_grants(organization_id,account_id,actor_id,reason,tokens,seconds,idempotency_key)
 VALUES(org,account,actor,p_input->>'reason',(p_input->>'tokens')::bigint,coalesce((p_input->>'seconds')::numeric,0),p_input->>'idempotency_key');
 UPDATE public.ai_usage_accounts SET blocked_at=NULL,blocked_reason=NULL WHERE id=account;
 UPDATE public.ai_usage_notices SET resolved_at=now() WHERE organization_id=org AND account_id IN(SELECT ai_usage_internal.members(org,account)) AND resolved_at IS NULL;
 RETURN true;
END $$;

-- No browser writes. Only authenticated org administrators may read raw usage;
-- responsible-user views and grants use authorized API routes, never direct RPC.
DO $$ DECLARE name text; f record; BEGIN
 FOREACH name IN ARRAY ARRAY['ai_usage_policies','ai_usage_accounts','ai_usage_identities','ai_usage_memberships','ai_usage_grants','ai_usage_attempts','ai_usage_notices'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',name);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',name);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',name);
  EXECUTE format('CREATE POLICY usage_admin_read ON public.%I FOR SELECT TO authenticated USING (organization_id IN (SELECT public.user_admin_org_ids(auth.uid())))',name);
 END LOOP;
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE (n.nspname='public' AND p.proname LIKE 'ai_usage_%') OR n.nspname='ai_usage_internal' LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature);
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
END $$;
REVOKE UPDATE, DELETE, TRUNCATE ON public.ai_usage_grants FROM service_role;
REVOKE DELETE, TRUNCATE ON public.ai_usage_attempts FROM service_role;
