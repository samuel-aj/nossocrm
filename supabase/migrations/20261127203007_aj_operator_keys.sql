-- A separate credential namespace keeps the public API and organization keys unchanged.
BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE TABLE public.aj_operator_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  key_prefix text NOT NULL,
  key_hash text UNIQUE NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  -- Preserve the creator and revoker identities even after their profiles are removed.
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid
);
ALTER TABLE public.aj_operator_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aj_operator_keys FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (id, name, key_prefix, created_by, created_at, last_used_at, revoked_at, revoked_by),
      INSERT (name, key_prefix, key_hash, created_by), UPDATE (revoked_at, revoked_by)
  ON public.aj_operator_keys TO service_role;

-- Retained by rollback: audit identities are immutable historical references, not cascading FKs.
CREATE TABLE IF NOT EXISTS public.aj_operator_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  key_id uuid NOT NULL,
  tool text NOT NULL,
  organization_id uuid,
  agent_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('allowed','denied')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aj_operator_audit_key_time ON public.aj_operator_audit(key_id,created_at DESC);
ALTER TABLE public.aj_operator_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aj_operator_audit FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.aj_operator_audit TO service_role;

CREATE FUNCTION public.aj_operator_authenticate(p_key_hash text) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.aj_operator_keys SET last_used_at = statement_timestamp()
  WHERE key_hash = p_key_hash AND revoked_at IS NULL RETURNING id;
