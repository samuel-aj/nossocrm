-- Enrich deal-bearing outgoing webhooks from the trusted current setting/principal.
-- Based on deployed staging functions; preserve custom_fields, no-endpoint fast path,
-- rule filters, pg_net delivery tracking and best-effort trigger behavior.
-- pg_net requests already queued/in flight cannot be recalled when the flag changes.

CREATE OR REPLACE FUNCTION public.notify_deal_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
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

  -- Referências inválidas não impedem a escrita do lead, mas não geram webhook.
  IF NEW.board_id IS NOT NULL THEN
    SELECT b.name INTO board_name FROM public.boards b
      WHERE b.id = NEW.board_id AND b.organization_id = NEW.organization_id;
    IF NOT FOUND THEN RETURN NEW; END IF;
  END IF;
  IF NEW.stage_id IS NOT NULL THEN
    SELECT bs.label INTO stage_label FROM public.board_stages bs
      WHERE bs.id = NEW.stage_id AND bs.organization_id = NEW.organization_id;
    IF NOT FOUND THEN RETURN NEW; END IF;
  END IF;

  IF NEW.contact_id IS NOT NULL THEN
    SELECT c.name, c.phone, c.email
      INTO contact_name, contact_phone, contact_email
    FROM public.contacts c
    WHERE c.id = NEW.contact_id AND c.organization_id = NEW.organization_id;
    IF NOT FOUND THEN RETURN NEW; END IF;
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

    payload := jsonb_set(payload, '{deal}', (payload->'deal' - 'whatsapp_group_id') ||
      public.deal_whatsapp_group_field(NEW.organization_id, NEW.id));

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
$function$;

CREATE OR REPLACE FUNCTION public.notify_deal_stage_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
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

  -- Referências inválidas não impedem a escrita do lead, mas não geram webhook.
  IF NEW.board_id IS NOT NULL THEN
    SELECT b.name INTO board_name FROM public.boards b
      WHERE b.id = NEW.board_id AND b.organization_id = NEW.organization_id;
    IF NOT FOUND THEN RETURN NEW; END IF;
  END IF;
  IF NEW.stage_id IS NOT NULL THEN
    SELECT bs.label INTO to_label FROM public.board_stages bs
      WHERE bs.id = NEW.stage_id AND bs.organization_id = NEW.organization_id;
    IF NOT FOUND THEN RETURN NEW; END IF;
  END IF;
  IF OLD.stage_id IS NOT NULL THEN
    SELECT bs.label INTO from_label FROM public.board_stages bs
      WHERE bs.id = OLD.stage_id AND bs.organization_id = NEW.organization_id;
    IF NOT FOUND THEN RETURN NEW; END IF;
  END IF;

  IF NEW.contact_id IS NOT NULL THEN
    SELECT c.name, c.phone, c.email
      INTO contact_name, contact_phone, contact_email
    FROM public.contacts c
    WHERE c.id = NEW.contact_id AND c.organization_id = NEW.organization_id;
    IF NOT FOUND THEN RETURN NEW; END IF;
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

    payload := jsonb_set(payload, '{deal}', (payload->'deal' - 'whatsapp_group_id') ||
      public.deal_whatsapp_group_field(NEW.organization_id, NEW.id));

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
$function$;

CREATE OR REPLACE FUNCTION public.notify_wa_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  ev_type TEXT; endpoint RECORD;
  conv_connection_id UUID; conv_contact_id UUID; conv_deal_id UUID; conv_phone TEXT; conv_name TEXT; conv_owner UUID; conv_ai TEXT;
  conn_phone TEXT; conn_provider TEXT; conn_name TEXT;
  ct_name TEXT; ct_phone TEXT; ct_email TEXT;
  deal_title TEXT; deal_board UUID; deal_stage UUID;
  autor TEXT; payload JSONB; event_id UUID; delivery_id UUID; req_id BIGINT;
