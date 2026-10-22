-- Prospective only: advancing confirms the preceding stages of this process.
-- No UPDATE/backfill of operational deals or existing history is performed.
-- A completion is separate from a physical arrival, so skipped stages never
-- fire their automations, webhooks or follow-ups.
ALTER TABLE public.deal_lifecycle_events DROP CONSTRAINT IF EXISTS deal_lifecycle_events_event_type_check;
ALTER TABLE public.deal_lifecycle_events ADD CONSTRAINT deal_lifecycle_events_event_type_check
  CHECK (event_type IN ('entered_board','left_board','stage_changed','stage_completed','qualified','won','lost','reopened'));
CREATE UNIQUE INDEX IF NOT EXISTS deal_lifecycle_events_stage_completed_idx
  ON public.deal_lifecycle_events (organization_id,deal_id,board_id,stage_id) WHERE event_type='stage_completed';

CREATE OR REPLACE FUNCTION crm_internal.is_forward_stage_move(p_board uuid,p_org uuid,p_origin uuid,p_target uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT NOT coalesce(r.lost,false)
    AND (p_origin IS NULL OR coalesce(origin_rules.lost,false) OR target."order">origin."order")
    FROM public.boards b
    JOIN public.board_stages target ON target.board_id=b.id AND target.organization_id=b.organization_id AND target.id=p_target
    LEFT JOIN public.board_stages origin ON origin.board_id=b.id AND origin.organization_id=b.organization_id AND origin.id=p_origin
    LEFT JOIN LATERAL crm_internal.deal_stage_rules(b.id,b.organization_id,origin.id) origin_rules ON true
    CROSS JOIN LATERAL crm_internal.deal_stage_rules(b.id,b.organization_id,target.id) r
    WHERE b.id=p_board AND b.organization_id=p_org),false);
