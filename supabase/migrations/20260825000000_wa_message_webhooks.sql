-- Webhooks de saída para mensagens do WhatsApp (agentes de IA no n8n/Make).
-- Um gatilho em wa_messages cobre TODAS as origens de uma vez: recebidas,
-- enviadas pelo CRM, pela API pública, pelo celular/Kommo (ecos da Meta).
-- Mesmo modelo do notify_deal_stage_changed: evento + entrega + POST via pg_net.
--
-- Eventos: whatsapp.message.received (lead -> você) | whatsapp.message.sent (você -> lead)

ALTER TABLE public.wa_messages ADD COLUMN IF NOT EXISTS source TEXT;
COMMENT ON COLUMN public.wa_messages.source IS 'origem da mensagem: inbound | echo | crm | api';

CREATE OR REPLACE FUNCTION public.notify_wa_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ev_type TEXT;
  endpoint RECORD;
  conv_connection_id UUID;
  conv_contact_id UUID;
  conv_deal_id UUID;
  conv_phone TEXT;
  conv_name TEXT;
  conv_owner UUID;
  conn_phone TEXT;
  conn_provider TEXT;
  conn_name TEXT;
  ct_name TEXT;
  ct_phone TEXT;
  ct_email TEXT;
  deal_title TEXT;
  deal_board UUID;
  deal_stage UUID;
  autor TEXT;
  payload JSONB;
  event_id UUID;
  delivery_id UUID;
  req_id BIGINT;
BEGIN
  ev_type := CASE WHEN NEW.direction = 'in' THEN 'whatsapp.message.received' ELSE 'whatsapp.message.sent' END;

  -- Custo zero pra org sem assinante: só monta o payload se alguém quer o evento.
  IF NOT EXISTS (
    SELECT 1 FROM public.integration_outbound_endpoints e
    WHERE e.organization_id = NEW.organization_id
      AND e.active = true
      AND ev_type = ANY(e.events)
  ) THEN
    RETURN NEW;
  END IF;

  SELECT c.connection_id, c.contact_id, c.deal_id, c.wa_phone, c.wa_name, c.assigned_owner_id
    INTO conv_connection_id, conv_contact_id, conv_deal_id, conv_phone, conv_name, conv_owner
  FROM public.wa_conversations c
  WHERE c.id = NEW.conversation_id;

  IF conv_connection_id IS NOT NULL THEN
    SELECT w.phone_number, w.provider, w.profile_name
      INTO conn_phone, conn_provider, conn_name
    FROM public.wa_connections w WHERE w.id = conv_connection_id;
  END IF;

  IF conv_contact_id IS NOT NULL THEN
    SELECT c.name, c.phone, c.email INTO ct_name, ct_phone, ct_email
    FROM public.contacts c WHERE c.id = conv_contact_id;
  END IF;

  IF conv_deal_id IS NOT NULL THEN
    SELECT d.title, d.board_id, d.stage_id INTO deal_title, deal_board, deal_stage
    FROM public.deals d WHERE d.id = conv_deal_id;
  END IF;

  IF NEW.sent_by IS NOT NULL THEN
    SELECT COALESCE(NULLIF(p.display_name, ''), NULLIF(p.name, ''), p.email) INTO autor
    FROM public.profiles p WHERE p.id = NEW.sent_by;
  END IF;

  payload := jsonb_build_object(
    'event_type', ev_type,
    'occurred_at', now(),
    'organization_id', NEW.organization_id,
    'message', jsonb_build_object(
      'id', NEW.id,
      'direction', NEW.direction,
      'status', NEW.status,
      'text', NEW.body,
      'media_type', NEW.media_type,
      'media_mime', NEW.media_mime,
      'media_path', NEW.media_url,
      'provider_message_id', NEW.evolution_message_id,
      -- inbound = lead mandou | echo = enviada por fora (celular/Kommo) |
      -- crm = usuário no CRM | api = API pública (ex.: o próprio agente)
      'source', COALESCE(NEW.source, CASE WHEN NEW.direction = 'in' THEN 'inbound' ELSE 'unknown' END),
      'sent_by_user_id', NEW.sent_by,
      'sent_by_name', autor,
      'timestamp', COALESCE(NEW.wa_timestamp, NEW.created_at)
    ),
    'conversation', jsonb_build_object(
      'id', NEW.conversation_id,
      'phone', conv_phone,
      'name', conv_name,
      'contact_id', conv_contact_id,
      'deal_id', conv_deal_id,
      'assigned_owner_id', conv_owner
    ),
    'connection', jsonb_build_object(
      'id', conv_connection_id,
      'phone_number', conn_phone,
      'provider', conn_provider,
      'name', conn_name
    ),
    'contact', jsonb_build_object(
      'id', conv_contact_id,
      'name', ct_name,
      'phone', ct_phone,
      'email', ct_email
    ),
    'deal', jsonb_build_object(
      'id', conv_deal_id,
      'title', deal_title,
      'board_id', deal_board,
      'stage_id', deal_stage
    )
  );

  FOR endpoint IN
    SELECT * FROM public.integration_outbound_endpoints e
    WHERE e.organization_id = NEW.organization_id
      AND e.active = true
      AND ev_type = ANY(e.events)
  LOOP
    INSERT INTO public.webhook_events_out (organization_id, event_type, payload, deal_id)
    VALUES (NEW.organization_id, ev_type, payload, conv_deal_id)
    RETURNING id INTO event_id;

    INSERT INTO public.webhook_deliveries (organization_id, endpoint_id, event_id, status)
    VALUES (NEW.organization_id, endpoint.id, event_id, 'queued')
    RETURNING id INTO delivery_id;

    BEGIN
      SELECT net.http_post(
        url := endpoint.url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Webhook-Secret', endpoint.secret,
          'X-Webhook-Event', ev_type,
          'Authorization', ('Bearer ' || endpoint.secret)
        ),
        body := payload
      ) INTO req_id;

      UPDATE public.webhook_deliveries SET request_id = req_id WHERE id = delivery_id;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.webhook_deliveries SET status = 'failed', error = SQLERRM WHERE id = delivery_id;
    END;
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Webhook NUNCA pode derrubar a gravação da mensagem.
  RAISE WARNING 'notify_wa_message falhou: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_wa_message ON public.wa_messages;
CREATE TRIGGER trg_notify_wa_message
  AFTER INSERT ON public.wa_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_wa_message();
