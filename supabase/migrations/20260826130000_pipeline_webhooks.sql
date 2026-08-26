-- Automações do pipeline (webhooks): várias regras por organização, cada uma
-- com sua própria URL e segredo, disparadas quando um lead é CRIADO numa etapa
-- ou MUDA de etapa (ex.: avisar o n8n/Make para montar automações externas).
--
-- Reaproveita a tabela integration_outbound_endpoints:
--   kind = 'followup' -> endpoint único do "Follow-up (Webhook)" (comportamento atual, sem filtro)
--   kind = 'pipeline' -> regra do pipeline com filtros de quadro / etapa de origem / etapa de destino
-- Filtro NULL = "qualquer". Os endpoints antigos ficam com tudo NULL, então nada muda pra eles.
--
-- Mesmo modelo de sempre: evento em webhook_events_out + entrega em webhook_deliveries
-- + POST assíncrono via pg_net (retentativa pelo cron /api/cron/webhook-retry).
--
-- Eventos: deal.created (novo) | deal.stage_changed (já existia, agora com filtros)

-- -----------------------------------------------------------------------------
-- 1) Colunas novas (aditivas)
-- -----------------------------------------------------------------------------
ALTER TABLE public.integration_outbound_endpoints
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'followup',
  ADD COLUMN IF NOT EXISTS board_id UUID REFERENCES public.boards(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS from_stage_id UUID REFERENCES public.board_stages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS to_stage_id UUID REFERENCES public.board_stages(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.integration_outbound_endpoints.kind IS 'followup = endpoint único do follow-up | pipeline = regra do pipeline com filtros';
COMMENT ON COLUMN public.integration_outbound_endpoints.board_id IS 'filtro: só dispara para leads deste quadro (NULL = qualquer quadro)';
COMMENT ON COLUMN public.integration_outbound_endpoints.from_stage_id IS 'filtro (deal.stage_changed): etapa de origem (NULL = qualquer)';
COMMENT ON COLUMN public.integration_outbound_endpoints.to_stage_id IS 'filtro: etapa de destino / etapa em que o lead foi criado (NULL = qualquer)';

CREATE INDEX IF NOT EXISTS idx_integration_outbound_endpoints_org_kind
  ON public.integration_outbound_endpoints (organization_id, kind);

-- -----------------------------------------------------------------------------
-- 2) deal.stage_changed: mesmo corpo de antes + filtros de quadro/etapa + 'rule' no payload
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_deal_stage_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  endpoint RECORD;
  board_name TEXT;
  from_label TEXT;
  to_label TEXT;
  contact_name TEXT;
  contact_phone TEXT;
  contact_email TEXT;
  payload JSONB;
  event_id UUID;
  delivery_id UUID;
  req_id BIGINT;
BEGIN
  IF (TG_OP <> 'UPDATE') THEN
    RETURN NEW;
  END IF;

  IF NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  -- Lead na lixeira (soft delete) não gera aviso
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Enriquecimento básico para payload humano
  SELECT b.name INTO board_name FROM public.boards b WHERE b.id = NEW.board_id;
  SELECT bs.label INTO to_label FROM public.board_stages bs WHERE bs.id = NEW.stage_id;
  SELECT bs.label INTO from_label FROM public.board_stages bs WHERE bs.id = OLD.stage_id;

  IF NEW.contact_id IS NOT NULL THEN
    SELECT c.name, c.phone, c.email
      INTO contact_name, contact_phone, contact_email
    FROM public.contacts c
    WHERE c.id = NEW.contact_id;
  END IF;

  FOR endpoint IN
    SELECT * FROM public.integration_outbound_endpoints e
    WHERE e.organization_id = NEW.organization_id
      AND e.active = true
      AND 'deal.stage_changed' = ANY(e.events)
      -- Filtros das regras do pipeline (NULL = qualquer). O follow-up antigo tem tudo NULL.
      AND (e.board_id IS NULL OR e.board_id = NEW.board_id)
      AND (e.from_stage_id IS NULL OR e.from_stage_id = OLD.stage_id)
      AND (e.to_stage_id IS NULL OR e.to_stage_id = NEW.stage_id)
    ORDER BY e.created_at
  LOOP
    payload := jsonb_build_object(
      'event_type', 'deal.stage_changed',
      'occurred_at', now(),
      'deal', jsonb_build_object(
        'id', NEW.id,
        'title', NEW.title,
        'value', NEW.value,
        'board_id', NEW.board_id,
        'board_name', board_name,
        -- Ordem intencional: from -> to (fica mais legível em ferramentas como n8n)
        'from_stage_id', OLD.stage_id,
        'from_stage_label', from_label,
        'to_stage_id', NEW.stage_id,
        'to_stage_label', to_label,
        'contact_id', NEW.contact_id
      ),
      'contact', jsonb_build_object(
        'name', contact_name,
        'phone', contact_phone,
        'email', contact_email
      ),
      -- Qual regra disparou (útil quando várias regras apontam pro mesmo n8n)
      'rule', jsonb_build_object(
        'id', endpoint.id,
        'name', endpoint.name,
        'kind', endpoint.kind
      )
    );

    INSERT INTO public.webhook_events_out (organization_id, event_type, payload, deal_id, from_stage_id, to_stage_id)
    VALUES (NEW.organization_id, 'deal.stage_changed', payload, NEW.id, OLD.stage_id, NEW.stage_id)
    RETURNING id INTO event_id;

    INSERT INTO public.webhook_deliveries (organization_id, endpoint_id, event_id, status)
    VALUES (NEW.organization_id, endpoint.id, event_id, 'queued')
    RETURNING id INTO delivery_id;

    -- Dispara HTTP async (MVP)
    BEGIN
      SELECT net.http_post(
        url := endpoint.url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Webhook-Secret', endpoint.secret,
          'X-Webhook-Event', 'deal.stage_changed',
          'Authorization', ('Bearer ' || endpoint.secret)
        ),
        body := payload
      ) INTO req_id;

      UPDATE public.webhook_deliveries
        SET request_id = req_id
      WHERE id = delivery_id;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.webhook_deliveries
        SET status = 'failed',
            error = SQLERRM
      WHERE id = delivery_id;
    END;
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Webhook NUNCA pode impedir o lead de mudar de etapa.
  RAISE WARNING 'notify_deal_stage_changed falhou: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_deal_stage_changed ON public.deals;
