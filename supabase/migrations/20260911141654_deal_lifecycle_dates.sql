-- Persist first qualification; keep the immutable stage history on regressions.
ALTER TABLE public.deals ADD COLUMN qualified_at timestamptz;
ALTER TABLE public.deals ADD COLUMN qualification_date_source text
  CHECK (qualification_date_source IN ('transition', 'history', 'estimated'));

-- Private lookup, scoped to the deal's organization and board. No client RPC.
CREATE FUNCTION crm_internal.deal_stage_rules(p_board uuid, p_org uuid, p_stage uuid)
RETURNS TABLE (qualifies boolean, won boolean, lost boolean, at_sql boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH stages AS (
    SELECT s.*, b.won_stage_id, b.lost_stage_id, b.linked_lifecycle_stage AS board_lifecycle
    FROM public.board_stages s JOIN public.boards b ON b.id=s.board_id
    WHERE b.id=p_board AND b.organization_id=p_org AND s.organization_id=p_org
  ), threshold AS (
    SELECT coalesce(min("order") FILTER (WHERE linked_lifecycle_stage='SALES_QUALIFIED'),
      min("order") FILTER (WHERE lower(label) LIKE 'qualificad%')) AS q
    FROM stages
  )
  SELECT t.q IS NOT NULL AND s."order">=t.q AND NOT (
      coalesce(s.id=s.lost_stage_id, false) OR
      (s.lost_stage_id IS NULL AND s.linked_lifecycle_stage IS NOT DISTINCT FROM 'OTHER')),
    CASE WHEN s.won_stage_id IS NOT NULL THEN s.id=s.won_stage_id
      ELSE coalesce(s.board_lifecycle<>'CUSTOMER',true) AND s.linked_lifecycle_stage IS NOT DISTINCT FROM 'CUSTOMER' END,
    CASE WHEN s.lost_stage_id IS NOT NULL THEN s.id=s.lost_stage_id
      ELSE s.linked_lifecycle_stage IS NOT DISTINCT FROM 'OTHER' END,
    s."order"=t.q
  FROM stages s CROSS JOIN threshold t WHERE s.id=p_stage;
$$;
REVOKE ALL ON FUNCTION crm_internal.deal_stage_rules(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;

-- Backfill from known arrivals, including legacy movement activities. An arrival
-- after SQL without a known earlier origin supplies an upper bound, not an exact date.
WITH evidence AS (
  SELECT d.id, e.occurred_at AS at,
    CASE WHEN dest.at_sql OR NOT coalesce(origin.qualifies,true) THEN 'history' ELSE 'estimated' END AS source
  FROM public.deals d JOIN public.deal_stage_events e ON e.deal_id=d.id
    AND e.organization_id=d.organization_id AND e.board_id=d.board_id
  CROSS JOIN LATERAL crm_internal.deal_stage_rules(d.board_id,d.organization_id,e.to_stage_id) dest
  LEFT JOIN LATERAL crm_internal.deal_stage_rules(d.board_id,d.organization_id,e.from_stage_id) origin ON true
  WHERE d.deleted_at IS NULL AND dest.qualifies AND e.occurred_at BETWEEN d.created_at AND now()
  UNION ALL
  SELECT d.id,a.date,CASE WHEN r.at_sql THEN 'history' ELSE 'estimated' END
  FROM public.deals d JOIN public.activities a ON a.deal_id=d.id AND a.organization_id=d.organization_id
  JOIN public.board_stages s ON s.board_id=d.board_id AND s.organization_id=d.organization_id
    AND a.title='Moveu para '||s.label
  CROSS JOIN LATERAL crm_internal.deal_stage_rules(d.board_id,d.organization_id,s.id) r
  WHERE d.deleted_at IS NULL AND a.deleted_at IS NULL AND a.type='STATUS_CHANGE' AND r.qualifies
    AND a.date BETWEEN d.created_at AND now()
    AND (SELECT count(*) FROM public.board_stages same WHERE same.board_id=d.board_id AND same.label=s.label)=1
  UNION ALL
  SELECT d.id,stamp.at,CASE WHEN dest.at_sql OR NOT coalesce(origin.qualifies,true) THEN 'history' ELSE 'estimated' END
  FROM public.deals d JOIN public.webhook_events_out e ON e.deal_id=d.id AND e.organization_id=d.organization_id
  CROSS JOIN LATERAL crm_internal.deal_stage_rules(d.board_id,d.organization_id,e.to_stage_id) dest
  LEFT JOIN LATERAL crm_internal.deal_stage_rules(d.board_id,d.organization_id,e.from_stage_id) origin ON true
  CROSS JOIN LATERAL (SELECT CASE WHEN pg_catalog.pg_input_is_valid(e.payload->>'occurred_at','timestamp with time zone')
    THEN (e.payload->>'occurred_at')::timestamptz ELSE e.created_at END AS at) stamp
  WHERE d.deleted_at IS NULL AND dest.qualifies AND e.event_type IN ('deal.stage_changed','deal.created')
    AND e.payload->'deal'->>'board_id'=d.board_id::text AND stamp.at BETWEEN d.created_at AND now()
), first_evidence AS (
  SELECT DISTINCT ON (id) id,at,source FROM evidence ORDER BY id,at,(source='history') DESC
)
UPDATE public.deals d SET qualified_at=e.at,qualification_date_source=e.source
FROM first_evidence e WHERE d.id=e.id AND d.qualified_at IS NULL;

-- Existing qualified records with no usable history: date of the correction,
-- explicitly estimated. Never pretend their creation date was qualification.
UPDATE public.deals d SET qualified_at=now(),qualification_date_source='estimated'
WHERE d.deleted_at IS NULL AND d.qualified_at IS NULL AND (
  coalesce((SELECT qualifies FROM crm_internal.deal_stage_rules(d.board_id,d.organization_id,d.stage_id)),false)
  OR ((d.is_won OR (d.is_lost AND d.loss_category='qualified')) AND EXISTS (
    SELECT 1 FROM public.board_stages s WHERE s.board_id=d.board_id AND s.organization_id=d.organization_id
      AND (s.linked_lifecycle_stage='SALES_QUALIFIED' OR lower(s.label) LIKE 'qualificad%'))));

CREATE FUNCTION crm_internal.sync_deal_lifecycle_dates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record; moved boolean; previous_closed boolean; outcome_changed boolean;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  SELECT * INTO r FROM crm_internal.deal_stage_rules(NEW.board_id,NEW.organization_id,NEW.stage_id);
  moved := TG_OP='INSERT';
  previous_closed := false;
  outcome_changed := true;
  IF TG_OP='UPDATE' THEN
    moved := NEW.stage_id IS DISTINCT FROM OLD.stage_id OR NEW.board_id IS DISTINCT FROM OLD.board_id;
    previous_closed := coalesce(OLD.is_won,false) OR coalesce(OLD.is_lost,false);
    outcome_changed := NEW.is_won IS DISTINCT FROM OLD.is_won OR NEW.is_lost IS DISTINCT FROM OLD.is_lost;
    -- The first qualification survives returns. Each board has its own threshold.
    IF NEW.board_id IS NOT DISTINCT FROM OLD.board_id AND OLD.qualified_at IS NOT NULL THEN
      NEW.qualified_at := OLD.qualified_at;
      NEW.qualification_date_source := OLD.qualification_date_source;
    ELSIF NEW.board_id IS DISTINCT FROM OLD.board_id THEN
      NEW.qualified_at := NULL;
      NEW.qualification_date_source := NULL;
    END IF;
  END IF;
  IF moved THEN
    NEW.last_stage_change_date := now();
    IF coalesce(r.won,false) THEN
      NEW.is_won := true; NEW.is_lost := false;
    ELSIF coalesce(r.lost,false) THEN
      NEW.is_won := false; NEW.is_lost := true;
    ELSIF TG_OP='UPDATE' AND previous_closed AND NOT outcome_changed THEN
      NEW.is_won := false; NEW.is_lost := false;
    END IF;
  END IF;
  IF NEW.is_won AND NEW.is_lost THEN
    RAISE EXCEPTION 'O negócio não pode estar ganho e perdido ao mesmo tempo';
  END IF;
  IF NEW.is_won OR NEW.is_lost THEN
    IF TG_OP='UPDATE' THEN
      IF OLD.is_won IS NOT DISTINCT FROM NEW.is_won AND OLD.is_lost IS NOT DISTINCT FROM NEW.is_lost AND OLD.closed_at IS NOT NULL THEN
        NEW.closed_at := OLD.closed_at;
      ELSE
        NEW.closed_at := now();
      END IF;
    ELSE
      NEW.closed_at := coalesce(NEW.closed_at,now());
    END IF;
  ELSE
    NEW.closed_at := NULL;
    NEW.loss_category := NULL;
    NEW.loss_reason := NULL;
  END IF;
  IF NEW.qualified_at IS NULL AND (coalesce(r.qualifies,false) OR (
    (NEW.is_won OR (NEW.is_lost AND NEW.loss_category='qualified')) AND EXISTS (
      SELECT 1 FROM public.board_stages s WHERE s.board_id=NEW.board_id AND s.organization_id=NEW.organization_id
        AND (s.linked_lifecycle_stage='SALES_QUALIFIED' OR lower(s.label) LIKE 'qualificad%')))) THEN
    NEW.qualified_at := now();
    NEW.qualification_date_source := CASE WHEN moved THEN 'transition' ELSE 'estimated' END;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION crm_internal.sync_deal_lifecycle_dates() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sync_deal_lifecycle_dates BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION crm_internal.sync_deal_lifecycle_dates();
COMMENT ON COLUMN public.deals.qualified_at IS 'First qualification in the current board; preserved on regressions. See qualification_date_source.';
COMMENT ON COLUMN public.deals.qualification_date_source IS 'transition: recorded at movement; history: recovered crossing; estimated: upper bound or correction date, excluded from dated conversion metrics.';
UPDATE public.deals SET closed_at=NULL WHERE NOT is_won AND NOT is_lost AND closed_at IS NOT NULL AND deleted_at IS NULL;
NOTIFY pgrst, 'reload schema';
