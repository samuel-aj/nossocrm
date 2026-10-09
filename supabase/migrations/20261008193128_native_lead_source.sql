-- Acquisition is a deal attribute, independent of a contact's mutable source.
-- Do not UPDATE deals here: unrelated writes can dispatch CRM automations.
ALTER TABLE public.deals ADD COLUMN lead_source text;
ALTER TABLE public.deals ADD COLUMN lead_source_initialized boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.deals.lead_source_initialized IS
  'False: read legacy custom_fields.origem. True: lead_source is authoritative, including NULL.';
ALTER TABLE public.organization_settings ADD COLUMN lead_source_options text[];
COMMENT ON COLUMN public.organization_settings.lead_source_options IS
  'NULL uses application defaults; empty array explicitly offers only unknown source.';

CREATE FUNCTION crm_internal.normalize_lead_source(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT nullif(btrim(regexp_replace(p_value,'[[:space:]]+',' ','g')),'');
$$;
CREATE FUNCTION crm_internal.legacy_lead_source(p_fields jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN jsonb_typeof(p_fields->'origem')='string'
    THEN crm_internal.normalize_lead_source(p_fields->>'origem') END;
$$;
CREATE FUNCTION crm_internal.read_deal_lead_source(p_deal public.deals)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_deal.lead_source_initialized OR p_deal.lead_source IS NOT NULL
    THEN crm_internal.normalize_lead_source(p_deal.lead_source)
    ELSE crm_internal.legacy_lead_source(p_deal.custom_fields) END;
$$;
-- Deliberately narrow inference: a recognizable network without an explicit
-- paid/organic medium is ambiguous. Click identifiers alone are not categories.
CREATE FUNCTION crm_internal.infer_new_lead_source(p_fields jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  WITH utm AS (
    SELECT lower(crm_internal.normalize_lead_source(p_fields->>'utm_source')) AS source,
      lower(crm_internal.normalize_lead_source(p_fields->>'utm_medium')) AS medium
  ) SELECT CASE
    WHEN medium IN ('cpc','ppc','paid','paid_social','paid-social','paid_search','paid-search','paidsocial','paidsearch')
      AND source IN ('google','googleads','google_ads','googleadwords') THEN 'Google Ads'
    WHEN medium IN ('cpc','ppc','paid','paid_social','paid-social','paid_search','paid-search','paidsocial','paidsearch')
      AND source IN ('meta','facebook','fb','instagram','ig','facebook_ads','instagram_ads') THEN 'Meta Ads'
    WHEN medium IN ('organic','organic_social','organic-social','organic_search','organic-search')
      AND source IN ('google','meta','facebook','fb','instagram','ig') THEN 'Orgânico/Rede Social'
    ELSE NULL END FROM utm;
$$;
REVOKE ALL ON FUNCTION crm_internal.normalize_lead_source(text),
  crm_internal.legacy_lead_source(jsonb),crm_internal.read_deal_lead_source(public.deals),
  crm_internal.infer_new_lead_source(jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- A row trigger cannot distinguish SET lead_source=NULL from omission when it
-- was already NULL. A column-specific trigger marks that native write first.
-- NULL is only a transient BEFORE-trigger sentinel: the next ordered trigger
-- always consumes it and restores true before NOT NULL is checked. No session
-- state, query parsing or persistent third column is needed, including bulk SQL.
CREATE FUNCTION crm_internal.mark_native_lead_source_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN NEW.lead_source_initialized := NULL; RETURN NEW; END;
$$;
CREATE FUNCTION crm_internal.sync_deal_lead_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.lead_source_initialized IS DISTINCT FROM false OR NEW.lead_source IS NOT NULL THEN
      NEW.lead_source := crm_internal.normalize_lead_source(NEW.lead_source);
    ELSIF coalesce(NEW.custom_fields ? 'origem',false) THEN
      NEW.lead_source := crm_internal.legacy_lead_source(NEW.custom_fields);
    ELSE
      NEW.lead_source := crm_internal.infer_new_lead_source(NEW.custom_fields);
    END IF;
  ELSIF NEW.lead_source_initialized IS NULL
      OR NEW.lead_source IS DISTINCT FROM OLD.lead_source
      OR (NEW.lead_source_initialized AND NOT OLD.lead_source_initialized) THEN
    NEW.lead_source := crm_internal.normalize_lead_source(NEW.lead_source);
  ELSIF coalesce(NEW.custom_fields ? 'origem',false)
      AND NEW.custom_fields->'origem' IS DISTINCT FROM OLD.custom_fields->'origem' THEN
    -- Existing integrations may explicitly edit/clear origem. A replacement
    -- custom_fields object that omits origem is not a request to clear source.
    NEW.lead_source := crm_internal.legacy_lead_source(NEW.custom_fields);
  ELSE
    -- Lazy initialization only. Never infer UTMs on an existing record.
    NEW.lead_source := crm_internal.read_deal_lead_source(OLD);
  END IF;
  NEW.lead_source_initialized := true;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION crm_internal.mark_native_lead_source_write(),
  crm_internal.sync_deal_lead_source() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER a_native_lead_source_write BEFORE UPDATE OF lead_source ON public.deals
  FOR EACH ROW EXECUTE FUNCTION crm_internal.mark_native_lead_source_write();
CREATE TRIGGER b_sync_deal_lead_source BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION crm_internal.sync_deal_lead_source();

-- Carry configured legacy choices forward once. Retain their order and custom
-- labels, including a deliberate empty list. Do not mutate the old definition
-- or silently truncate pre-existing lists to the new configuration limits.
INSERT INTO public.organization_settings(organization_id,lead_source_options)
SELECT f.organization_id,ARRAY(
  SELECT normalized FROM (
    SELECT DISTINCT ON (lower(normalized)) normalized,ordinal
    FROM (
      SELECT crm_internal.normalize_lead_source(item) AS normalized,ordinal
      FROM unnest(f.options) WITH ORDINALITY AS choice(item,ordinal)
    ) clean WHERE normalized IS NOT NULL
    ORDER BY lower(normalized),ordinal
  ) unique_choices ORDER BY ordinal
)
FROM public.custom_field_definitions f
WHERE f.key='origem' AND f.entity_type='deal' AND f.organization_id IS NOT NULL AND f.options IS NOT NULL
ON CONFLICT (organization_id) DO UPDATE SET lead_source_options=EXCLUDED.lead_source_options
  WHERE public.organization_settings.lead_source_options IS NULL;

CREATE FUNCTION crm_internal.validate_lead_source_options()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE item text; normalized text; result text[] := '{}';
BEGIN
  IF NEW.lead_source_options IS NULL THEN RETURN NEW; END IF;
  IF cardinality(NEW.lead_source_options)>50 OR array_ndims(NEW.lead_source_options)>1 THEN
    RAISE EXCEPTION 'Informe no máximo 50 origens do lead.' USING ERRCODE='23514';
  END IF;
  FOREACH item IN ARRAY NEW.lead_source_options LOOP
    normalized := crm_internal.normalize_lead_source(item);
    IF normalized IS NULL OR char_length(normalized)>120 THEN
      RAISE EXCEPTION 'A origem deve ter de 1 a 120 caracteres.' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM unnest(result) r WHERE lower(r)=lower(normalized)) THEN
      result := array_append(result,normalized);
    END IF;
  END LOOP;
  NEW.lead_source_options := result;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION crm_internal.validate_lead_source_options() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER validate_lead_source_options BEFORE INSERT OR UPDATE OF lead_source_options ON public.organization_settings
  FOR EACH ROW EXECUTE FUNCTION crm_internal.validate_lead_source_options();

CREATE FUNCTION crm_internal.capture_lead_source_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE previous_source text; next_source text; actor record;
BEGIN
  previous_source := crm_internal.read_deal_lead_source(OLD);
  next_source := crm_internal.read_deal_lead_source(NEW);
  IF previous_source IS NOT DISTINCT FROM next_source THEN RETURN NEW; END IF;
  SELECT * INTO actor FROM crm_internal.current_actor();
  INSERT INTO public.deal_events(organization_id,deal_id,kind,field,old_value,new_value,actor_kind,actor_id)
    VALUES (NEW.organization_id,NEW.id,'lead_source','lead_source',to_jsonb(previous_source),to_jsonb(next_source),actor.kind,actor.id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION crm_internal.capture_lead_source_event() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER capture_lead_source_event AFTER UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION crm_internal.capture_lead_source_event();

ALTER TABLE public.deal_lifecycle_events ADD COLUMN lead_source text;
ALTER TABLE public.deal_lifecycle_events ADD COLUMN lead_source_snapshot_source text NOT NULL DEFAULT 'current'
  CHECK (lead_source_snapshot_source IN ('transition','current'));
COMMENT ON COLUMN public.deal_lifecycle_events.lead_source_snapshot_source IS
  'transition captures source at the event; current is legacy enrichment, not proof of the historical source.';
-- Enrich only the report ledger, never operational deals. Old event time does
-- not make today's source an observed historical fact.
UPDATE public.deal_lifecycle_events e SET lead_source=crm_internal.read_deal_lead_source(d)
  FROM public.deals d WHERE d.id=e.deal_id AND d.organization_id=e.organization_id;

-- Preserve OLD vs NEW snapshots on board transfers when source changes in the
-- same statement. Loading the current deal in a ledger trigger would lose OLD.
CREATE OR REPLACE FUNCTION crm_internal.append_deal_lifecycle_event(
  p_deal public.deals, p_board uuid, p_type text, p_at timestamptz,
  p_source text, p_snapshot text, p_key text, p_stage uuid,
  p_won boolean, p_lost boolean, p_loss_category text, p_loss_reason text
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.deal_lifecycle_events (
    organization_id,deal_id,board_id,event_type,occurred_at,source,snapshot_source,
    stage_id,owner_id,value,title,deal_created_at,loss_category,loss_reason,items,is_won,is_lost,evidence_key,
    lead_source,lead_source_snapshot_source
  ) SELECT p_deal.organization_id,p_deal.id,p_board,p_type,p_at,p_source,p_snapshot,
    p_stage,p_deal.owner_id,p_deal.value,p_deal.title,p_deal.created_at,p_loss_category,p_loss_reason,
    coalesce((SELECT jsonb_agg(jsonb_build_object('productId',i.product_id,'name',i.name,'quantity',i.quantity,'price',i.price) ORDER BY i.id)
      FROM public.deal_items i WHERE i.deal_id=p_deal.id AND i.organization_id=p_deal.organization_id),'[]'::jsonb),
    coalesce(p_won,false),coalesce(p_lost,false),p_key,
    crm_internal.read_deal_lead_source(p_deal),CASE WHEN p_snapshot='transition' THEN 'transition' ELSE 'current' END
  WHERE p_board IS NOT NULL AND p_at IS NOT NULL
  ON CONFLICT DO NOTHING;
$$;
REVOKE ALL ON FUNCTION crm_internal.append_deal_lifecycle_event(public.deals,uuid,text,timestamptz,text,text,text,uuid,boolean,boolean,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
-- Existing deals, settings and ledger grants/RLS remain unchanged. No new RPCs
-- or client DML grants on the immutable report ledger.