CREATE TRIGGER trg_notify_deal_stage_changed
AFTER UPDATE ON public.deals
FOR EACH ROW
EXECUTE FUNCTION public.notify_deal_stage_changed();

-- -----------------------------------------------------------------------------
-- 3) deal.created: lead criado num quadro/etapa (manual, webhook de entrada, API, WhatsApp...)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_deal_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  endpoint RECORD;
  board_name TEXT;
  stage_label TEXT;
  contact_name TEXT;
  contact_phone TEXT;
  contact_email TEXT;
  payload JSONB;
  event_id UUID;
  delivery_id UUID;
  req_id BIGINT;
BEGIN
  IF (TG_OP <> 'INSERT') THEN
    RETURN NEW;
  END IF;

  -- Lead já na lixeira não gera aviso
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Custo zero pra org sem regra: só enriquece o payload se alguém quer o evento.
  IF NOT EXISTS (
    SELECT 1 FROM public.integration_outbound_endpoints e
    WHERE e.organization_id = NEW.organization_id
      AND e.active = true
      AND 'deal.created' = ANY(e.events)
      AND (e.board_id IS NULL OR e.board_id = NEW.board_id)
      AND (e.to_stage_id IS NULL OR e.to_stage_id = NEW.stage_id)
  ) THEN
    RETURN NEW;
  END IF;

  -- Enriquecimento básico para payload humano
  SELECT b.name INTO board_name FROM public.boards b WHERE b.id = NEW.board_id;
  SELECT bs.label INTO stage_label FROM public.board_stages bs WHERE bs.id = NEW.stage_id;

  IF NEW.contact_id IS NOT NULL THEN
    SELECT c.name, c.phone, c.email
      INTO contact_name, contact_phone, contact_email
    FROM public.contacts c
    WHERE c.id = NEW.contact_id;
  END IF;

  FOR endpoint IN
    SELECT * FROM public.integration_outbound_endpoints e
    WHERE e.organization_id = NEW.organization_id
      AND e.active = true
      AND 'deal.created' = ANY(e.events)
      -- Filtros da regra (NULL = qualquer)
      AND (e.board_id IS NULL OR e.board_id = NEW.board_id)
      AND (e.to_stage_id IS NULL OR e.to_stage_id = NEW.stage_id)
    ORDER BY e.created_at
  LOOP
    payload := jsonb_build_object(
      'event_type', 'deal.created',
      'occurred_at', now(),
      'deal', jsonb_build_object(
        'id', NEW.id,
        'title', NEW.title,
        'value', NEW.value,
        'board_id', NEW.board_id,
        'board_name', board_name,
        'stage_id', NEW.stage_id,
        'stage_label', stage_label,
        'contact_id', NEW.contact_id,
        'custom_fields', COALESCE(NEW.custom_fields, '{}'::jsonb),
        'created_at', NEW.created_at
      ),
      'contact', jsonb_build_object(
        'name', contact_name,
        'phone', contact_phone,
        'email', contact_email
      ),
      -- Qual regra disparou (útil quando várias regras apontam pro mesmo n8n)
      'rule', jsonb_build_object(
        'id', endpoint.id,
        'name', endpoint.name,
        'kind', endpoint.kind
      )
    );

    INSERT INTO public.webhook_events_out (organization_id, event_type, payload, deal_id, to_stage_id)
    VALUES (NEW.organization_id, 'deal.created', payload, NEW.id, NEW.stage_id)
    RETURNING id INTO event_id;

    INSERT INTO public.webhook_deliveries (organization_id, endpoint_id, event_id, status)
    VALUES (NEW.organization_id, endpoint.id, event_id, 'queued')
    RETURNING id INTO delivery_id;

    -- Dispara HTTP async (MVP)
    BEGIN
      SELECT net.http_post(
        url := endpoint.url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Webhook-Secret', endpoint.secret,
          'X-Webhook-Event', 'deal.created',
          'Authorization', ('Bearer ' || endpoint.secret)
        ),
        body := payload
      ) INTO req_id;

      UPDATE public.webhook_deliveries
        SET request_id = req_id
      WHERE id = delivery_id;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.webhook_deliveries
        SET status = 'failed',
            error = SQLERRM
      WHERE id = delivery_id;
    END;
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Webhook NUNCA pode impedir a criação do lead.
  RAISE WARNING 'notify_deal_created falhou: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_deal_created ON public.deals;
CREATE TRIGGER trg_notify_deal_created
AFTER INSERT ON public.deals
FOR EACH ROW
EXECUTE FUNCTION public.notify_deal_created();
