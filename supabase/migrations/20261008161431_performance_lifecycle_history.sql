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
    CASE WHEN s.board_lifecycle IS NOT DISTINCT FROM 'CUSTOMER' THEN coalesce(s.id=s.won_stage_id,false)
      ELSE s.linked_lifecycle_stage IS NOT DISTINCT FROM 'CUSTOMER' END,
    CASE WHEN s.lost_stage_id IS NOT NULL THEN s.id=s.lost_stage_id
      ELSE s.linked_lifecycle_stage IS NOT DISTINCT FROM 'OTHER' END,
    s."order"=t.q
  FROM stages s CROSS JOIN threshold t WHERE s.id=p_stage;
$$;
REVOKE ALL ON FUNCTION crm_internal.deal_stage_rules(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Promotion is the CUSTOMER identity, never its display name or the manual-win
-- shortcut. Later operational stages preserve an existing win but cannot prove
-- the date of the original promotion (e.g. a direct jump to Protocolado).
CREATE FUNCTION crm_internal.deal_customer_phase(p_board uuid,p_org uuid,p_stage uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT b.linked_lifecycle_stage IS DISTINCT FROM 'CUSTOMER'
    AND s."order">=(SELECT min(c."order") FROM public.board_stages c
      WHERE c.board_id=b.id AND c.organization_id=p_org AND c.linked_lifecycle_stage='CUSTOMER')
    AND NOT (CASE WHEN b.lost_stage_id IS NOT NULL THEN s.id=b.lost_stage_id ELSE s.linked_lifecycle_stage IS NOT DISTINCT FROM 'OTHER' END)
    FROM public.boards b JOIN public.board_stages s ON s.board_id=b.id AND s.organization_id=p_org
    WHERE b.id=p_board AND b.organization_id=p_org AND s.id=p_stage),false);
$$;
REVOKE ALL ON FUNCTION crm_internal.deal_customer_phase(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.deal_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  -- IDs are deliberately snapshots, not stage/board FKs: editing/removing stages
  -- must not rewrite recorded outcomes. Visibility still follows the current deal.
  board_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('entered_board','left_board','stage_changed','qualified','won','lost','reopened')),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
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
CREATE TEMP TABLE performance_history_outcomes AS
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
SELECT * FROM outcomes e WHERE historical_board IS NOT NULL AND NOT coalesce(ambiguous,false)
  -- The old Protocolado rule reopened a deal when returning to another stage in
  -- the same CUSTOMER phase. That automatic artifact is not an explicit reopen.
  AND NOT (e.kind='reopened' AND EXISTS (
    SELECT 1 FROM public.deal_stage_events s WHERE s.deal_id=e.deal_id AND s.organization_id=e.organization_id
      AND s.board_id=e.historical_board AND s.occurred_at=e.created_at
      AND crm_internal.deal_customer_phase(s.board_id,s.organization_id,s.from_stage_id)
      AND crm_internal.deal_customer_phase(s.board_id,s.organization_id,s.to_stage_id)));

SELECT crm_internal.append_deal_lifecycle_event(d,e.historical_board,e.kind,e.created_at,
  'history','current','deal_event:'||e.id::text||':'||e.kind,e.historical_stage,
  e.kind='won',e.kind='lost',CASE WHEN e.kind='lost' THEN e.detail->>'category' END,
  CASE WHEN e.kind='lost' THEN e.detail->>'reason' END)
FROM performance_history_outcomes e JOIN public.deals d ON d.id=e.deal_id WHERE e.kind IN ('lost','reopened');

