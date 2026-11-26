-- A transação torna a troca dos validadores e a instalação dos gatilhos atômicas.
BEGIN;
-- Se tabelas em uso estiverem ocupadas, cancelar e tentar a migração de novo.
SET LOCAL lock_timeout = '3s';

ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS scopes text[]
  CHECK (scopes IS NULL OR (
    coalesce(array_ndims(scopes), 1) = 1 AND
    scopes <@ ARRAY['ai_agents:read', 'ai_agents:write_prompt']::text[] AND
    array_position(scopes, NULL) IS NULL
  ));
ALTER TABLE public.wa_ai_agents ADD COLUMN IF NOT EXISTS squad_monitoring boolean NOT NULL DEFAULT false;

-- Os consumidores REST antigos continuam usando validate_api_key e só aceitam acesso completo.
-- As duas entradas passam pela mesma validação e só atualizam last_used_at quando autorizadas.
CREATE OR REPLACE FUNCTION crm_internal.authenticate_integration_key(p_token text, p_mcp boolean)
RETURNS TABLE(api_key_id uuid, api_key_prefix text, organization_id uuid, organization_name text, scopes text[])
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH used AS (
    UPDATE public.api_keys k SET last_used_at = now(), updated_at = now()
    WHERE nullif(btrim(p_token), '') IS NOT NULL
      AND k.key_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
      AND k.revoked_at IS NULL AND (p_mcp OR k.scopes IS NULL)
    RETURNING k.id, k.key_prefix, k.organization_id, k.scopes
  )
  SELECT u.id, u.key_prefix, u.organization_id, o.name, u.scopes
  FROM used u JOIN public.organizations o ON o.id = u.organization_id;
$$;
REVOKE ALL ON FUNCTION crm_internal.authenticate_integration_key(text, boolean) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_api_key(p_token text)
RETURNS TABLE(api_key_id uuid, api_key_prefix text, organization_id uuid, organization_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT k.api_key_id, k.api_key_prefix, k.organization_id, k.organization_name
  FROM crm_internal.authenticate_integration_key(p_token, false) k;
$$;
CREATE OR REPLACE FUNCTION public.validate_mcp_api_key(p_token text)
RETURNS TABLE(api_key_id uuid, api_key_prefix text, organization_id uuid, organization_name text, scopes text[])
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT * FROM crm_internal.authenticate_integration_key(p_token, true);
$$;
REVOKE ALL ON FUNCTION public.validate_api_key(text), public.validate_mcp_api_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_api_key(text), public.validate_mcp_api_key(text) TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.wa_ai_agent_prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.wa_ai_agents(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 0),
  system_prompt text NOT NULL,
  stop_rules text NOT NULL,
  source text NOT NULL CHECK (source IN ('original', 'squad', 'manual', 'restore')),
  change_summary text,
  external_ref text,
  created_by_key uuid REFERENCES public.api_keys(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, version),
  CHECK ((version = 0) = (source = 'original')),
  CHECK (source NOT IN ('squad','restore') OR
    (nullif(btrim(change_summary), '') IS NOT NULL AND nullif(btrim(external_ref), '') IS NOT NULL))
);
ALTER TABLE public.wa_ai_agent_prompt_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wa_ai_agent_prompt_versions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.wa_ai_agent_prompt_versions TO service_role;

