-- =============================================================================
-- Agentes de IA (beta): ações durante a conversa, gatilhos (mensagem/pipeline)
-- e robô em modo quadro (navegação por ids). Tudo aditivo.
-- =============================================================================

ALTER TABLE public.wa_ai_agents
  -- ações que o agente executa DURANTE a conversa: [{ key, label, description, actions: [...] }]
  ADD COLUMN IF NOT EXISTS custom_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- gatilhos: por mensagem recebida (any | keywords | none) e por cadastro no pipeline
  ADD COLUMN IF NOT EXISTS triggers JSONB NOT NULL DEFAULT
    '{"inbound":{"mode":"any","keywords":[]},"deal":{"enabled":false,"event":"deal_created","board_id":null,"stage_id":null,"connection_id":null}}'::jsonb;

-- robô em modo quadro: primeiro passo; passos ligados por next_step_id/goto/else/on_timeout
ALTER TABLE public.wa_bots ADD COLUMN IF NOT EXISTS start_step_id TEXT;

-- fila de inícios de agente disparados pelo pipeline (negócio criado / entrou na etapa)
CREATE TABLE IF NOT EXISTS public.wa_ai_agent_deal_starts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.wa_ai_agents(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'error', 'cancelled')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS wa_ai_agent_deal_starts_pending_idx ON public.wa_ai_agent_deal_starts(created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS wa_ai_agent_deal_starts_org_idx ON public.wa_ai_agent_deal_starts(organization_id, created_at DESC);
ALTER TABLE public.wa_ai_agent_deal_starts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wa_ai_agent_deal_starts admin select" ON public.wa_ai_agent_deal_starts;
CREATE POLICY "wa_ai_agent_deal_starts admin select" ON public.wa_ai_agent_deal_starts
  FOR SELECT USING (organization_id IN (SELECT public.user_admin_org_ids(auth.uid())));

-- Negócio criado / entrou numa etapa -> robôs (como antes) E agentes com gatilho de pipeline
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
        AND (trigger->>'stage_id')::uuid = NEW.stage_id)
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
DROP TRIGGER IF EXISTS trg_wa_bot_on_deal ON public.deals;
CREATE TRIGGER trg_wa_bot_on_deal AFTER INSERT OR UPDATE OF stage_id ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.wa_bot_on_deal();

-- Relógio: também acorda quando há início por pipeline pendente
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'wa-agents-tick';
  PERFORM cron.schedule(
    'wa-agents-tick',
    '30 seconds',
    $cron$
      SELECT public.wa_agents_call_app('/api/wa-agents/tick', '{}'::jsonb)
      WHERE EXISTS (SELECT 1 FROM public.ai_feature_flags WHERE key = 'wa_agents_beta' AND enabled = true)
        AND (
          EXISTS (SELECT 1 FROM public.wa_bot_runs WHERE status = 'running' AND wake_at IS NOT NULL AND wake_at <= now())
          OR EXISTS (SELECT 1 FROM public.wa_bot_runs WHERE status = 'waiting_reply' AND wake_at IS NOT NULL AND wake_at <= now())
          OR EXISTS (SELECT 1 FROM public.wa_conversations WHERE ai_status = 'paused' AND ai_resume_at IS NOT NULL AND ai_resume_at <= now())
          OR EXISTS (SELECT 1 FROM public.wa_ai_agent_deal_starts WHERE status = 'pending')
        )
    $cron$
  );
END $$;
