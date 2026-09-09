-- Immutable stage events: independent of UI activity writes and webhook rules.
CREATE SCHEMA IF NOT EXISTS crm_internal;
REVOKE ALL ON SCHEMA crm_internal FROM PUBLIC;

CREATE TABLE public.deal_stage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  board_id uuid NOT NULL,
  from_stage_id uuid,
  to_stage_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deal_stage_events_scope_idx ON public.deal_stage_events (organization_id, deal_id, occurred_at);
ALTER TABLE public.deal_stage_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deal_stage_events FROM anon, authenticated;
GRANT SELECT ON public.deal_stage_events TO authenticated;
GRANT ALL ON public.deal_stage_events TO service_role;
CREATE POLICY deal_stage_events_visible_deals ON public.deal_stage_events
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_stage_events.deal_id
      AND d.organization_id = deal_stage_events.organization_id AND d.deleted_at IS NULL)
  );

-- Definer is restricted to a private trigger so clients cannot forge history.
-- The original deal INSERT/UPDATE still passes its own RLS before this runs.
CREATE OR REPLACE FUNCTION crm_internal.record_deal_stage_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.stage_id IS NULL OR NEW.board_id IS NULL OR NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id AND NEW.board_id IS NOT DISTINCT FROM OLD.board_id THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.deal_stage_events(organization_id,deal_id,board_id,from_stage_id,to_stage_id,occurred_at)
    VALUES(NEW.organization_id,NEW.id,NEW.board_id,
      CASE WHEN NEW.board_id = OLD.board_id THEN OLD.stage_id ELSE NULL END,NEW.stage_id,now());
  ELSE
    INSERT INTO public.deal_stage_events(organization_id,deal_id,board_id,to_stage_id,occurred_at)
    VALUES(NEW.organization_id,NEW.id,NEW.board_id,NEW.stage_id,now());
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION crm_internal.record_deal_stage_event() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER record_deal_stage_event AFTER INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION crm_internal.record_deal_stage_event();
COMMENT ON TABLE public.deal_stage_events IS 'Stage arrivals recorded at write time. No inferred historical backfill.';
