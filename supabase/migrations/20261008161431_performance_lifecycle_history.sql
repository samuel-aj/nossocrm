-- Historical reporting must use observed events, not today's deal state.
-- This migration intentionally does not UPDATE deals: that would fire webhooks,
-- follow-ups and other operational triggers while repairing reporting history.

CREATE OR REPLACE FUNCTION crm_internal.deal_stage_rules(p_board uuid, p_org uuid, p_stage uuid)
RETURNS TABLE (qualifies boolean, won boolean, lost boolean, at_sql boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH stages AS (
    SELECT s.*, b.won_stage_id, b.lost_stage_id, b.linked_lifecycle_stage AS board_lifecycle
    FROM public.board_stages s JOIN public.boards b ON b.id=s.board_id
    WHERE b.id=p_board AND b.organization_id=p_org AND s.organization_id=p_org
  ), threshold AS (
    SELECT coalesce(min("order") FILTER (WHERE linked_lifecycle_stage='MQL'),
      min("order") FILTER (WHERE linked_lifecycle_stage='SALES_QUALIFIED'),
      min("order") FILTER (WHERE lower(label) LIKE 'qualificad%')) AS q FROM stages
  )
  SELECT t.q IS NOT NULL AND s."order">=t.q AND NOT (
      coalesce(s.id=s.lost_stage_id,false) OR
      (s.lost_stage_id IS NULL AND s.linked_lifecycle_stage IS NOT DISTINCT FROM 'OTHER')),
    CASE WHEN s.won_stage_id IS NOT NULL THEN s.id=s.won_stage_id
      ELSE coalesce(s.board_lifecycle<>'CUSTOMER',true) AND s.linked_lifecycle_stage IS NOT DISTINCT FROM 'CUSTOMER' END,
    CASE WHEN s.lost_stage_id IS NOT NULL THEN s.id=s.lost_stage_id
      ELSE s.linked_lifecycle_stage IS NOT DISTINCT FROM 'OTHER' END,
    s."order"=t.q
  FROM stages s CROSS JOIN threshold t WHERE s.id=p_stage;
$$;
REVOKE ALL ON FUNCTION crm_internal.deal_stage_rules(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.deal_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  -- IDs are deliberately snapshots, not stage/board FKs: editing/removing stages
  -- must not rewrite recorded outcomes. Visibility still follows the current deal.
  board_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('entered_board','left_board','stage_changed','qualified','won','lost','reopened')),
  occurred_at timestamptz NOT NULL,
  source text NOT NULL CHECK (source IN ('transition','history')),
  snapshot_source text NOT NULL CHECK (snapshot_source IN ('transition','current')),
  stage_id uuid,
  owner_id uuid,
  value numeric,
  title text NOT NULL,
  deal_created_at timestamptz,
  loss_category text,
  loss_reason text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items)='array'),
  is_won boolean NOT NULL,
  is_lost boolean NOT NULL,
  evidence_key text NOT NULL UNIQUE,
  CHECK (NOT (is_won AND is_lost))
);
CREATE INDEX deal_lifecycle_events_scope_idx
  ON public.deal_lifecycle_events (organization_id,board_id,occurred_at,deal_id);
CREATE INDEX deal_lifecycle_events_deal_idx
  ON public.deal_lifecycle_events (deal_id,board_id,occurred_at);
CREATE UNIQUE INDEX deal_lifecycle_events_first_qualified_idx
  ON public.deal_lifecycle_events (organization_id,deal_id,board_id) WHERE event_type='qualified';
ALTER TABLE public.deal_lifecycle_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deal_lifecycle_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.deal_lifecycle_events TO authenticated,service_role;
CREATE POLICY deal_lifecycle_events_visible_deals ON public.deal_lifecycle_events
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.deals d WHERE d.id=deal_lifecycle_events.deal_id
      AND d.organization_id=deal_lifecycle_events.organization_id AND d.deleted_at IS NULL)
  );
COMMENT ON TABLE public.deal_lifecycle_events IS
  'Append-only lifecycle evidence. RLS follows the current visible deal. No client/service-role DML. Physical deletion of the deal/organization cascades for erasure.';