$$;
REVOKE ALL ON FUNCTION public.aj_operator_authenticate(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aj_operator_authenticate(text) TO service_role;

-- First read must not materialize a prompt snapshot. Until the ordinary CRM has saved
-- a first version, present the existing agent text as version zero in memory.
CREATE FUNCTION crm_internal.aj_operator_versions(p_org uuid, p_agent uuid)
RETURNS TABLE(version integer, source text, change_summary text, external_ref text,
              created_at timestamptz, system_prompt text, stop_rules text)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT v.version,v.source,v.change_summary,v.external_ref,v.created_at,v.system_prompt,v.stop_rules
  FROM public.wa_ai_agent_prompt_versions v WHERE v.organization_id=p_org AND v.agent_id=p_agent
  UNION ALL
  SELECT 0,'original',NULL,NULL,NULL,a.system_prompt,a.stop_rules FROM public.wa_ai_agents a
  WHERE a.organization_id=p_org AND a.id=p_agent AND NOT EXISTS (
    SELECT 1 FROM public.wa_ai_agent_prompt_versions v WHERE v.organization_id=p_org AND v.agent_id=p_agent
  );
$$;
REVOKE ALL ON FUNCTION crm_internal.aj_operator_versions(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Mask phone-like sequences in text and transcribed speech, preserving plain ISO dates.
CREATE FUNCTION crm_internal.aj_operator_mask_text(p_text text) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = '' AS $$
DECLARE
  pattern constant text := '\+?\(?[0-9](?:[[:blank:]().  ‐‑‒–—―-]{0,4}[0-9]){7,14}';
  parts text[];
  matches text[];
  item text;
  result text;
BEGIN
  parts := regexp_split_to_array(p_text,pattern);
  SELECT array_agg(m[1]) INTO matches FROM regexp_matches(p_text,pattern,'g') m;
  IF matches IS NULL THEN RETURN p_text; END IF;
  result := parts[1];
  FOR i IN 1..cardinality(matches) LOOP
    item := matches[i];
    result := result || CASE WHEN item ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN item
      ELSE '••••' || right(regexp_replace(item,'[^0-9]','','g'),4) END || parts[i+1];
  END LOOP;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION crm_internal.aj_operator_mask_text(text) FROM PUBLIC, anon, authenticated, service_role;

-- STABLE gives all scope checks and payload reads below the same statement snapshot,
-- including conversation attribution, mixed-agent detection and each pagination call.
CREATE FUNCTION crm_internal.aj_operator_payload(p_tool text, p_args jsonb, p_org uuid, p_agent uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  page_size integer := coalesce((p_args->>'limit')::integer,30);
  after_id uuid := (p_args->>'afterId')::uuid;
  conv uuid := (p_args->>'conversationId')::uuid;
  since_at timestamptz := (p_args->>'from')::timestamptz;
  until_at timestamptz := (p_args->>'to')::timestamptz;
  result jsonb;
BEGIN
  IF page_size NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid page' USING ERRCODE='22023'; END IF;
  IF p_tool = 'crm.ai_agents.list' THEN
    WITH page AS (
      SELECT a.id,a.name,a.squad_monitoring,a.organization_id,o.name AS organization_name
      FROM public.wa_ai_agents a JOIN public.organizations o ON o.id=a.organization_id
      WHERE o.is_active AND o.deleted_at IS NULL AND (after_id IS NULL OR a.id>after_id) AND EXISTS (
        SELECT 1 FROM public.ai_feature_flags f WHERE f.organization_id=a.organization_id AND f.enabled
        AND f.key IN ('wa_ai_agents_approved','wa_agents_beta')
      )
      ORDER BY a.id LIMIT page_size+1
    ), shown AS (SELECT * FROM page ORDER BY id LIMIT page_size)
    SELECT jsonb_build_object('agents',coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb),
      'nextCursor',CASE WHEN (SELECT count(*) FROM page)>page_size THEN (SELECT id FROM shown ORDER BY id DESC LIMIT 1) END)
    INTO result FROM shown s;
    RETURN result;
  END IF;

  IF p_tool = 'crm.ai_agents.get' THEN
    SELECT jsonb_build_object('id',a.id,'name',a.name,'organization_id',a.organization_id,
      'squad_monitoring',a.squad_monitoring,'system_prompt',a.system_prompt,'stop_rules',a.stop_rules,
      'version',(SELECT max(v.version) FROM crm_internal.aj_operator_versions(p_org,p_agent) v))
    INTO result FROM public.wa_ai_agents a WHERE a.organization_id=p_org AND a.id=p_agent;
  ELSIF p_tool = 'crm.ai_agents.versions.get' THEN
    WITH versions AS (SELECT * FROM crm_internal.aj_operator_versions(p_org,p_agent))
    SELECT jsonb_build_object('currentVersion',(SELECT max(version) FROM versions),'revision',to_jsonb(v))
    INTO result FROM versions v WHERE v.version=(p_args->>'version')::integer;
  ELSIF p_tool = 'crm.ai_agents.versions.list' THEN
    WITH versions AS (SELECT version,source,change_summary,external_ref,created_at FROM crm_internal.aj_operator_versions(p_org,p_agent)),
    page AS (SELECT * FROM versions WHERE NOT (p_args ? 'beforeVersion') OR version<(p_args->>'beforeVersion')::integer
      ORDER BY version DESC LIMIT page_size+1),
    shown AS (SELECT * FROM page ORDER BY version DESC LIMIT page_size)
    SELECT jsonb_build_object('currentVersion',(SELECT max(version) FROM versions),
      'versions',coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.version DESC),'[]'::jsonb),
      'nextCursor',CASE WHEN (SELECT count(*) FROM page)>page_size THEN min(s.version) END)
    INTO result FROM shown s;
  ELSIF p_tool = 'crm.ai_agents.conversations' THEN
    IF since_at IS NULL OR until_at IS NULL OR until_at<=since_at OR until_at-since_at>interval '168 hours' THEN
      RAISE EXCEPTION 'invalid period' USING ERRCODE='22023';
    END IF;
    WITH page AS (
      SELECT r.conversation_id,max(r.created_at) AS last_run_at,
        count(*) FILTER (WHERE nullif(btrim(r.output_text),'') IS NOT NULL) AS response_count
      FROM public.wa_ai_agent_runs r JOIN public.wa_conversations c ON c.id=r.conversation_id AND c.organization_id=p_org
      -- Skipped runs can name a candidate even when that agent never handled this conversation.
      WHERE r.organization_id=p_org AND r.agent_id=p_agent AND r.trigger<>'test' AND r.status='ok'
        AND r.created_at>=since_at AND r.created_at<until_at AND (after_id IS NULL OR r.conversation_id>after_id)
        AND c.ai_agent_id=p_agent
        AND NOT EXISTS (SELECT 1 FROM public.wa_messages ext WHERE ext.organization_id=p_org
          AND ext.conversation_id=c.id AND ext.direction='out' AND ext.source='api')
        AND NOT EXISTS (SELECT 1 FROM public.wa_ai_agent_runs other WHERE other.organization_id=p_org
          AND other.conversation_id=c.id AND other.trigger<>'test' AND other.agent_id IS DISTINCT FROM p_agent)
      GROUP BY r.conversation_id ORDER BY r.conversation_id LIMIT page_size+1
    ), shown AS (
      SELECT p.*,c.ai_status,
        coalesce(c.ai_agent_id=p_agent AND c.ai_status IN ('paused','stopped') AND c.ai_paused_by IS NOT NULL
          AND c.ai_status_changed_at>=since_at AND c.ai_status_changed_at<until_at,false)
        OR EXISTS (SELECT 1 FROM crm_internal.wa_ai_agent_human_pauses h
          WHERE h.organization_id=p_org AND h.agent_id=p_agent AND h.conversation_id=p.conversation_id
          AND h.paused_at>=since_at AND h.paused_at<until_at) AS human_paused
      FROM page p JOIN public.wa_conversations c ON c.id=p.conversation_id AND c.organization_id=p_org
      ORDER BY p.conversation_id LIMIT page_size
    )
    SELECT jsonb_build_object('conversations',coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.conversation_id),'[]'::jsonb),
      'nextCursor',CASE WHEN (SELECT count(*) FROM page)>page_size THEN (SELECT conversation_id FROM shown ORDER BY conversation_id DESC LIMIT 1) END)
    INTO result FROM shown s;
  ELSIF p_tool = 'crm.ai_agents.transcript' THEN
    WITH owned AS (
      SELECT c.wa_phone FROM public.wa_conversations c WHERE c.organization_id=p_org AND c.id=conv
        AND c.ai_agent_id=p_agent
        AND NOT EXISTS (SELECT 1 FROM public.wa_messages ext WHERE ext.organization_id=p_org
          AND ext.conversation_id=c.id AND ext.direction='out' AND ext.source='api')
        AND EXISTS (SELECT 1 FROM public.wa_ai_agent_runs r WHERE r.organization_id=p_org
          AND r.conversation_id=conv AND r.trigger<>'test' AND r.status='ok' AND r.agent_id=p_agent)
        AND NOT EXISTS (SELECT 1 FROM public.wa_ai_agent_runs r WHERE r.organization_id=p_org
          AND r.conversation_id=conv AND r.trigger<>'test' AND r.agent_id IS DISTINCT FROM p_agent)
    ), page AS (
      SELECT m.id,m.created_at,m.direction,m.source,m.sent_by,m.media_type,m.transcription,m.body
      FROM public.wa_messages m WHERE EXISTS (SELECT 1 FROM owned) AND m.organization_id=p_org AND m.conversation_id=conv
        AND m.deleted_at IS NULL AND (NOT (p_args ? 'after') OR (m.created_at,m.id)>
          ((p_args#>>'{after,at}')::timestamptz,(p_args#>>'{after,id}')::uuid))
      ORDER BY m.created_at,m.id LIMIT page_size+1
    ), shown AS (
      SELECT id,created_at AS at,CASE WHEN direction='in' THEN 'lead' WHEN source='agent' THEN 'agent'
        WHEN source IN ('bot','api') THEN 'automation' WHEN source='crm' OR sent_by IS NOT NULL THEN 'person' ELSE 'unknown' END AS author,
        crm_internal.aj_operator_mask_text(CASE WHEN media_type='audio' THEN transcription WHEN media_type IS NOT NULL THEN NULL
          WHEN starts_with(body,E'👤 Contatos compartilhados:\n') OR (starts_with(body,'📍 ') AND strpos(body,'https://maps.google.com/?q=')>0)
          THEN NULL ELSE body END) AS text
      FROM page ORDER BY created_at,id LIMIT page_size
    )
    SELECT jsonb_build_object('conversationId',conv,'phone',CASE WHEN length(regexp_replace(wa_phone,'[^0-9]','','g'))>4
      THEN '••••'||right(regexp_replace(wa_phone,'[^0-9]','','g'),4) END,
      'messages',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.at,s.id) FROM shown s),'[]'::jsonb),
      'nextCursor',CASE WHEN (SELECT count(*) FROM page)>page_size THEN
        (SELECT jsonb_build_object('id',s.id,'at',s.at) FROM shown s ORDER BY s.at DESC,s.id DESC LIMIT 1) END)
    INTO result FROM owned;
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION crm_internal.aj_operator_payload(text,jsonb,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.aj_operator_read(p_key_id uuid, p_tool text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  call_id uuid := gen_random_uuid();
  target_org uuid;
  target_agent uuid;
  authorized boolean := false;
  reply jsonb;
  failure constant jsonb := '{"error":"Registro indisponível ou sem permissão.","code":"UNAVAILABLE"}';
BEGIN
  -- Serialize a read against revocation and against disabling the agent/organization.
  PERFORM k.id FROM public.aj_operator_keys k WHERE k.id=p_key_id AND k.revoked_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RETURN '{"error":"Chave inválida.","code":"AUTH_INVALID"}'::jsonb; END IF;
  IF p_tool IS NULL OR p_tool NOT IN ('crm.ai_agents.list','crm.ai_agents.get','crm.ai_agents.conversations',
      'crm.ai_agents.transcript','crm.ai_agents.versions.list','crm.ai_agents.versions.get') THEN
    INSERT INTO public.aj_operator_audit(request_id,key_id,tool,outcome) VALUES(call_id,p_key_id,'unknown','denied');
    RETURN '{"error":"Ferramenta indisponível.","code":"UNKNOWN_TOOL"}'::jsonb;
  END IF;

  BEGIN
    IF p_args IS NULL OR jsonb_typeof(p_args)<>'object' OR p_args ?| ARRAY['organizationId','organization_id'] THEN
      RAISE EXCEPTION 'invalid arguments' USING ERRCODE='22023';
    END IF;
    IF p_tool <> 'crm.ai_agents.list' THEN
      target_agent := (p_args->>'agentId')::uuid;
      SELECT a.organization_id,true INTO target_org,authorized FROM public.wa_ai_agents a
        JOIN public.organizations o ON o.id=a.organization_id AND o.is_active AND o.deleted_at IS NULL
        JOIN public.ai_feature_flags f ON f.organization_id=a.organization_id AND f.enabled
          AND f.key IN ('wa_ai_agents_approved','wa_agents_beta')
        WHERE a.id=target_agent AND a.squad_monitoring ORDER BY f.key LIMIT 1 FOR SHARE OF a,o,f;
      IF NOT FOUND THEN
        -- Private audit only. An opted-out or inactive agent produces the same public
        -- error as an unknown id and never reaches a content query.
        SELECT a.organization_id INTO target_org FROM public.wa_ai_agents a WHERE a.id=target_agent;
      END IF;
    END IF;
    IF p_tool='crm.ai_agents.list' OR authorized IS TRUE THEN
      reply := crm_internal.aj_operator_payload(p_tool,p_args,target_org,target_agent);
    END IF;
  EXCEPTION WHEN data_exception THEN
    INSERT INTO public.aj_operator_audit(request_id,key_id,tool,outcome) VALUES(call_id,p_key_id,p_tool,'denied');
    RETURN '{"error":"Parâmetros inválidos.","code":"INVALID_ARGUMENTS"}'::jsonb;
  END;

  IF p_tool='crm.ai_agents.list' AND jsonb_array_length(reply->'agents')>0 THEN
    INSERT INTO public.aj_operator_audit(request_id,key_id,tool,organization_id,outcome)
      SELECT DISTINCT call_id,p_key_id,p_tool,(a->>'organization_id')::uuid,'allowed'
      FROM jsonb_array_elements(reply->'agents') a;
  ELSE
    INSERT INTO public.aj_operator_audit(request_id,key_id,tool,organization_id,agent_id,outcome)
      VALUES(call_id,p_key_id,p_tool,target_org,target_agent,CASE WHEN reply IS NULL THEN 'denied' ELSE 'allowed' END);
  END IF;
  RETURN coalesce(reply,failure);
END;
$$;
REVOKE ALL ON FUNCTION public.aj_operator_read(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aj_operator_read(uuid,text,jsonb) TO service_role;
COMMIT;
