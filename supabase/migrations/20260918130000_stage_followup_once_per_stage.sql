-- =============================================================================
-- Follow-up por inatividade: UMA execução por etapa para cada lead
-- =============================================================================
-- Antes: cada resposta do lead rearmava a regra (um disparo por período de
-- silêncio). Agora: depois de executar numa etapa, aquele lead não recebe de novo
-- o follow-up daquela etapa, nem respondendo, nem saindo e voltando para ela.
-- Antes de executar nada muda: cada mensagem do lead reinicia a contagem.
-- Falha ou "não executado" não contam como execução (a próxima mensagem do lead
-- rearma). Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.deal_followup_fires (
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  fired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (deal_id, stage_id)
);
ALTER TABLE public.deal_followup_fires ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_followup_fires_select ON public.deal_followup_fires;
CREATE POLICY deal_followup_fires_select ON public.deal_followup_fires
  FOR SELECT USING (organization_id IN (SELECT public.user_org_ids(auth.uid())));

-- O que já executou até aqui conta
INSERT INTO public.deal_followup_fires (deal_id, stage_id, organization_id, fired_at)
SELECT deal_id, stage_id, organization_id, coalesce(fired_at, updated_at)
  FROM public.deal_followup_schedules
 WHERE status = 'done'
ON CONFLICT DO NOTHING;

-- Execução concluída: registra (é o banco que garante, qualquer que seja o caminho)
CREATE OR REPLACE FUNCTION crm_internal.followup_record_fire()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done' THEN
    INSERT INTO public.deal_followup_fires (deal_id, stage_id, organization_id, fired_at)
    VALUES (NEW.deal_id, NEW.stage_id, NEW.organization_id, coalesce(NEW.fired_at, now()))
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_followup_record_fire ON public.deal_followup_schedules;
CREATE TRIGGER trg_followup_record_fire
  AFTER UPDATE OF status ON public.deal_followup_schedules
  FOR EACH ROW EXECUTE FUNCTION crm_internal.followup_record_fire();

CREATE OR REPLACE FUNCTION crm_internal.followup_reschedule_deal(p_deal uuid, p_entered timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  d record;
  r record;
  s record;
  entered timestamptz;
  anchor timestamptz;
  last_in timestamptz;
BEGIN
  SELECT id, organization_id, stage_id, is_won, is_lost, deleted_at, created_at, last_stage_change_date
    INTO d FROM public.deals WHERE id = p_deal;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT * INTO s FROM public.deal_followup_schedules WHERE deal_id = p_deal;

  SELECT * INTO r FROM public.stage_followup_rules WHERE stage_id = d.stage_id AND enabled;
  IF d.deleted_at IS NOT NULL OR coalesce(d.is_won, false) OR coalesce(d.is_lost, false) OR r.stage_id IS NULL THEN
    UPDATE public.deal_followup_schedules
       SET status = 'cancelled', lock_until = NULL, updated_at = now()
     WHERE deal_id = p_deal AND status IN ('scheduled', 'processing');
    RETURN;
  END IF;

  -- UMA vez por etapa para cada lead: se já executou nesta etapa, nunca mais
  -- (nem se o lead responder, nem se sair e voltar para a etapa).
  IF EXISTS (SELECT 1 FROM public.deal_followup_fires f WHERE f.deal_id = p_deal AND f.stage_id = d.stage_id) THEN
    UPDATE public.deal_followup_schedules
       SET status = 'cancelled', lock_until = NULL, updated_at = now()
     WHERE deal_id = p_deal AND status IN ('scheduled', 'processing');
    RETURN;
  END IF;

  entered := p_entered;
  IF entered IS NULL AND s.deal_id IS NOT NULL AND s.stage_id = d.stage_id THEN
    entered := s.entered_at;
  END IF;
  IF entered IS NULL THEN
    SELECT max(occurred_at) INTO entered FROM public.deal_stage_events
     WHERE deal_id = p_deal AND to_stage_id = d.stage_id;
    entered := coalesce(entered, d.last_stage_change_date, d.created_at, now());
  END IF;

  last_in := crm_internal.followup_last_inbound(p_deal, entered);
  -- Contagem: entrada na etapa, última mensagem do lead depois dela, e nunca antes de a regra ser ligada
  anchor := greatest(entered, coalesce(last_in, entered), coalesce(r.activated_at, entered));


  INSERT INTO public.deal_followup_schedules
    (deal_id, organization_id, stage_id, rule_version, entered_at, anchor_at, due_at, status, lock_until, attempts, fired_at, last_result, updated_at)
  VALUES
    (p_deal, d.organization_id, d.stage_id, r.version, entered, anchor, anchor + make_interval(secs => r.delay_seconds),
     'scheduled', NULL, 0, NULL, NULL, now())
  ON CONFLICT (deal_id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    stage_id = EXCLUDED.stage_id,
    rule_version = EXCLUDED.rule_version,
    entered_at = EXCLUDED.entered_at,
    anchor_at = EXCLUDED.anchor_at,
    due_at = EXCLUDED.due_at,
    status = 'scheduled',
    lock_until = NULL,
    attempts = 0,
    -- nova entrada na etapa zera o "já disparou"; mesma entrada mantém o registro
    fired_at = CASE WHEN public.deal_followup_schedules.stage_id = EXCLUDED.stage_id
                     AND public.deal_followup_schedules.entered_at = EXCLUDED.entered_at
                    THEN public.deal_followup_schedules.fired_at END,
    updated_at = now();
END;
$$;

-- Mensagem RECEBIDA do lead: reinicia a contagem enquanto o follow-up da etapa
-- ainda não executou para ele.
CREATE OR REPLACE FUNCTION crm_internal.followup_on_inbound()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  c record;
BEGIN
  IF NEW.direction <> 'in' THEN
    RETURN NULL;
  END IF;
  SELECT id, organization_id, contact_id, deal_id, coalesce(is_group, false) AS is_group
    INTO c FROM public.wa_conversations WHERE id = NEW.conversation_id;
  IF NOT FOUND OR c.is_group THEN
    RETURN NULL;
  END IF;
  UPDATE public.deal_followup_schedules s
     SET anchor_at = NEW.created_at,
         due_at = NEW.created_at + make_interval(secs => r.delay_seconds),
         status = 'scheduled',
         lock_until = NULL,
         attempts = 0,
         updated_at = now()
    FROM public.deals d, public.stage_followup_rules r
   WHERE s.deal_id = d.id
     AND d.organization_id = c.organization_id
     AND (d.id = c.deal_id OR (c.contact_id IS NOT NULL AND d.contact_id = c.contact_id))
     AND d.deleted_at IS NULL AND NOT coalesce(d.is_won, false) AND NOT coalesce(d.is_lost, false)
     AND r.stage_id = d.stage_id AND r.enabled
     AND s.stage_id = d.stage_id
     AND s.status IN ('scheduled', 'processing', 'failed', 'skipped')
     AND NOT EXISTS (SELECT 1 FROM public.deal_followup_fires f WHERE f.deal_id = d.id AND f.stage_id = d.stage_id)
     AND s.anchor_at < NEW.created_at;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'followup_on_inbound falhou: %', SQLERRM;
  RETURN NULL;
END;
$$;