COMMENT ON COLUMN public.deal_lifecycle_events.snapshot_source IS
  'transition: snapshot at the observed write; current: historical date is evidenced but owner/value/title/items use the migration-time deal and are not historical facts.';

-- A structural invariant, independent of authentication. Existing legacy invalid
-- rows may still receive unrelated edits; changing any scope field must be valid.
CREATE FUNCTION crm_internal.check_deal_stage_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
    AND NEW.board_id IS NOT DISTINCT FROM OLD.board_id AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;
  IF NEW.board_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.boards b WHERE b.id=NEW.board_id AND b.organization_id=NEW.organization_id
  ) THEN RAISE EXCEPTION 'O funil não pertence à organização do negócio' USING ERRCODE='23514'; END IF;
  IF NEW.stage_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.board_stages s WHERE s.id=NEW.stage_id AND s.board_id=NEW.board_id
      AND s.organization_id=NEW.organization_id
  ) THEN RAISE EXCEPTION 'A etapa não pertence ao funil e à organização do negócio' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION crm_internal.check_deal_stage_scope() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER check_deal_stage_scope BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION crm_internal.check_deal_stage_scope();

-- Private insert helper shared by the trigger and this migration's backfill.
CREATE FUNCTION crm_internal.append_deal_lifecycle_event(
  p_deal public.deals, p_board uuid, p_type text, p_at timestamptz,
  p_source text, p_snapshot text, p_key text, p_stage uuid,
  p_won boolean, p_lost boolean, p_loss_category text, p_loss_reason text
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.deal_lifecycle_events (
    organization_id,deal_id,board_id,event_type,occurred_at,source,snapshot_source,
    stage_id,owner_id,value,title,deal_created_at,loss_category,loss_reason,items,is_won,is_lost,evidence_key
  ) SELECT p_deal.organization_id,p_deal.id,p_board,p_type,p_at,p_source,p_snapshot,
    p_stage,p_deal.owner_id,p_deal.value,p_deal.title,p_deal.created_at,p_loss_category,p_loss_reason,
    coalesce((SELECT jsonb_agg(jsonb_build_object('productId',i.product_id,'name',i.name,'quantity',i.quantity,'price',i.price) ORDER BY i.id)
      FROM public.deal_items i WHERE i.deal_id=p_deal.id AND i.organization_id=p_deal.organization_id),'[]'::jsonb),
    coalesce(p_won,false),coalesce(p_lost,false),p_key
  WHERE p_board IS NOT NULL AND p_at IS NOT NULL
  ON CONFLICT DO NOTHING;
$$;
REVOKE ALL ON FUNCTION crm_internal.append_deal_lifecycle_event(public.deals,uuid,text,timestamptz,text,text,text,uuid,boolean,boolean,text,text)
  FROM PUBLIC,anon,authenticated,service_role;

-- Date evidence, scoped to the actual historical board. Stage arrivals at the
-- threshold, or a demonstrated crossing from below, are usable; merely being
-- beyond it today is not. Estimated qualified_at is explicitly excluded.
WITH evidence AS (
  SELECT d.id AS deal_id,d.organization_id,e.board_id,e.to_stage_id AS stage_id,e.occurred_at,
    'stage:'||e.id::text AS evidence_key
  FROM public.deals d JOIN public.deal_stage_events e ON e.deal_id=d.id AND e.organization_id=d.organization_id
  CROSS JOIN LATERAL crm_internal.deal_stage_rules(e.board_id,d.organization_id,e.to_stage_id) dest
  LEFT JOIN LATERAL crm_internal.deal_stage_rules(e.board_id,d.organization_id,e.from_stage_id) origin ON true
  WHERE dest.qualifies AND (origin.qualifies=false OR (dest.at_sql AND e.from_stage_id IS NULL))
    AND e.occurred_at BETWEEN d.created_at AND now()
  UNION ALL
  SELECT d.id,d.organization_id,d.board_id,NULL,d.qualified_at,'qualified_at:'||d.id::text
  FROM public.deals d WHERE d.qualification_date_source IN ('transition','history')
    AND d.qualified_at BETWEEN d.created_at AND now() AND d.board_id IS NOT NULL
    -- A persisted current-board date cannot locate an earlier board after transfer.
    AND NOT EXISTS (SELECT 1 FROM public.deal_events t WHERE t.deal_id=d.id AND t.organization_id=d.organization_id
      AND t.kind='stage' AND t.detail->>'old_board_id' IS DISTINCT FROM t.detail->>'board_id'
      AND t.created_at>d.qualified_at)
  UNION ALL
  SELECT d.id,d.organization_id,b.id,e.to_stage_id,stamp.at,'webhook:'||e.id::text
  FROM public.deals d JOIN public.webhook_events_out e ON e.deal_id=d.id AND e.organization_id=d.organization_id
  JOIN public.boards b ON b.id::text=e.payload->'deal'->>'board_id' AND b.organization_id=d.organization_id
  CROSS JOIN LATERAL crm_internal.deal_stage_rules(b.id,d.organization_id,e.to_stage_id) dest
  LEFT JOIN LATERAL crm_internal.deal_stage_rules(b.id,d.organization_id,e.from_stage_id) origin ON true
  CROSS JOIN LATERAL (SELECT CASE WHEN pg_catalog.pg_input_is_valid(e.payload->>'occurred_at','timestamp with time zone')
    THEN (e.payload->>'occurred_at')::timestamptz ELSE e.created_at END AS at) stamp
  WHERE e.event_type IN ('deal.created','deal.stage_changed') AND dest.qualifies
    AND (origin.qualifies=false OR (dest.at_sql AND e.from_stage_id IS NULL)) AND stamp.at BETWEEN d.created_at AND now()
), first_evidence AS (
  SELECT DISTINCT ON (organization_id,deal_id,board_id) * FROM evidence
  ORDER BY organization_id,deal_id,board_id,occurred_at,evidence_key
)
SELECT crm_internal.append_deal_lifecycle_event(d,e.board_id,'qualified',e.occurred_at,
  'history','current',e.evidence_key||':qualified',e.stage_id,false,false,NULL,NULL)
FROM first_evidence e JOIN public.deals d ON d.id=e.deal_id;

-- Explicit board creation/transfers retain both sides. No inferred entry at the
-- first fetched stage: that might be an ordinary move, not board entry.
WITH board_evidence AS (
  SELECT e.*,b.id AS historical_board,'entered_board'::text AS event_type,
    CASE WHEN pg_catalog.pg_input_is_valid(e.new_value#>>'{}','uuid') THEN (e.new_value#>>'{}')::uuid END AS stage
  FROM public.deal_events e JOIN public.boards b ON b.id::text=e.detail->>'board_id' AND b.organization_id=e.organization_id
  WHERE e.kind='created' OR (e.kind='stage' AND e.detail->>'old_board_id' IS DISTINCT FROM e.detail->>'board_id')
  UNION ALL
  SELECT e.*,b.id,'left_board',CASE WHEN pg_catalog.pg_input_is_valid(e.old_value#>>'{}','uuid') THEN (e.old_value#>>'{}')::uuid END
  FROM public.deal_events e JOIN public.boards b ON b.id::text=e.detail->>'old_board_id' AND b.organization_id=e.organization_id
  WHERE e.kind='stage' AND e.detail->>'old_board_id' IS DISTINCT FROM e.detail->>'board_id'
)
SELECT crm_internal.append_deal_lifecycle_event(d,e.historical_board,e.event_type,e.created_at,
  'history','current','deal_event:'||e.id::text||':'||e.event_type,e.stage,false,false,NULL,NULL)
FROM board_evidence e JOIN public.deals d ON d.id=e.deal_id AND d.organization_id=e.organization_id
WHERE e.created_at BETWEEN d.created_at AND now();

-- An audit outcome's board is established by a dated stage/creation record;
-- absent one, a later transfer's old board can locate the earlier outcome.
-- Ambiguous simultaneous records on different boards are deliberately skipped.
WITH positions AS (
  SELECT organization_id,deal_id,board_id,to_stage_id AS stage_id,occurred_at FROM public.deal_stage_events
  UNION ALL
  SELECT e.organization_id,e.deal_id,b.id,
    CASE WHEN pg_catalog.pg_input_is_valid(e.new_value#>>'{}','uuid') THEN (e.new_value#>>'{}')::uuid END,e.created_at
  FROM public.deal_events e JOIN public.boards b ON b.id::text=e.detail->>'board_id' AND b.organization_id=e.organization_id
  WHERE e.kind IN ('created','stage')
), outcomes AS (
  SELECT e.*,coalesce(previous.board_id,following.board_id,
    CASE WHEN NOT EXISTS (SELECT 1 FROM public.deal_events t WHERE t.deal_id=d.id AND t.organization_id=d.organization_id
      AND t.kind='stage' AND t.detail->>'old_board_id' IS DISTINCT FROM t.detail->>'board_id') THEN d.board_id END) AS historical_board,
    previous.stage_id AS historical_stage,previous.ambiguous
  FROM public.deal_events e JOIN public.deals d ON d.id=e.deal_id AND d.organization_id=e.organization_id
  LEFT JOIN LATERAL (
    SELECT x.board_id,x.stage_id,EXISTS (SELECT 1 FROM positions tie WHERE tie.deal_id=x.deal_id
      AND tie.organization_id=x.organization_id AND tie.occurred_at=x.occurred_at AND tie.board_id<>x.board_id) AS ambiguous
    FROM positions x
    WHERE x.deal_id=e.deal_id AND x.organization_id=e.organization_id AND x.occurred_at<=e.created_at
    ORDER BY x.occurred_at DESC,x.board_id LIMIT 1
  ) previous ON true
  LEFT JOIN LATERAL (
    SELECT b.id AS board_id FROM public.deal_events t JOIN public.boards b
      ON b.id::text=t.detail->>'old_board_id' AND b.organization_id=t.organization_id
    WHERE t.deal_id=e.deal_id AND t.organization_id=e.organization_id AND t.kind='stage'
      AND t.created_at>e.created_at AND t.detail->>'old_board_id' IS DISTINCT FROM t.detail->>'board_id'
    ORDER BY t.created_at,t.id LIMIT 1
  ) following ON true
  WHERE e.kind IN ('won','lost','reopened') AND coalesce(e.detail->>'updated','false')<>'true'
    AND e.created_at BETWEEN d.created_at AND now()
)
SELECT crm_internal.append_deal_lifecycle_event(d,e.historical_board,e.kind,e.created_at,
  'history','current','deal_event:'||e.id::text||':'||e.kind,e.historical_stage,
  e.kind='won',e.kind='lost',CASE WHEN e.kind='lost' THEN e.detail->>'category' END,
  CASE WHEN e.kind='lost' THEN e.detail->>'reason' END)
FROM outcomes e JOIN public.deals d ON d.id=e.deal_id WHERE e.historical_board IS NOT NULL AND NOT coalesce(e.ambiguous,false);

-- Older stage events predate the richer audit log. A recorded arrival in an
-- explicitly configured outcome stage also proves that outcome at that time.
-- It does not prove the historical loss reason, so leave that detail absent.
WITH arrivals AS (
  SELECT e.*,CASE WHEN dest.won THEN 'won' ELSE 'lost' END AS outcome
  FROM public.deal_stage_events e
  CROSS JOIN LATERAL crm_internal.deal_stage_rules(e.board_id,e.organization_id,e.to_stage_id) dest
  LEFT JOIN LATERAL crm_internal.deal_stage_rules(e.board_id,e.organization_id,e.from_stage_id) origin ON true
  WHERE (dest.won AND NOT coalesce(origin.won,false)) OR (dest.lost AND NOT coalesce(origin.lost,false))
)
SELECT crm_internal.append_deal_lifecycle_event(d,e.board_id,e.outcome,e.occurred_at,
  'history','current','stage:'||e.id::text||':'||e.outcome,e.to_stage_id,e.outcome='won',e.outcome='lost',NULL,NULL)
FROM arrivals e JOIN public.deals d ON d.id=e.deal_id AND d.organization_id=e.organization_id
WHERE e.occurred_at BETWEEN d.created_at AND now()
  AND NOT EXISTS (SELECT 1 FROM public.deal_lifecycle_events existing WHERE existing.deal_id=e.deal_id
    AND existing.board_id=e.board_id AND existing.event_type=e.outcome AND existing.occurred_at=e.occurred_at);

-- Current persisted closure is dated evidence, not proof of older episodes.
-- Only fill a missing current closure; never replace an existing outcome event.
SELECT crm_internal.append_deal_lifecycle_event(d,d.board_id,CASE WHEN d.is_won THEN 'won' ELSE 'lost' END,d.closed_at,
  'history','current','closed_at:'||d.id::text,d.stage_id,d.is_won,d.is_lost,d.loss_category,d.loss_reason)
FROM public.deals d WHERE d.board_id IS NOT NULL AND d.is_won<>d.is_lost
  AND d.closed_at BETWEEN d.created_at AND now()
  AND NOT EXISTS (SELECT 1 FROM public.deal_lifecycle_events e WHERE e.deal_id=d.id AND e.board_id=d.board_id
    AND e.event_type=CASE WHEN d.is_won THEN 'won' ELSE 'lost' END AND e.occurred_at=d.closed_at)
  AND NOT EXISTS (SELECT 1 FROM public.deal_events t WHERE t.deal_id=d.id AND t.organization_id=d.organization_id
    AND t.kind='stage' AND t.detail->>'old_board_id' IS DISTINCT FROM t.detail->>'board_id' AND t.created_at>d.closed_at);

CREATE OR REPLACE FUNCTION crm_internal.sync_deal_lifecycle_dates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record; q record; moved boolean; board_changed boolean; previous_closed boolean; outcome_changed boolean; origin_qualifies boolean;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  SELECT * INTO r FROM crm_internal.deal_stage_rules(NEW.board_id,NEW.organization_id,NEW.stage_id);
  moved := TG_OP='INSERT'; board_changed := TG_OP='INSERT';
  previous_closed := false; outcome_changed := true;
  IF TG_OP='UPDATE' THEN
    board_changed := NEW.board_id IS DISTINCT FROM OLD.board_id;
    moved := NEW.stage_id IS DISTINCT FROM OLD.stage_id OR board_changed;
    previous_closed := coalesce(OLD.is_won,false) OR coalesce(OLD.is_lost,false);
    outcome_changed := NEW.is_won IS DISTINCT FROM OLD.is_won OR NEW.is_lost IS DISTINCT FROM OLD.is_lost;
    NEW.qualified_at := CASE WHEN NOT board_changed THEN OLD.qualified_at END;
    NEW.qualification_date_source := CASE WHEN NOT board_changed THEN OLD.qualification_date_source END;
    IF OLD.stage_id IS NULL THEN origin_qualifies := false;
    ELSE SELECT qualifies INTO origin_qualifies FROM crm_internal.deal_stage_rules(OLD.board_id,OLD.organization_id,OLD.stage_id);
    END IF;
    IF NOT moved THEN NEW.last_stage_change_date := OLD.last_stage_change_date; END IF;
  ELSE
    NEW.qualified_at := NULL; NEW.qualification_date_source := NULL;
  END IF;
  IF moved THEN
    NEW.last_stage_change_date := now();
    IF coalesce(r.won,false) THEN NEW.is_won := true; NEW.is_lost := false;
    ELSIF coalesce(r.lost,false) THEN NEW.is_won := false; NEW.is_lost := true;
    ELSIF TG_OP='UPDATE' AND previous_closed AND NOT outcome_changed THEN NEW.is_won := false; NEW.is_lost := false;
    END IF;
    -- Restore the first witnessed qualification on re-entry to the same board.
    SELECT e.occurred_at,e.source INTO q FROM public.deal_lifecycle_events e
      WHERE e.deal_id=NEW.id AND e.organization_id=NEW.organization_id AND e.board_id=NEW.board_id
        AND e.event_type='qualified' ORDER BY e.occurred_at LIMIT 1;
    IF FOUND THEN
      NEW.qualified_at := q.occurred_at; NEW.qualification_date_source := q.source;
    ELSIF coalesce(r.qualifies,false) AND (board_changed OR origin_qualifies=false)
      AND (NEW.qualified_at IS NULL OR NEW.qualification_date_source='estimated') THEN
      NEW.qualified_at := now(); NEW.qualification_date_source := 'transition';
    END IF;
  END IF;
  IF NEW.is_won AND NEW.is_lost THEN RAISE EXCEPTION 'O negócio não pode estar ganho e perdido ao mesmo tempo'; END IF;
  IF NEW.is_won OR NEW.is_lost THEN
    IF TG_OP='UPDATE' AND NOT board_changed AND OLD.is_won IS NOT DISTINCT FROM NEW.is_won
      AND OLD.is_lost IS NOT DISTINCT FROM NEW.is_lost THEN NEW.closed_at := OLD.closed_at;
    ELSE NEW.closed_at := now(); END IF;
  ELSE
    NEW.closed_at := NULL; NEW.loss_category := NULL; NEW.loss_reason := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION crm_internal.sync_deal_lifecycle_dates() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION crm_internal.record_deal_lifecycle_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE moved_board boolean; at_time timestamptz := now(); key_base text := 'transition:'||gen_random_uuid()::text;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  moved_board := TG_OP='INSERT';
  IF TG_OP='UPDATE' THEN
    moved_board := NEW.board_id IS DISTINCT FROM OLD.board_id;
    IF moved_board THEN
      PERFORM crm_internal.append_deal_lifecycle_event(OLD,OLD.board_id,'left_board',at_time,
        'transition','transition',key_base||':left_board',OLD.stage_id,OLD.is_won,OLD.is_lost,OLD.loss_category,OLD.loss_reason);
    ELSIF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
      -- Every actual arrival needs its own snapshot. An earlier entry/qualifier
      -- snapshot cannot prove which owner/products applied to this later visit.
      PERFORM crm_internal.append_deal_lifecycle_event(NEW,NEW.board_id,'stage_changed',at_time,
        'transition','transition',key_base||':stage_changed',NEW.stage_id,NEW.is_won,NEW.is_lost,NEW.loss_category,NEW.loss_reason);
    END IF;
  END IF;
  IF moved_board THEN
    PERFORM crm_internal.append_deal_lifecycle_event(NEW,NEW.board_id,'entered_board',at_time,
      'transition','transition',key_base||':entered_board',NEW.stage_id,NEW.is_won,NEW.is_lost,NEW.loss_category,NEW.loss_reason);
  END IF;
  IF NEW.qualification_date_source='transition' AND NEW.qualified_at=at_time THEN
    -- Only an observed qualification from this write may create a new event.
    -- Old dates rejected by the scoped backfill cannot sneak in via title edits.
    PERFORM crm_internal.append_deal_lifecycle_event(NEW,NEW.board_id,'qualified',NEW.qualified_at,
      'transition','transition',key_base||':qualified',NEW.stage_id,NEW.is_won,NEW.is_lost,NEW.loss_category,NEW.loss_reason);
  END IF;
  IF NEW.is_won AND (moved_board OR NOT coalesce(OLD.is_won,false)) THEN
    PERFORM crm_internal.append_deal_lifecycle_event(NEW,NEW.board_id,'won',at_time,
      'transition','transition',key_base||':won',NEW.stage_id,true,false,NULL,NULL);
  END IF;
  IF NEW.is_lost AND (moved_board OR NOT coalesce(OLD.is_lost,false)) THEN
    PERFORM crm_internal.append_deal_lifecycle_event(NEW,NEW.board_id,'lost',at_time,
      'transition','transition',key_base||':lost',NEW.stage_id,false,true,NEW.loss_category,NEW.loss_reason);
  END IF;
  IF TG_OP='UPDATE' AND (OLD.is_won OR OLD.is_lost) AND NOT NEW.is_won AND NOT NEW.is_lost THEN
    PERFORM crm_internal.append_deal_lifecycle_event(NEW,NEW.board_id,'reopened',at_time,
      'transition','transition',key_base||':reopened',NEW.stage_id,false,false,NULL,NULL);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION crm_internal.record_deal_lifecycle_events() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER record_deal_lifecycle_events AFTER INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION crm_internal.record_deal_lifecycle_events();

COMMENT ON COLUMN public.deals.qualified_at IS 'First evidenced qualification in the current board; lifecycle history preserves it across transfers and returns. Estimated legacy values are not dated conversion evidence.';
NOTIFY pgrst, 'reload schema';