$$;
REVOKE ALL ON FUNCTION crm_internal.is_forward_stage_move(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION crm_internal.sync_deal_lifecycle_dates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record; prior_rules record; q record; last_result record; moved boolean; board_changed boolean;
  previous_closed boolean; outcome_changed boolean; origin_qualifies boolean; old_phase boolean:=false; target_phase boolean;
  requested_reopen boolean:=false; requested_loss boolean:=false; advancing boolean:=false;
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
    requested_reopen := NOT board_changed AND previous_closed AND NOT NEW.is_won AND NOT NEW.is_lost AND outcome_changed;
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
    advancing := moved AND crm_internal.is_forward_stage_move(NEW.board_id,NEW.organization_id,
      CASE WHEN board_changed THEN NULL ELSE OLD.stage_id END,NEW.stage_id);
  ELSE
    requested_loss := NEW.is_lost;
    NEW.qualified_at := NULL; NEW.qualification_date_source := NULL;
    advancing := crm_internal.is_forward_stage_move(NEW.board_id,NEW.organization_id,NULL,NEW.stage_id);
  END IF;
  IF moved THEN
    NEW.last_stage_change_date := now();
    IF requested_loss THEN NEW.is_won := false; NEW.is_lost := true;
    ELSIF requested_reopen THEN NEW.is_won := false; NEW.is_lost := false;
    ELSIF coalesce(r.lost,false) THEN NEW.is_won := false; NEW.is_lost := true;
    ELSIF coalesce(r.won,false) OR (advancing AND target_phase) THEN
      NEW.is_won := true; NEW.is_lost := false;
      restore_win := old_phase AND NOT episode_open AND
        (coalesce(OLD.is_won,false) OR coalesce(prior_rules.won,false) OR coalesce(last_result.event_type='won',false));
      fresh_win := NOT restore_win AND (TG_OP='INSERT' OR board_changed OR NOT coalesce(OLD.is_won,false) OR episode_open);
    ELSIF TG_OP='UPDATE' AND NOT board_changed AND target_phase
      AND (OLD.is_won OR (old_phase AND NOT episode_open AND
        (coalesce(prior_rules.won,false) OR last_result.event_type='won'))) THEN
      NEW.is_won := true; NEW.is_lost := false; restore_win := true;
    ELSIF TG_OP='UPDATE' AND previous_closed AND NOT outcome_changed THEN NEW.is_won := false; NEW.is_lost := false;
    END IF;
    -- Keep the first known qualification; moving again does not re-date it.
    SELECT e.occurred_at,e.source INTO q FROM public.deal_lifecycle_events e
      WHERE e.deal_id=NEW.id AND e.organization_id=NEW.organization_id AND e.board_id=NEW.board_id
        AND e.event_type='qualified' ORDER BY e.occurred_at LIMIT 1;
    IF (NEW.qualified_at IS NULL OR NEW.qualification_date_source='estimated') AND FOUND THEN
      NEW.qualified_at := q.occurred_at; NEW.qualification_date_source := q.source;
    ELSIF (NEW.qualified_at IS NULL OR NEW.qualification_date_source='estimated') AND coalesce(r.qualifies,false)
      AND NOT NEW.is_lost AND NOT requested_reopen
      AND (advancing OR board_changed OR origin_qualifies=false) THEN
      NEW.qualified_at := now(); NEW.qualification_date_source := 'transition';
    END IF;
  END IF;
  IF NEW.is_won AND NEW.is_lost THEN RAISE EXCEPTION 'O negócio não pode estar ganho e perdido ao mesmo tempo'; END IF;
  IF NEW.is_won OR NEW.is_lost THEN
    IF fresh_win THEN NEW.closed_at := now();
    ELSIF restore_win THEN
      NEW.closed_at := CASE
        WHEN TG_OP='UPDATE' AND NOT board_changed AND OLD.closed_at BETWEEN OLD.created_at AND now() THEN OLD.closed_at
        WHEN last_result.event_type='won' THEN last_result.occurred_at
        WHEN advancing THEN now() END;
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

CREATE OR REPLACE FUNCTION crm_internal.record_deal_stage_completions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE origin uuid; stage record; at_time timestamptz:=now(); board_changed boolean;
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.is_lost THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    board_changed := NEW.board_id IS DISTINCT FROM OLD.board_id;
    IF NOT board_changed AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN RETURN NEW; END IF;
    -- An explicit reopen starts another episode, not confirmation of a prefix.
    IF NOT board_changed AND (OLD.is_won OR OLD.is_lost) AND NOT NEW.is_won AND NOT NEW.is_lost THEN RETURN NEW; END IF;
    origin := CASE WHEN board_changed THEN NULL ELSE OLD.stage_id END;
  END IF;
  IF NOT crm_internal.is_forward_stage_move(NEW.board_id,NEW.organization_id,origin,NEW.stage_id) THEN RETURN NEW; END IF;
  FOR stage IN
    SELECT prior.id FROM public.board_stages prior
    JOIN public.board_stages target ON target.board_id=prior.board_id AND target.organization_id=prior.organization_id AND target.id=NEW.stage_id
    CROSS JOIN LATERAL crm_internal.deal_stage_rules(prior.board_id,prior.organization_id,prior.id) rules
    WHERE prior.board_id=NEW.board_id AND prior.organization_id=NEW.organization_id
      AND prior."order"<target."order" AND NOT coalesce(rules.lost,false)
      AND NOT EXISTS (SELECT 1 FROM public.deal_lifecycle_events e
        WHERE e.organization_id=NEW.organization_id AND e.board_id=NEW.board_id AND e.deal_id=NEW.id
          AND e.stage_id=prior.id AND e.event_type IN ('entered_board','stage_changed','stage_completed','qualified','won')
          AND e.occurred_at BETWEEN NEW.created_at AND at_time)
      AND NOT EXISTS (SELECT 1 FROM public.deal_stage_events e
        WHERE e.organization_id=NEW.organization_id AND e.board_id=NEW.board_id AND e.deal_id=NEW.id
          AND e.to_stage_id=prior.id AND e.occurred_at BETWEEN NEW.created_at AND at_time)
    ORDER BY prior."order",prior.id
  LOOP
    PERFORM crm_internal.append_deal_lifecycle_event(NEW,NEW.board_id,'stage_completed',at_time,
      'transition','transition','cumulative:'||NEW.organization_id::text||':'||NEW.id::text||':'||NEW.board_id::text||':'||stage.id::text,
      stage.id,NEW.is_won,NEW.is_lost,NULL,NULL);
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION crm_internal.record_deal_stage_completions() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS record_deal_stage_completions ON public.deals;
CREATE TRIGGER record_deal_stage_completions AFTER INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION crm_internal.record_deal_stage_completions();
COMMENT ON FUNCTION crm_internal.record_deal_stage_completions() IS
  'Prospective process completion on forward moves only. Records missing preceding stages without moving the deal or dispatching their automations.';