-- O app referencia sempre o agente na organização da chave. A FK de agent_id e a
-- exclusividade (agent_id, version) cobrem busca da última revisão e da versão exata.
CREATE OR REPLACE FUNCTION public.wa_ai_agent_prompt_snapshot(p_organization_id uuid, p_agent_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  current_version integer;
  agent record;
BEGIN
  -- Leituras posteriores à primeira revisão dispensam a trava de escrita.
  SELECT v.version INTO current_version FROM public.wa_ai_agents a
  JOIN public.wa_ai_agent_prompt_versions v ON v.agent_id = a.id AND v.organization_id = a.organization_id
  WHERE a.id = p_agent_id AND a.organization_id = p_organization_id AND a.squad_monitoring
  ORDER BY v.version DESC LIMIT 1;
  IF FOUND THEN RETURN current_version; END IF;

  SELECT organization_id,id,system_prompt,stop_rules INTO agent FROM public.wa_ai_agents
    WHERE id = p_agent_id AND organization_id = p_organization_id AND squad_monitoring FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agent unavailable' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.wa_ai_agent_prompt_versions (organization_id,agent_id,version,system_prompt,stop_rules,source)
    VALUES (agent.organization_id,agent.id,0,agent.system_prompt,agent.stop_rules,'original')
    ON CONFLICT (agent_id,version) DO NOTHING;
  SELECT max(v.version) INTO current_version FROM public.wa_ai_agent_prompt_versions v
    WHERE v.agent_id = agent.id AND v.organization_id = agent.organization_id;
  RETURN current_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.wa_ai_agent_prompt_snapshots(p_organization_id uuid, p_agent_ids uuid[])
RETURNS TABLE(agent_id uuid, version integer) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a record;
BEGIN
  IF cardinality(p_agent_ids) > 101 THEN RAISE EXCEPTION 'too many agents' USING ERRCODE = '22023'; END IF;
  -- Ordem consistente das travas na primeira leitura simultânea de páginas sobrepostas.
  FOR a IN SELECT w.id,w.squad_monitoring FROM public.wa_ai_agents w
           WHERE w.organization_id = p_organization_id AND w.id = ANY(p_agent_ids) ORDER BY w.id
  LOOP
    agent_id := a.id;
    IF a.squad_monitoring THEN
      BEGIN
        version := public.wa_ai_agent_prompt_snapshot(p_organization_id,a.id);
      EXCEPTION WHEN no_data_found THEN CONTINUE; END;
    ELSE
      SELECT coalesce(max(v.version),0) INTO version FROM public.wa_ai_agent_prompt_versions v
        WHERE v.organization_id = p_organization_id AND v.agent_id = a.id;
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- A atualização do próprio agente já serializa escritores. Mesmo edições pelo CRM
-- anteriores à primeira leitura do squad guardam o original e a primeira revisão.
CREATE OR REPLACE FUNCTION crm_internal.record_manual_prompt_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid;
BEGIN
  IF current_setting('crm.squad_prompt_agent',true) = NEW.id::text THEN RETURN NEW; END IF;
  IF current_setting('role',true) = 'service_role' THEN
    actor := (nullif(current_setting('request.headers',true),'')::jsonb ->> 'x-crm-prompt-editor')::uuid;
  ELSE
    actor := auth.uid();
  END IF;
  INSERT INTO public.wa_ai_agent_prompt_versions (organization_id,agent_id,version,system_prompt,stop_rules,source)
    VALUES (OLD.organization_id,OLD.id,0,OLD.system_prompt,OLD.stop_rules,'original')
    ON CONFLICT (agent_id,version) DO NOTHING;
  INSERT INTO public.wa_ai_agent_prompt_versions (organization_id,agent_id,version,system_prompt,stop_rules,source,created_by)
    SELECT NEW.organization_id, NEW.id, max(v.version)+1, NEW.system_prompt, NEW.stop_rules, 'manual', actor
    FROM public.wa_ai_agent_prompt_versions v WHERE v.agent_id = NEW.id AND v.organization_id = NEW.organization_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION crm_internal.record_manual_prompt_version() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS wa_ai_agent_manual_prompt_version ON public.wa_ai_agents;
CREATE TRIGGER wa_ai_agent_manual_prompt_version AFTER UPDATE OF system_prompt,stop_rules ON public.wa_ai_agents
  FOR EACH ROW WHEN (OLD.system_prompt IS DISTINCT FROM NEW.system_prompt OR OLD.stop_rules IS DISTINCT FROM NEW.stop_rules)
  EXECUTE FUNCTION crm_internal.record_manual_prompt_version();

CREATE OR REPLACE FUNCTION public.wa_ai_agent_prompt_change(
  p_organization_id uuid, p_agent_id uuid, p_key_id uuid, p_expected_version integer,
  p_change_summary text, p_external_ref text, p_system_prompt text DEFAULT NULL,
  p_stop_rules text DEFAULT NULL, p_restore_version integer DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  active_version integer;
  prompt_text text;
  rules_text text;
  previous_guard text := current_setting('crm.squad_prompt_agent',true);
BEGIN
  IF p_expected_version IS NULL OR p_expected_version < 0 OR
     nullif(btrim(p_change_summary),'') IS NULL OR length(p_change_summary) > 2000 OR
     nullif(btrim(p_external_ref),'') IS NULL OR length(p_external_ref) > 500 OR
     length(p_system_prompt) > 60000 OR length(p_stop_rules) > 4000 OR
     ((p_system_prompt IS NOT NULL OR p_stop_rules IS NOT NULL) = (p_restore_version IS NOT NULL)) THEN
    RAISE EXCEPTION 'invalid revision' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.api_keys k WHERE k.id = p_key_id AND k.organization_id = p_organization_id
    AND k.revoked_at IS NULL AND (k.scopes IS NULL OR 'ai_agents:write_prompt' = ANY(k.scopes)) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'key unavailable' USING ERRCODE = '42501'; END IF;
  SELECT a.system_prompt,a.stop_rules INTO prompt_text,rules_text FROM public.wa_ai_agents a
    WHERE a.organization_id = p_organization_id AND a.id = p_agent_id AND a.squad_monitoring FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agent unavailable' USING ERRCODE = 'P0002'; END IF;
  active_version := public.wa_ai_agent_prompt_snapshot(p_organization_id,p_agent_id);
  IF active_version <> p_expected_version THEN RAISE EXCEPTION 'version conflict' USING ERRCODE = '40001'; END IF;
  IF p_restore_version IS NULL THEN
    prompt_text := coalesce(p_system_prompt,prompt_text);
    rules_text := coalesce(p_stop_rules,rules_text);
  ELSE
    SELECT v.system_prompt,v.stop_rules INTO prompt_text,rules_text FROM public.wa_ai_agent_prompt_versions v
      WHERE v.organization_id = p_organization_id AND v.agent_id = p_agent_id AND v.version = p_restore_version;
    IF NOT FOUND THEN RAISE EXCEPTION 'revision unavailable' USING ERRCODE = 'P0002'; END IF;
  END IF;
  PERFORM set_config('crm.squad_prompt_agent',p_agent_id::text,true);
  UPDATE public.wa_ai_agents SET system_prompt = prompt_text, stop_rules = rules_text, updated_at = now()
    WHERE id = p_agent_id AND organization_id = p_organization_id;
  PERFORM set_config('crm.squad_prompt_agent',coalesce(previous_guard,''),true);
  INSERT INTO public.wa_ai_agent_prompt_versions (
    organization_id,agent_id,version,system_prompt,stop_rules,source,change_summary,external_ref,created_by_key)
    VALUES (p_organization_id,p_agent_id,active_version+1,prompt_text,rules_text,
      CASE WHEN p_restore_version IS NULL THEN 'squad' ELSE 'restore' END,btrim(p_change_summary),btrim(p_external_ref),p_key_id);
  RETURN active_version+1;
END;
$$;

-- O CRM limpa ai_paused_by quando uma pessoa retoma o atendimento. Registra apenas
-- transições confirmadas de agentes monitorados para não perder a pausa no relatório.
CREATE TABLE IF NOT EXISTS crm_internal.wa_ai_agent_human_pauses (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.wa_ai_agents(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.wa_conversations(id) ON DELETE CASCADE,
  paused_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_ai_agent_human_pauses_lookup
  ON crm_internal.wa_ai_agent_human_pauses (organization_id,agent_id,conversation_id,paused_at);
ALTER TABLE crm_internal.wa_ai_agent_human_pauses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_internal.wa_ai_agent_human_pauses FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION crm_internal.record_monitored_human_pause()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO crm_internal.wa_ai_agent_human_pauses(organization_id,agent_id,conversation_id,paused_at)
    SELECT a.organization_id,a.id,NEW.id,coalesce(NEW.ai_status_changed_at,now())
    FROM public.wa_ai_agents a WHERE a.id = NEW.ai_agent_id AND a.organization_id = NEW.organization_id AND a.squad_monitoring;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION crm_internal.record_monitored_human_pause() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS wa_ai_monitored_human_pause ON public.wa_conversations;
CREATE TRIGGER wa_ai_monitored_human_pause AFTER UPDATE OF ai_status,ai_paused_by ON public.wa_conversations
  FOR EACH ROW WHEN (NEW.ai_agent_id IS NOT NULL AND NEW.ai_status IN ('paused','stopped') AND NEW.ai_paused_by IS NOT NULL
    AND (NEW.ai_status IS DISTINCT FROM OLD.ai_status OR NEW.ai_paused_by IS DISTINCT FROM OLD.ai_paused_by))
  EXECUTE FUNCTION crm_internal.record_monitored_human_pause();

CREATE OR REPLACE FUNCTION public.wa_ai_agent_conversations(
  p_organization_id uuid,p_agent_id uuid,p_from timestamptz,p_to timestamptz,p_after_id uuid DEFAULT NULL,p_limit integer DEFAULT 30
) RETURNS TABLE(conversation_id uuid,last_run_at timestamptz,response_count bigint,ai_status text,human_paused boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from >= p_to OR p_to-p_from > interval '168 hours' OR
    p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 101 THEN RAISE EXCEPTION 'invalid period or page' USING ERRCODE = '22023'; END IF;
  PERFORM public.wa_ai_agent_prompt_snapshot(p_organization_id,p_agent_id);
  RETURN QUERY
    WITH page AS (
      SELECT r.conversation_id, max(r.created_at) AS latest,
        count(*) FILTER (WHERE r.status = 'ok' AND nullif(btrim(r.output_text),'') IS NOT NULL) AS responses
      FROM public.wa_ai_agent_runs r
      JOIN public.wa_conversations owned ON owned.id = r.conversation_id AND owned.organization_id = p_organization_id
      WHERE r.organization_id = p_organization_id AND r.agent_id = p_agent_id AND r.trigger <> 'test'
        AND r.created_at >= p_from AND r.created_at < p_to AND (p_after_id IS NULL OR r.conversation_id > p_after_id)
      GROUP BY r.conversation_id ORDER BY r.conversation_id LIMIT p_limit
    )
    SELECT p.conversation_id, p.latest, p.responses, c.ai_status,
      coalesce(c.ai_agent_id = p_agent_id AND c.ai_status IN ('paused','stopped') AND c.ai_paused_by IS NOT NULL
        AND c.ai_status_changed_at >= p_from AND c.ai_status_changed_at < p_to, false)
      OR EXISTS (SELECT 1 FROM crm_internal.wa_ai_agent_human_pauses h WHERE h.agent_id = p_agent_id
        AND h.organization_id = p_organization_id AND h.conversation_id = c.id AND h.paused_at >= p_from AND h.paused_at < p_to)
    FROM page p JOIN public.wa_conversations c ON c.id = p.conversation_id AND c.organization_id = p_organization_id
    ORDER BY p.conversation_id;
END;
$$;
REVOKE ALL ON FUNCTION public.wa_ai_agent_prompt_snapshot(uuid,uuid), public.wa_ai_agent_prompt_snapshots(uuid,uuid[]),
  public.wa_ai_agent_prompt_change(uuid,uuid,uuid,integer,text,text,text,text,integer),
  public.wa_ai_agent_conversations(uuid,uuid,timestamptz,timestamptz,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_ai_agent_prompt_snapshot(uuid,uuid), public.wa_ai_agent_prompt_snapshots(uuid,uuid[]),
  public.wa_ai_agent_prompt_change(uuid,uuid,uuid,integer,text,text,text,text,integer),
  public.wa_ai_agent_conversations(uuid,uuid,timestamptz,timestamptz,uuid,integer) TO service_role;
COMMIT;
