-- Use depois de voltar o código. Para um rollback temporário, basta voltar o código:
-- o validador legado do banco continua recusando as chaves do squad.
-- Para remover o esquema, exporte antes o histórico de versões/pausas que deseja guardar.
-- Este arquivo apaga esses históricos, desativa as autorizações do squad e preserva
-- o prompt e as regras que estão em uso em cada agente. Reative por meio de NOVAS chaves.
BEGIN;
LOCK TABLE public.api_keys IN SHARE ROW EXCLUSIVE MODE;
UPDATE public.api_keys SET revoked_at = now(), updated_at = now() WHERE scopes IS NOT NULL AND revoked_at IS NULL;

DROP TRIGGER IF EXISTS wa_ai_monitored_human_pause ON public.wa_conversations;
DROP TRIGGER IF EXISTS wa_ai_agent_manual_prompt_version ON public.wa_ai_agents;
DROP FUNCTION IF EXISTS crm_internal.record_monitored_human_pause(), crm_internal.record_manual_prompt_version();
DROP FUNCTION IF EXISTS public.wa_ai_agent_conversations(uuid,uuid,timestamptz,timestamptz,uuid,integer);
DROP FUNCTION IF EXISTS public.wa_ai_agent_prompt_change(uuid,uuid,uuid,integer,text,text,text,text,integer);
DROP FUNCTION IF EXISTS public.wa_ai_agent_prompt_snapshots(uuid,uuid[]), public.wa_ai_agent_prompt_snapshot(uuid,uuid);
DROP TABLE IF EXISTS crm_internal.wa_ai_agent_human_pauses,public.wa_ai_agent_prompt_versions;

CREATE OR REPLACE FUNCTION public.validate_api_key(p_token text)
RETURNS TABLE(api_key_id uuid, api_key_prefix text, organization_id uuid, organization_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH used AS (
    UPDATE public.api_keys k SET last_used_at = now(), updated_at = now()
    WHERE nullif(btrim(p_token),'') IS NOT NULL
      AND k.key_hash = encode(sha256(convert_to(p_token,'UTF8')),'hex') AND k.revoked_at IS NULL
    RETURNING k.id,k.key_prefix,k.organization_id
  )
  SELECT u.id,u.key_prefix,u.organization_id,o.name FROM used u JOIN public.organizations o ON o.id = u.organization_id;
$$;
DROP FUNCTION IF EXISTS public.validate_mcp_api_key(text),crm_internal.authenticate_integration_key(text,boolean);
ALTER TABLE public.api_keys DROP COLUMN scopes;
ALTER TABLE public.wa_ai_agents DROP COLUMN squad_monitoring;
COMMIT;
