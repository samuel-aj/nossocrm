-- One piece of evidence per inbound provider message. Never infer by phone/contact.
CREATE TABLE crm_internal.wa_ctwa_referrals (
  organization_id uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES public.wa_conversations(id) ON DELETE CASCADE,
  message_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  provider text NOT NULL CHECK (provider IN ('meta','evolution')),
  reference jsonb NOT NULL,
  attributed_deal_id uuid,
  PRIMARY KEY (conversation_id, message_id)
);
REVOKE ALL ON crm_internal.wa_ctwa_referrals FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX wa_ctwa_pending ON crm_internal.wa_ctwa_referrals (conversation_id) WHERE attributed_deal_id IS NULL;

-- The caller holds the conversation lock. Consume each referral on its first
-- valid link even when the lead already has a source. Relinking cannot recycle it.
CREATE FUNCTION crm_internal.claim_wa_ctwa(p_org uuid, p_conv uuid, p_deal uuid)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  lead public.deals;
  fields jsonb;
  notes text;
  origin text;
  ref jsonb;
  param record;
  id_line text;
BEGIN
  IF p_deal IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT FROM crm_internal.wa_ctwa_referrals WHERE organization_id=p_org
    AND conversation_id=p_conv AND attributed_deal_id IS NULL) THEN RETURN; END IF;
  SELECT * INTO lead FROM public.deals WHERE id=p_deal AND organization_id=p_org AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  fields := lead.custom_fields;
  notes := lead.description;
  origin := crm_internal.read_deal_lead_source(lead);
  IF origin IS NULL AND NOT EXISTS (SELECT FROM public.deal_events e WHERE e.organization_id=p_org
    AND e.deal_id=p_deal AND e.kind='lead_source' AND e.new_value IS NULL) THEN
    origin := 'Meta Ads';
  END IF;
  FOR ref IN
    WITH claimed AS (
      UPDATE crm_internal.wa_ctwa_referrals SET attributed_deal_id=p_deal
      WHERE organization_id=p_org AND conversation_id=p_conv AND attributed_deal_id IS NULL
      RETURNING reference, observed_at, message_id
    ) SELECT reference FROM claimed ORDER BY observed_at,message_id
  LOOP
    IF coalesce(ref->'utms','{}'::jsonb) <> '{}'::jsonb THEN
      FOR param IN SELECT key,value FROM jsonb_each_text(ref->'utms')
        WHERE key IN ('utm_source','utm_medium','utm_campaign','utm_content','utm_term')
      LOOP
        IF (fields IS NULL OR jsonb_typeof(fields) IN ('null','object')) AND nullif(btrim(fields->>param.key),'') IS NULL THEN
          fields := jsonb_set(coalesce(nullif(fields,'null'::jsonb),'{}'::jsonb),ARRAY[param.key],to_jsonb(param.value));
        END IF;
      END LOOP;
    ELSE
      id_line := coalesce('ID do anúncio Meta: ' || (ref->>'ad_id'), 'ID do clique WhatsApp: ' || (ref->>'click_id'));
      IF id_line IS NOT NULL AND NOT (id_line = ANY(string_to_array(replace(coalesce(notes,''), E'\r\n', E'\n'), E'\n'))) THEN
        notes := concat_ws(E'\n', nullif(notes,''), id_line);
      END IF;
    END IF;
  END LOOP;
  IF fields IS DISTINCT FROM lead.custom_fields OR notes IS DISTINCT FROM lead.description
    OR origin IS DISTINCT FROM crm_internal.read_deal_lead_source(lead) THEN
    UPDATE public.deals SET lead_source=origin,custom_fields=fields,description=notes WHERE id=p_deal AND organization_id=p_org;
  END IF;
END $$;
REVOKE ALL ON FUNCTION crm_internal.claim_wa_ctwa(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.record_wa_ctwa(p_org uuid, p_connection uuid, p_conv uuid, p_message text,
  p_time timestamptz, p_provider text, p_ref jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE linked uuid;
BEGIN
  IF nullif(btrim(p_message),'') IS NULL OR p_time IS NULL OR p_ref IS NULL OR jsonb_typeof(p_ref)<>'object'
    OR coalesce(nullif(btrim(p_ref->>'ad_id'),''),nullif(btrim(p_ref->>'click_id'),''),nullif(btrim(p_ref->>'source_url'),'')) IS NULL
    THEN RAISE EXCEPTION 'Invalid CTWA reference'; END IF;
  SELECT c.deal_id INTO linked FROM public.wa_conversations c WHERE c.id=p_conv
    AND c.organization_id=p_org AND c.connection_id=p_connection AND NOT c.is_group FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO crm_internal.wa_ctwa_referrals (organization_id,conversation_id,message_id,observed_at,provider,reference)
    VALUES (p_org,p_conv,p_message,p_time,p_provider,p_ref)
    ON CONFLICT (conversation_id,message_id) DO NOTHING;
  IF FOUND THEN PERFORM crm_internal.claim_wa_ctwa(p_org,p_conv,linked); END IF;
END $$;
REVOKE ALL ON FUNCTION public.record_wa_ctwa(uuid,uuid,uuid,text,timestamptz,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_wa_ctwa(uuid,uuid,uuid,text,timestamptz,text,jsonb) TO service_role;

CREATE FUNCTION crm_internal.claim_linked_wa_ctwa() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM crm_internal.claim_wa_ctwa(NEW.organization_id,NEW.id,NEW.deal_id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_internal.claim_linked_wa_ctwa() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER claim_linked_wa_ctwa AFTER UPDATE OF deal_id ON public.wa_conversations
  FOR EACH ROW WHEN (NEW.deal_id IS NOT NULL AND OLD.deal_id IS DISTINCT FROM NEW.deal_id AND NOT NEW.is_group)
  EXECUTE FUNCTION crm_internal.claim_linked_wa_ctwa();