BEGIN
  ev_type := CASE WHEN NEW.direction = 'in' THEN 'whatsapp.message.received' ELSE 'whatsapp.message.sent' END;
  IF NOT EXISTS (SELECT 1 FROM public.integration_outbound_endpoints e WHERE e.organization_id = NEW.organization_id AND e.active = true AND ev_type = ANY(e.events)) THEN
    RETURN NEW;
  END IF;
  SELECT c.connection_id, c.contact_id, c.deal_id, c.wa_phone, c.wa_name, c.assigned_owner_id, c.ai_status
    INTO conv_connection_id, conv_contact_id, conv_deal_id, conv_phone, conv_name, conv_owner, conv_ai
  FROM public.wa_conversations c WHERE c.id = NEW.conversation_id AND c.organization_id = NEW.organization_id;
  -- Nunca persista associações/eventos para uma conversa de outra organização.
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF conv_owner IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = conv_owner
      AND NEW.organization_id IN (SELECT public.user_org_ids(p.id))
  ) THEN RETURN NEW; END IF;
  IF conv_connection_id IS NOT NULL THEN
    SELECT w.phone_number, w.provider, w.profile_name INTO conn_phone, conn_provider, conn_name FROM public.wa_connections w WHERE w.id = conv_connection_id AND w.organization_id = NEW.organization_id;
    IF NOT FOUND THEN RETURN NEW; END IF;
  END IF;
  IF conv_contact_id IS NOT NULL THEN
    SELECT c.name, c.phone, c.email INTO ct_name, ct_phone, ct_email FROM public.contacts c WHERE c.id = conv_contact_id AND c.organization_id = NEW.organization_id;
    IF NOT FOUND THEN RETURN NEW; END IF;
  END IF;
  IF conv_deal_id IS NOT NULL THEN
    SELECT d.title, d.board_id, d.stage_id INTO deal_title, deal_board, deal_stage FROM public.deals d WHERE d.id = conv_deal_id AND d.organization_id = NEW.organization_id;
    IF NOT FOUND THEN RETURN NEW; END IF;
    IF deal_board IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.boards b WHERE b.id = deal_board AND b.organization_id = NEW.organization_id
    ) THEN RETURN NEW; END IF;
    IF deal_stage IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.board_stages bs WHERE bs.id = deal_stage AND bs.organization_id = NEW.organization_id
    ) THEN RETURN NEW; END IF;
  END IF;
  IF NEW.sent_by IS NOT NULL THEN
    SELECT COALESCE(NULLIF(p.display_name, ''), NULLIF(p.name, ''), p.email) INTO autor FROM public.profiles p WHERE p.id = NEW.sent_by
      AND NEW.organization_id IN (SELECT public.user_org_ids(p.id));
    IF NOT FOUND THEN RETURN NEW; END IF;
  END IF;
  payload := jsonb_build_object(
    'event_type', ev_type, 'occurred_at', now(), 'organization_id', NEW.organization_id,
    'message', jsonb_build_object('id', NEW.id, 'direction', NEW.direction, 'status', NEW.status, 'text', NEW.body, 'media_type', NEW.media_type, 'media_mime', NEW.media_mime, 'media_path', NEW.media_url, 'provider_message_id', NEW.evolution_message_id,
      'source', COALESCE(NEW.source, CASE WHEN NEW.direction = 'in' THEN 'inbound' ELSE 'unknown' END), 'sent_by_user_id', NEW.sent_by, 'sent_by_name', autor, 'timestamp', COALESCE(NEW.wa_timestamp, NEW.created_at)),
    'conversation', jsonb_build_object('id', NEW.conversation_id, 'phone', conv_phone, 'name', conv_name, 'contact_id', conv_contact_id, 'deal_id', conv_deal_id, 'assigned_owner_id', conv_owner, 'ai_status', conv_ai),
    'connection', jsonb_build_object('id', conv_connection_id, 'phone_number', conn_phone, 'provider', conn_provider, 'name', conn_name),
    'contact', jsonb_build_object('id', conv_contact_id, 'name', ct_name, 'phone', ct_phone, 'email', ct_email),
    'deal', jsonb_build_object('id', conv_deal_id, 'title', deal_title, 'board_id', deal_board, 'stage_id', deal_stage)
  );
  IF conv_deal_id IS NOT NULL THEN
    payload := jsonb_set(payload, '{deal}', (payload->'deal' - 'whatsapp_group_id') ||
      public.deal_whatsapp_group_field(NEW.organization_id, conv_deal_id));
  END IF;
  FOR endpoint IN SELECT * FROM public.integration_outbound_endpoints e WHERE e.organization_id = NEW.organization_id AND e.active = true AND ev_type = ANY(e.events) LOOP
    INSERT INTO public.webhook_events_out (organization_id, event_type, payload, deal_id) VALUES (NEW.organization_id, ev_type, payload, conv_deal_id) RETURNING id INTO event_id;
    INSERT INTO public.webhook_deliveries (organization_id, endpoint_id, event_id, status) VALUES (NEW.organization_id, endpoint.id, event_id, 'queued') RETURNING id INTO delivery_id;
    BEGIN
      SELECT net.http_post(url := endpoint.url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'X-Webhook-Secret', endpoint.secret, 'X-Webhook-Event', ev_type, 'Authorization', ('Bearer ' || endpoint.secret)),
        body := payload) INTO req_id;
      UPDATE public.webhook_deliveries SET request_id = req_id WHERE id = delivery_id;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.webhook_deliveries SET status = 'failed', error = SQLERRM WHERE id = delivery_id;
    END;
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_wa_message falhou: %', SQLERRM;
  RETURN NEW;
END;
$function$;
