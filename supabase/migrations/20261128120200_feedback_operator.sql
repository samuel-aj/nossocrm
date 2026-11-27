-- Escopo da chave de operador: a chave do Monitor lê agentes; a chave da esteira lê
-- e atualiza só o status dos pedidos de ajuste.
BEGIN;
SET LOCAL lock_timeout = '3s';

ALTER TABLE public.aj_operator_keys ADD COLUMN scope text NOT NULL DEFAULT 'ai_agents_read'
  CHECK (scope IN ('ai_agents_read','feedback'));
GRANT SELECT (scope), INSERT (scope) ON public.aj_operator_keys TO service_role;

CREATE FUNCTION public.aj_operator_authenticate_scoped(p_key_hash text)
RETURNS TABLE(id uuid, scope text) LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.aj_operator_keys SET last_used_at = statement_timestamp()
  WHERE key_hash = p_key_hash AND revoked_at IS NULL RETURNING id, scope;
$$;
REVOKE ALL ON FUNCTION public.aj_operator_authenticate_scoped(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aj_operator_authenticate_scoped(text) TO service_role;

-- Mesmo corpo de 20261127203007_aj_operator_keys.sql; única mudança: a chave precisa ser de leitura de agentes.
CREATE OR REPLACE FUNCTION public.aj_operator_read(p_key_id uuid, p_tool text, p_args jsonb)
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
  PERFORM k.id FROM public.aj_operator_keys k WHERE k.id=p_key_id AND k.revoked_at IS NULL
    AND k.scope='ai_agents_read' FOR SHARE;
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

CREATE FUNCTION public.aj_operator_feedback(p_key_id uuid, p_tool text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  call_id uuid := gen_random_uuid();
  req public.feedback_requests;
  page_size integer;
  new_status text;
  reply jsonb;
  invalid constant jsonb := '{"error":"Argumentos inválidos.","code":"INVALID_ARGS"}';
  missing constant jsonb := '{"error":"Pedido não encontrado.","code":"NOT_FOUND"}';
BEGIN
  PERFORM 1 FROM public.aj_operator_keys k
    WHERE k.id = p_key_id AND k.revoked_at IS NULL AND k.scope = 'feedback' FOR SHARE;
  IF NOT FOUND THEN RETURN '{"error":"Chave inválida.","code":"AUTH_INVALID"}'::jsonb; END IF;
  IF p_tool IS NULL OR p_tool NOT IN ('crm.feedback.list','crm.feedback.get','crm.feedback.update') THEN
    INSERT INTO public.aj_operator_audit(request_id,key_id,tool,outcome) VALUES(call_id,p_key_id,'unknown','denied');
    RETURN '{"error":"Ferramenta indisponível.","code":"UNKNOWN_TOOL"}'::jsonb;
  END IF;
  IF p_args IS NULL OR jsonb_typeof(p_args) <> 'object' THEN RETURN invalid; END IF;

  BEGIN
    IF p_tool = 'crm.feedback.list' THEN
      page_size := coalesce((p_args->>'limit')::integer, 20);
      IF page_size NOT BETWEEN 1 AND 50 THEN RETURN invalid; END IF;
      WITH page AS (
        SELECT r.id, r.organization_id, o.name AS organization_name, r.kind, r.status, r.origin,
               r.paperclip_issue_id, r.created_at, r.updated_at
        FROM public.feedback_requests r JOIN public.organizations o ON o.id = r.organization_id
        WHERE r.status = coalesce(p_args->>'status', 'recebido')
          AND (p_args->>'afterCreatedAt' IS NULL OR r.created_at > (p_args->>'afterCreatedAt')::timestamptz)
        ORDER BY r.created_at, r.id LIMIT page_size
      )
      SELECT jsonb_build_object('requests', coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.created_at, p.id), '[]'::jsonb))
        INTO reply FROM page p;
      INSERT INTO public.aj_operator_audit(request_id,key_id,tool,outcome) VALUES(call_id,p_key_id,p_tool,'allowed');
      RETURN reply;
    END IF;

    SELECT * INTO req FROM public.feedback_requests WHERE id = (p_args->>'requestId')::uuid
      FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.aj_operator_audit(request_id,key_id,tool,outcome) VALUES(call_id,p_key_id,p_tool,'denied');
      RETURN missing;
    END IF;

    IF p_tool = 'crm.feedback.get' THEN
      reply := jsonb_build_object(
        'request', to_jsonb(req) || jsonb_build_object(
          'organization_name', (SELECT o.name FROM public.organizations o WHERE o.id = req.organization_id),
          'author_name', (SELECT coalesce(nullif(p.nickname,''),
              nullif(btrim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), ''), 'Usuário')
            FROM public.profiles p WHERE p.id = req.author_id)),
        'attachments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'kind',a.kind,'mime',a.mime,
            'size_bytes',a.size_bytes,'storage_path',a.storage_path) ORDER BY a.created_at), '[]'::jsonb)
          FROM public.feedback_attachments a WHERE a.request_id = req.id),
        'messages', (SELECT coalesce(jsonb_agg(jsonb_build_object('author_kind',m.author_kind,'body',m.body,
            'created_at',m.created_at) ORDER BY m.created_at), '[]'::jsonb)
          FROM public.feedback_messages m WHERE m.request_id = req.id));
    ELSE
      new_status := p_args->>'status';
      UPDATE public.feedback_requests SET
        status = coalesce(new_status, status),
        priority_label = CASE WHEN p_args ? 'priorityLabel' THEN p_args->>'priorityLabel' ELSE priority_label END,
        public_reply = CASE WHEN p_args ? 'publicReply' THEN p_args->>'publicReply' ELSE public_reply END,
        tutorial_url = CASE WHEN p_args ? 'tutorialUrl' THEN p_args->>'tutorialUrl' ELSE tutorial_url END,
        paperclip_issue_id = CASE WHEN p_args ? 'paperclipIssueId' THEN p_args->>'paperclipIssueId' ELSE paperclip_issue_id END
      WHERE id = req.id;
      IF length(btrim(coalesce(p_args->>'message', ''))) > 0 THEN
        INSERT INTO public.feedback_messages(request_id, organization_id, author_kind, body)
        VALUES (req.id, req.organization_id, 'agent', left(p_args->>'message', 4000));
      END IF;
      IF new_status IS NOT NULL AND new_status <> req.status THEN
        INSERT INTO public.crm_notification_events(organization_id, kind, source_id)
        VALUES (req.organization_id, 'feedback', req.id);
      END IF;
      reply := jsonb_build_object('ok', true, 'status', coalesce(new_status, req.status));
    END IF;
    INSERT INTO public.aj_operator_audit(request_id,key_id,tool,organization_id,outcome)
      VALUES(call_id,p_key_id,p_tool,req.organization_id,'allowed');
    RETURN reply;
  EXCEPTION WHEN check_violation OR invalid_text_representation OR invalid_datetime_format
      OR numeric_value_out_of_range OR datetime_field_overflow THEN
    RETURN invalid;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.aj_operator_feedback(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aj_operator_feedback(uuid,text,jsonb) TO service_role;
COMMIT;
