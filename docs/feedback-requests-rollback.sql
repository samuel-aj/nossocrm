-- Desfaz a caixa de ajustes (migrações 20261128120000, ...120100 e ...120200).
-- Ordem: volte o CÓDIGO primeiro (a versão antiga não usa nada disto), depois rode este arquivo.
-- Apaga os pedidos, anexos registrados e mensagens. Os arquivos do bucket feedback-anexos
-- NÃO são apagados por aqui: limpe pelo painel do Supabase se for o caso.
BEGIN;
SET LOCAL lock_timeout = '3s';

DROP FUNCTION IF EXISTS public.aj_operator_feedback(uuid,text,jsonb);
DROP FUNCTION IF EXISTS public.aj_operator_authenticate_scoped(text);
-- Volta a aj_operator_read original de 20261127203007_aj_operator_keys.sql (sem a condição de escopo).
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
UPDATE public.aj_operator_keys SET revoked_at = now() WHERE scope = 'feedback' AND revoked_at IS NULL;
ALTER TABLE public.aj_operator_keys DROP COLUMN IF EXISTS scope;

DELETE FROM public.crm_notification_events WHERE kind = 'feedback';
ALTER TABLE public.crm_notification_events DROP CONSTRAINT crm_notification_events_kind_check;
ALTER TABLE public.crm_notification_events ADD CONSTRAINT crm_notification_events_kind_check
  CHECK (kind IN ('message','lead','alert','audio_transcription','human_handoff','wa_entry_recovery')) NOT VALID;

DROP TABLE IF EXISTS public.feedback_messages;
DROP TABLE IF EXISTS public.feedback_attachments;
DROP TABLE IF EXISTS public.feedback_requests;
DROP FUNCTION IF EXISTS private.touch_feedback_request();
COMMIT;

-- Valida as linhas antigas fora da transação acima, sem bloquear novos avisos.
BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER TABLE public.crm_notification_events VALIDATE CONSTRAINT crm_notification_events_kind_check;
COMMIT;
