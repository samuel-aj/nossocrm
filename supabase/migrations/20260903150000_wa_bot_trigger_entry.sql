-- Automações da etapa: o gatilho "entrou na etapa" do robô pode distinguir
-- COMO o negócio entrou (trigger->>'entry'): 'created' = criado direto na
-- etapa (INSERT), 'moved' = movido para ela (UPDATE de stage_id), ausente ou
-- 'any' = os dois (comportamento anterior). Só muda a função do trigger.
CREATE OR REPLACE FUNCTION public.wa_bot_on_deal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b RECORD; a RECORD; created INTEGER := 0;
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.organization_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN RETURN NEW; END IF;
  IF NOT public.wa_agents_beta_enabled(NEW.organization_id) THEN RETURN NEW; END IF;

  -- Robôs
  FOR b IN
    SELECT id FROM public.wa_bots
    WHERE organization_id = NEW.organization_id AND enabled = true AND (
      (TG_OP = 'INSERT' AND trigger->>'type' = 'deal_created'
        AND (NULLIF(trigger->>'board_id', '') IS NULL OR (trigger->>'board_id')::uuid = NEW.board_id))
      OR (trigger->>'type' = 'deal_stage_entered' AND NULLIF(trigger->>'stage_id', '') IS NOT NULL
        AND (trigger->>'stage_id')::uuid = NEW.stage_id
        AND (
          COALESCE(NULLIF(trigger->>'entry', ''), 'any') = 'any'
          OR (trigger->>'entry' = 'created' AND TG_OP = 'INSERT')
          OR (trigger->>'entry' = 'moved' AND TG_OP = 'UPDATE')
        ))
    )
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.wa_bot_runs r
      WHERE r.bot_id = b.id AND r.deal_id = NEW.id AND r.status IN ('running', 'waiting_reply')
    ) THEN
      INSERT INTO public.wa_bot_runs (organization_id, bot_id, deal_id, contact_id, status, wake_at)
      VALUES (NEW.organization_id, b.id, NEW.id, NEW.contact_id, 'running', now());
      created := created + 1;
    END IF;
  END LOOP;

  -- Agentes de IA com gatilho de pipeline
  FOR a IN
    SELECT id FROM public.wa_ai_agents
    WHERE organization_id = NEW.organization_id AND enabled = true
      AND (triggers->'deal'->>'enabled') = 'true' AND (
        (TG_OP = 'INSERT' AND (triggers->'deal'->>'event') = 'deal_created'
          AND (NULLIF(triggers->'deal'->>'board_id', '') IS NULL OR (triggers->'deal'->>'board_id')::uuid = NEW.board_id))
        OR ((triggers->'deal'->>'event') = 'deal_stage_entered' AND NULLIF(triggers->'deal'->>'stage_id', '') IS NOT NULL
          AND (triggers->'deal'->>'stage_id')::uuid = NEW.stage_id)
      )
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.wa_ai_agent_deal_starts s
      WHERE s.agent_id = a.id AND s.deal_id = NEW.id AND s.status IN ('pending', 'processing')
    ) THEN
      INSERT INTO public.wa_ai_agent_deal_starts (organization_id, agent_id, deal_id, contact_id)
      VALUES (NEW.organization_id, a.id, NEW.id, NEW.contact_id);
      created := created + 1;
    END IF;
  END LOOP;

  IF created > 0 THEN
    PERFORM public.wa_agents_call_app('/api/wa-agents/tick', jsonb_build_object('organization_id', NEW.organization_id));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'wa_bot_on_deal falhou: %', SQLERRM;
  RETURN NEW;
END;
$$;
