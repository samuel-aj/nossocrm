-- =============================================================================
-- Robôs: gatilho "Mensagem recebida"
-- =============================================================================
-- O banco avisa o CRM (/api/wa-agents/ingest) a cada mensagem recebida que
-- interessa a um agente de IA ou a um robô. Muda:
-- 1) Novo caso: robô LIGADO com gatilho `message_received` no número da
--    conversa (um dos números do robô ou o número escolhido no gatilho). Nunca
--    em grupo.
-- 2) Robôs não dependem da liberação da beta dos agentes de IA (como no app):
--    o robô esperando resposta e o gatilho por mensagem valem em qualquer
--    organização. Os agentes de IA continuam exigindo a liberação.
-- O resto da função é igual à versão anterior. Idempotente; não mexe em dados.
-- Voltar atrás: reaplicar a função de 20260826150000_wa_ai_stopped_never_reopens.sql.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.wa_ai_agent_ingest()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE conv RECORD; should BOOLEAN := false;
BEGIN
  IF NEW.direction <> 'in' THEN RETURN NEW; END IF;

  SELECT id, connection_id, ai_agent_id, ai_status, COALESCE(is_group, false) AS is_group INTO conv
    FROM public.wa_conversations WHERE id = NEW.conversation_id;
  IF conv.id IS NULL THEN RETURN NEW; END IF;

  -- Agentes de IA (só com a beta liberada)
  IF public.wa_agents_beta_enabled(NEW.organization_id) THEN
    IF conv.ai_agent_id IS NOT NULL AND COALESCE(conv.ai_status, 'active') = 'active' THEN
      should := true;
    ELSIF conv.connection_id IS NOT NULL AND (
        conv.ai_status IS NULL
        OR (conv.ai_status = 'active' AND conv.ai_agent_id IS NULL)
      ) AND EXISTS (
      SELECT 1 FROM public.wa_ai_agents a
      WHERE a.organization_id = NEW.organization_id AND a.enabled = true AND conv.connection_id = ANY(a.connection_ids)
        AND COALESCE(a.triggers->'inbound'->>'mode', 'any') <> 'none'
        AND (conv.ai_status IS NULL OR a.triggers->'inbound'->>'mode' = 'keywords')
    ) THEN
      should := true;
    END IF;
  END IF;

  -- Robô esperando resposta nesta conversa
  IF NOT should AND EXISTS (
    SELECT 1 FROM public.wa_bot_runs r WHERE r.conversation_id = conv.id AND r.status = 'waiting_reply'
  ) THEN
    should := true;
  END IF;

  -- Robô com gatilho "Mensagem recebida" neste número (o app escolhe qual e aplica o filtro de palavras)
  IF NOT should AND NOT conv.is_group AND conv.connection_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.wa_bots b
    WHERE b.organization_id = NEW.organization_id AND b.enabled = true
      AND b.trigger->>'type' = 'message_received'
      AND (
        NULLIF(b.trigger->>'connection_id', '') = conv.connection_id::text
        OR (NULLIF(b.trigger->>'connection_id', '') IS NULL
            AND (conv.connection_id = ANY(COALESCE(b.connection_ids, '{}'::uuid[])) OR b.connection_id = conv.connection_id))
      )
  ) THEN
    should := true;
  END IF;

  IF should THEN
    PERFORM public.wa_agents_call_app(
      '/api/wa-agents/ingest',
      jsonb_build_object('organization_id', NEW.organization_id, 'conversation_id', NEW.conversation_id, 'message_id', NEW.id)
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'wa_ai_agent_ingest falhou: %', SQLERRM;
  RETURN NEW;
END;
$function$;