-- Older stage events predate the richer audit log. A recorded arrival in an
-- explicitly configured outcome stage also proves that outcome at that time.
-- It does not prove the historical loss reason, so leave that detail absent.
WITH arrivals AS (
  SELECT e.*,CASE WHEN dest.won THEN 'won' ELSE 'lost' END AS outcome
  FROM public.deal_stage_events e
  CROSS JOIN LATERAL crm_internal.deal_stage_rules(e.board_id,e.organization_id,e.to_stage_id) dest
  LEFT JOIN LATERAL crm_internal.deal_stage_rules(e.board_id,e.organization_id,e.from_stage_id) origin ON true
  WHERE dest.lost AND NOT coalesce(origin.lost,false)
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
FROM public.deals d WHERE d.board_id IS NOT NULL AND d.is_lost AND NOT d.is_won
  AND d.closed_at BETWEEN d.created_at AND now()
  AND NOT EXISTS (SELECT 1 FROM public.deal_lifecycle_events e WHERE e.deal_id=d.id AND e.board_id=d.board_id
    AND e.event_type=CASE WHEN d.is_won THEN 'won' ELSE 'lost' END AND e.occurred_at=d.closed_at)
  AND NOT EXISTS (SELECT 1 FROM public.deal_events t WHERE t.deal_id=d.id AND t.organization_id=d.organization_id
    AND t.kind='stage' AND t.detail->>'old_board_id' IS DISTINCT FROM t.detail->>'board_id' AND t.created_at>d.closed_at);

-- Normalize commercial wins BEFORE the ledger is exposed. Old automatic wins at
-- the Protocolado shortcut are not evidence of when CUSTOMER was first reached.
-- Every evidenced re-open/loss/regression/board exit starts another episode.
WITH arrivals AS (
  SELECT e.organization_id,e.deal_id,e.board_id,e.to_stage_id AS stage_id,e.from_stage_id,
    e.occurred_at,'stage:'||e.id::text AS evidence_key
  FROM public.deal_stage_events e
  UNION ALL
  SELECT e.organization_id,e.deal_id,b.id,
    CASE WHEN pg_catalog.pg_input_is_valid(e.new_value#>>'{}','uuid') THEN (e.new_value#>>'{}')::uuid END,
    CASE WHEN e.kind='stage' AND e.detail->>'old_board_id'=e.detail->>'board_id'
      AND pg_catalog.pg_input_is_valid(e.old_value#>>'{}','uuid') THEN (e.old_value#>>'{}')::uuid END,
    e.created_at,'audit_stage:'||e.id::text
  FROM public.deal_events e JOIN public.boards b ON b.id::text=e.detail->>'board_id' AND b.organization_id=e.organization_id
  WHERE e.kind IN ('created','stage')
  UNION ALL
  SELECT e.organization_id,e.deal_id,b.id,e.to_stage_id,e.from_stage_id,
    CASE WHEN pg_catalog.pg_input_is_valid(e.payload->>'occurred_at','timestamp with time zone')
      THEN (e.payload->>'occurred_at')::timestamptz ELSE e.created_at END,'webhook:'||e.id::text
  FROM public.webhook_events_out e JOIN public.boards b ON b.id::text=e.payload->'deal'->>'board_id' AND b.organization_id=e.organization_id
  WHERE e.event_type IN ('deal.created','deal.stage_changed')
), resets AS (
  SELECT organization_id,deal_id,board_id,occurred_at FROM public.deal_lifecycle_events
  WHERE event_type IN ('lost','reopened','left_board')
  UNION ALL
  SELECT a.organization_id,a.deal_id,a.board_id,a.occurred_at FROM arrivals a
  JOIN public.boards b ON b.id=a.board_id AND b.organization_id=a.organization_id
  JOIN public.board_stages s ON s.id=a.stage_id AND s.board_id=a.board_id AND s.organization_id=a.organization_id
  WHERE CASE WHEN b.linked_lifecycle_stage='CUSTOMER'
    THEN s.id IS DISTINCT FROM b.won_stage_id
    ELSE NOT crm_internal.deal_customer_phase(a.board_id,a.organization_id,a.stage_id) END
), candidates AS (
  SELECT a.*,0 AS priority FROM arrivals a
  JOIN public.boards b ON b.id=a.board_id AND b.organization_id=a.organization_id
  CROSS JOIN LATERAL crm_internal.deal_stage_rules(a.board_id,a.organization_id,a.stage_id) dest
  LEFT JOIN LATERAL crm_internal.deal_stage_rules(a.board_id,a.organization_id,a.from_stage_id) origin ON true
  CROSS JOIN LATERAL (SELECT max(r.occurred_at) AS at FROM resets r WHERE r.organization_id=a.organization_id
    AND r.deal_id=a.deal_id AND r.board_id=a.board_id AND r.occurred_at<a.occurred_at) last_reset
  WHERE dest.won AND CASE WHEN b.linked_lifecycle_stage='CUSTOMER' THEN NOT coalesce(origin.won,false)
    ELSE (NOT coalesce(origin.won,false)
      OR EXISTS (SELECT 1 FROM public.deal_lifecycle_events r WHERE r.deal_id=a.deal_id AND r.board_id=a.board_id
        AND r.event_type='reopened' AND r.occurred_at=last_reset.at
        AND crm_internal.deal_customer_phase(r.board_id,r.organization_id,r.stage_id)))
      AND NOT EXISTS (SELECT 1 FROM arrivals earlier WHERE earlier.deal_id=a.deal_id AND earlier.organization_id=a.organization_id
        AND earlier.board_id=a.board_id AND earlier.occurred_at<a.occurred_at
        AND earlier.occurred_at>coalesce(last_reset.at,'-infinity'::timestamptz)
        AND EXISTS (SELECT 1 FROM public.board_stages prior_customer WHERE prior_customer.board_id=a.board_id
          AND prior_customer.organization_id=a.organization_id AND prior_customer.linked_lifecycle_stage='CUSTOMER'
          AND prior_customer.id IN (earlier.stage_id,earlier.from_stage_id))) END
  UNION ALL
  SELECT e.organization_id,e.deal_id,e.historical_board,e.historical_stage,NULL,e.created_at,'audit_won:'||e.id::text,1
  FROM performance_history_outcomes e JOIN public.boards b ON b.id=e.historical_board AND b.organization_id=e.organization_id
  LEFT JOIN public.board_stages shortcut ON shortcut.id=b.won_stage_id AND shortcut.organization_id=b.organization_id
  LEFT JOIN public.board_stages actual ON actual.id=e.historical_stage AND actual.organization_id=b.organization_id
  WHERE e.kind='won' AND (b.linked_lifecycle_stage='CUSTOMER' OR (actual.linked_lifecycle_stage='CUSTOMER'
      AND (actual.id IS DISTINCT FROM b.won_stage_id OR actual."order"=(SELECT min(c."order") FROM public.board_stages c
        WHERE c.board_id=b.id AND c.organization_id=b.organization_id AND c.linked_lifecycle_stage='CUSTOMER')))
    OR (e.historical_stage IS NOT NULL AND e.historical_stage IS DISTINCT FROM b.won_stage_id)
    OR (e.historical_stage IS NULL AND shortcut.linked_lifecycle_stage='CUSTOMER' AND shortcut."order"=(SELECT min(c."order") FROM public.board_stages c
      WHERE c.board_id=b.id AND c.organization_id=b.organization_id AND c.linked_lifecycle_stage='CUSTOMER')))
    AND (b.linked_lifecycle_stage='CUSTOMER' OR NOT EXISTS (SELECT 1 FROM arrivals a WHERE a.deal_id=e.deal_id
      AND a.organization_id=e.organization_id AND a.board_id=e.historical_board AND a.occurred_at=e.created_at
      AND crm_internal.deal_customer_phase(a.board_id,a.organization_id,a.from_stage_id)
      AND crm_internal.deal_customer_phase(a.board_id,a.organization_id,a.stage_id)))
  UNION ALL
  SELECT d.organization_id,d.id,d.board_id,d.stage_id,NULL,d.closed_at,'closed_at:'||d.id::text,2
  FROM public.deals d JOIN public.boards b ON b.id=d.board_id AND b.organization_id=d.organization_id
  LEFT JOIN public.board_stages shortcut ON shortcut.id=b.won_stage_id AND shortcut.organization_id=b.organization_id
  WHERE d.is_won AND NOT d.is_lost AND (b.linked_lifecycle_stage='CUSTOMER' OR (shortcut.linked_lifecycle_stage='CUSTOMER'
    AND shortcut."order"=(SELECT min(c."order") FROM public.board_stages c
      WHERE c.board_id=b.id AND c.organization_id=b.organization_id AND c.linked_lifecycle_stage='CUSTOMER')))
    AND (b.linked_lifecycle_stage='CUSTOMER' OR NOT EXISTS (SELECT 1 FROM arrivals a WHERE a.deal_id=d.id
      AND a.organization_id=d.organization_id AND a.board_id=d.board_id AND a.occurred_at=d.closed_at
      AND crm_internal.deal_customer_phase(a.board_id,a.organization_id,a.from_stage_id)
      AND crm_internal.deal_customer_phase(a.board_id,a.organization_id,a.stage_id)))
    AND NOT EXISTS (SELECT 1 FROM public.deal_events t WHERE t.deal_id=d.id AND t.organization_id=d.organization_id
      AND t.kind='stage' AND t.detail->>'old_board_id' IS DISTINCT FROM t.detail->>'board_id' AND t.created_at>d.closed_at)
), episodes AS (
  SELECT c.*, (SELECT max(r.occurred_at) FROM resets r WHERE r.organization_id=c.organization_id
    AND r.deal_id=c.deal_id AND r.board_id=c.board_id AND r.occurred_at<c.occurred_at) AS episode_start
  FROM candidates c JOIN public.deals d ON d.id=c.deal_id AND d.organization_id=c.organization_id
  WHERE c.occurred_at BETWEEN d.created_at AND now()
), first_wins AS (
  SELECT DISTINCT ON (organization_id,deal_id,board_id,episode_start) * FROM episodes
  ORDER BY organization_id,deal_id,board_id,episode_start,occurred_at,priority,evidence_key
)
SELECT crm_internal.append_deal_lifecycle_event(d,e.board_id,'won',e.occurred_at,'history','current',
  e.evidence_key||':won',e.stage_id,true,false,NULL,NULL)
FROM first_wins e JOIN public.deals d ON d.id=e.deal_id;
DROP TABLE performance_history_outcomes;

CREATE OR REPLACE FUNCTION crm_internal.sync_deal_lifecycle_dates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record; prior_rules record; q record; last_result record; moved boolean; board_changed boolean;
  previous_closed boolean; outcome_changed boolean; origin_qualifies boolean; old_phase boolean:=false; target_phase boolean;
  requested_reopen boolean:=false; requested_loss boolean:=false;
  restore_win boolean:=false; fresh_win boolean:=false; episode_open boolean:=false;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  SELECT false AS won INTO prior_rules;
  SELECT NULL::text AS event_type,NULL::timestamptz AS occurred_at INTO last_result;
  SELECT * INTO r FROM crm_internal.deal_stage_rules(NEW.board_id,NEW.organization_id,NEW.stage_id);
  target_phase := crm_internal.deal_customer_phase(NEW.board_id,NEW.organization_id,NEW.stage_id);
  moved := TG_OP='INSERT'; board_changed := TG_OP='INSERT';
  previous_closed := false; outcome_changed := true;
  IF TG_OP='UPDATE' THEN
    board_changed := NEW.board_id IS DISTINCT FROM OLD.board_id;
    moved := NEW.stage_id IS DISTINCT FROM OLD.stage_id OR board_changed;
    previous_closed := coalesce(OLD.is_won,false) OR coalesce(OLD.is_lost,false);
    outcome_changed := NEW.is_won IS DISTINCT FROM OLD.is_won OR NEW.is_lost IS DISTINCT FROM OLD.is_lost;
    requested_reopen := previous_closed AND NOT NEW.is_won AND NOT NEW.is_lost AND outcome_changed;
    requested_loss := NEW.is_lost AND NOT OLD.is_lost;
    old_phase := NOT board_changed AND crm_internal.deal_customer_phase(OLD.board_id,OLD.organization_id,OLD.stage_id);
    SELECT * INTO prior_rules FROM crm_internal.deal_stage_rules(OLD.board_id,OLD.organization_id,OLD.stage_id);
    SELECT e.event_type,e.occurred_at INTO last_result FROM public.deal_lifecycle_events e
      WHERE e.deal_id=NEW.id AND e.organization_id=NEW.organization_id AND e.board_id=NEW.board_id
        AND e.event_type IN ('won','lost','reopened','left_board')
      ORDER BY e.occurred_at DESC,e.recorded_at DESC LIMIT 1;
    episode_open := coalesce(last_result.event_type IN ('lost','reopened','left_board'),false);
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
    IF requested_loss THEN NEW.is_won := false; NEW.is_lost := true;
    ELSIF requested_reopen THEN NEW.is_won := false; NEW.is_lost := false;
    ELSIF coalesce(r.lost,false) THEN NEW.is_won := false; NEW.is_lost := true;
    ELSIF coalesce(r.won,false) THEN
      NEW.is_won := true; NEW.is_lost := false;
      -- Existing CUSTOMER phase is not another conversion. Even a legacy false
      -- flag is normalized without dating the old signature at today's move.
      restore_win := old_phase AND NOT episode_open AND
        (coalesce(OLD.is_won,false) OR coalesce(prior_rules.won,false) OR coalesce(last_result.event_type='won',false));
      fresh_win := NOT restore_win AND (TG_OP='INSERT' OR board_changed OR NOT coalesce(OLD.is_won,false) OR episode_open);
    ELSIF TG_OP='UPDATE' AND NOT board_changed AND target_phase
      AND (OLD.is_won OR (old_phase AND NOT episode_open AND
        (coalesce(prior_rules.won,false) OR last_result.event_type='won'))) THEN
      NEW.is_won := true; NEW.is_lost := false; restore_win := true;
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
    IF fresh_win THEN NEW.closed_at := now();
    ELSIF restore_win THEN
      NEW.closed_at := CASE WHEN last_result.event_type='won' THEN last_result.occurred_at END;
    ELSIF TG_OP='UPDATE' AND NOT board_changed AND OLD.is_won IS NOT DISTINCT FROM NEW.is_won
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
  IF NEW.is_won AND NEW.closed_at=at_time AND (moved_board OR NOT coalesce(OLD.is_won,false) OR NEW.closed_at IS DISTINCT FROM OLD.closed_at) THEN
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
