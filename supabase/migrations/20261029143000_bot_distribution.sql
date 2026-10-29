-- Additive instrumentation. Existing runs/history are deliberately left untouched.
ALTER TABLE public.wa_bot_runs
  ADD COLUMN IF NOT EXISTS flow_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS flow_revision text,
  ADD COLUMN IF NOT EXISTS analytics_version integer,
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS split_subject_key text;

CREATE OR REPLACE FUNCTION public.wa_bot_flow_revision(p_bot jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT md5(jsonb_build_object(
    'steps', COALESCE((SELECT jsonb_agg(s - 'ui' - 'secret' ORDER BY n)
      FROM jsonb_array_elements(COALESCE(p_bot->'steps', '[]'::jsonb)) WITH ORDINALITY AS t(s,n)), '[]'::jsonb),
    'start_step_id', p_bot->'start_step_id',
    'groups', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', g->'id', 'step_ids', g->'step_ids') ORDER BY n)
      FROM jsonb_array_elements(COALESCE(p_bot#>'{layout,groups}', '[]'::jsonb)) WITH ORDINALITY AS t(g,n)), '[]'::jsonb),
    'trigger', COALESCE(p_bot->'trigger', '{}'::jsonb) - 'ui',
    'connection_id', p_bot->'connection_id', 'connection_ids', COALESCE(p_bot->'connection_ids','[]'::jsonb)
  )::text);
$$;
REVOKE ALL ON FUNCTION public.wa_bot_flow_revision(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_bot_flow_revision(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.wa_bot_snapshot_new_run()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.wa_bots%ROWTYPE; snapshot jsonb;
BEGIN
  SELECT * INTO b FROM public.wa_bots WHERE id = NEW.bot_id AND organization_id = NEW.organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bot not found in organization'; END IF;
  snapshot := jsonb_build_object('name',b.name,'enabled',b.enabled,'trigger',b.trigger,
    'connection_id',b.connection_id,'connection_ids',b.connection_ids,
    'start_step_id',b.start_step_id,'layout',b.layout,
    'steps',COALESCE((SELECT jsonb_agg(s - 'secret' ORDER BY n)
      FROM jsonb_array_elements(b.steps) WITH ORDINALITY AS t(s,n)), '[]'::jsonb));
  NEW.flow_snapshot := snapshot;
  NEW.flow_revision := public.wa_bot_flow_revision(snapshot);
  NEW.analytics_version := 1;
  NEW.split_subject_key := NULL;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.wa_bot_snapshot_new_run() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS wa_bot_snapshot_new_run ON public.wa_bot_runs;
CREATE TRIGGER wa_bot_snapshot_new_run BEFORE INSERT ON public.wa_bot_runs
FOR EACH ROW EXECUTE FUNCTION public.wa_bot_snapshot_new_run();

CREATE TABLE IF NOT EXISTS public.wa_bot_events (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bot_id uuid NOT NULL REFERENCES public.wa_bots(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.wa_bot_runs(id) ON DELETE CASCADE,
  step_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('entered','exited','failed','skipped')),
  output_id text,
  target_step_id text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  last_occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, step_id, kind)
);
CREATE INDEX IF NOT EXISTS wa_bot_events_org_bot_idx ON public.wa_bot_events(organization_id,bot_id,run_id);
CREATE INDEX IF NOT EXISTS wa_bot_runs_analytics_idx ON public.wa_bot_runs(organization_id,bot_id,created_at,flow_revision)
  WHERE analytics_version = 1 AND NOT is_test;
ALTER TABLE public.wa_bot_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wa_bot_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.wa_bot_events TO service_role;

CREATE TABLE IF NOT EXISTS public.wa_bot_split_counters (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bot_id uuid NOT NULL REFERENCES public.wa_bots(id) ON DELETE CASCADE,
  revision text NOT NULL,
  step_id text NOT NULL,
  is_test boolean NOT NULL,
  cursor_value bigint NOT NULL DEFAULT 0,
  PRIMARY KEY(organization_id,bot_id,revision,step_id,is_test)
);
CREATE TABLE IF NOT EXISTS public.wa_bot_split_assignments (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bot_id uuid NOT NULL REFERENCES public.wa_bots(id) ON DELETE CASCADE,
  revision text NOT NULL,
  step_id text NOT NULL,
  is_test boolean NOT NULL,
  subject_key text NOT NULL,
  canonical_subject_key text NOT NULL,
  assignment_deal_id uuid,
  branch_id text NOT NULL,
  target_step_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,bot_id,revision,step_id,is_test,subject_key)
);
ALTER TABLE public.wa_bot_split_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_bot_split_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wa_bot_split_counters, public.wa_bot_split_assignments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.wa_bot_split_counters, public.wa_bot_split_assignments TO service_role;

CREATE OR REPLACE FUNCTION public.wa_bot_record_event(
  p_org uuid, p_run uuid, p_step text, p_kind text, p_output text DEFAULT NULL, p_target text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.wa_bot_runs%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.wa_bot_runs WHERE id=p_run AND organization_id=p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Run not found in organization'; END IF;
  IF r.analytics_version IS DISTINCT FROM 1 THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r.flow_snapshot->'steps') s WHERE s->>'id'=p_step)
    THEN RAISE EXCEPTION 'Step not in execution revision'; END IF;
  IF p_target IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r.flow_snapshot->'steps') s WHERE s->>'id'=p_target)
    THEN RAISE EXCEPTION 'Target not in execution revision'; END IF;
  IF p_kind NOT IN ('entered','exited','failed','skipped') THEN RAISE EXCEPTION 'Invalid event kind'; END IF;
  IF p_kind <> 'exited' AND (p_output IS NOT NULL OR p_target IS NOT NULL) THEN RAISE EXCEPTION 'Invalid event output'; END IF;
  INSERT INTO public.wa_bot_events(organization_id,bot_id,run_id,step_id,kind,output_id,target_step_id)
    VALUES(p_org,r.bot_id,p_run,p_step,p_kind,p_output,p_target)
    ON CONFLICT(run_id,step_id,kind) DO UPDATE
      SET last_occurred_at=EXCLUDED.last_occurred_at WHERE EXCLUDED.kind='entered';
END;
$$;
REVOKE ALL ON FUNCTION public.wa_bot_record_event(uuid,uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_bot_record_event(uuid,uuid,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.wa_bot_allocate_branch(p_org uuid,p_run uuid,p_step text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.wa_bot_runs%ROWTYPE; step jsonb; branch jsonb; branch_count integer;
  subject text; aliases text[]; alias_key text; assigned public.wa_bot_split_assignments%ROWTYPE;
  cursor_n bigint; weight_sum integer; pick integer; cumulative integer:=0; target_index integer;
BEGIN
  SELECT * INTO r FROM public.wa_bot_runs WHERE id=p_run AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Run not found in organization'; END IF;
  IF r.analytics_version IS DISTINCT FROM 1 OR r.flow_revision IS NULL THEN RAISE EXCEPTION 'New execution required'; END IF;
  SELECT s INTO step FROM jsonb_array_elements(r.flow_snapshot->'steps') s WHERE s->>'id'=p_step;
  IF step IS NULL OR step->>'type'<>'split' THEN RAISE EXCEPTION 'Invalid distribution step'; END IF;
  branch_count:=jsonb_array_length(step->'branches');
  IF branch_count IS NULL OR branch_count < 2 OR branch_count > 20 OR COALESCE(step->>'mode','') NOT IN ('random','round_robin') THEN RAISE EXCEPTION 'Invalid distribution configuration'; END IF;
  IF (SELECT count(DISTINCT b->>'id') FROM jsonb_array_elements(step->'branches') b) <> branch_count THEN RAISE EXCEPTION 'Duplicate output IDs'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(step->'branches') b WHERE NULLIF(b->>'id','') IS NULL OR NULLIF(b->>'goto_step_id','') IS NULL) THEN RAISE EXCEPTION 'Every output must be connected'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(step->'branches') b
    WHERE jsonb_typeof(b->'weight') IS DISTINCT FROM 'number' OR COALESCE(b->>'weight','') !~ '^[0-9]{1,3}$')
    THEN RAISE EXCEPTION 'Weights must be positive integers'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(step->'branches') b WHERE (b->>'weight')::integer NOT BETWEEN 1 AND 100)
    THEN RAISE EXCEPTION 'Weights must be between 1 and 100'; END IF;
  subject := COALESCE(r.split_subject_key, 'deal:'||r.deal_id::text, 'contact:'||r.contact_id::text, 'conversation:'||r.conversation_id::text, 'run:'||r.id::text);
  aliases := array_remove(ARRAY[r.split_subject_key,'deal:'||r.deal_id::text,'contact:'||r.contact_id::text,'conversation:'||r.conversation_id::text,subject],NULL);
  -- One row lock serializes new assignments across workers and across this subject's runs.
  INSERT INTO public.wa_bot_split_counters(organization_id,bot_id,revision,step_id,is_test)
    VALUES(p_org,r.bot_id,r.flow_revision,p_step,r.is_test) ON CONFLICT DO NOTHING;
  SELECT cursor_value INTO cursor_n FROM public.wa_bot_split_counters
    WHERE organization_id=p_org AND bot_id=r.bot_id AND revision=r.flow_revision AND step_id=p_step AND is_test=r.is_test FOR UPDATE;
  SELECT * INTO assigned FROM public.wa_bot_split_assignments
    WHERE organization_id=p_org AND bot_id=r.bot_id AND revision=r.flow_revision AND step_id=p_step AND is_test=r.is_test AND subject_key=ANY(aliases)
      AND (subject_key=r.split_subject_key OR subject_key='deal:'||r.deal_id::text
        OR r.deal_id IS NULL OR assignment_deal_id IS NULL OR assignment_deal_id=r.deal_id)
    ORDER BY array_position(aliases,subject_key) LIMIT 1;
  IF NOT FOUND THEN
    IF step->>'mode'='round_robin' THEN
      branch := step->'branches'->((cursor_n % branch_count)::integer);
    ELSE
      SELECT sum((b->>'weight')::integer) INTO weight_sum FROM jsonb_array_elements(step->'branches') b;
      IF weight_sum<>100
        THEN RAISE EXCEPTION 'Weights must sum to 100'; END IF;
      pick := floor(random()*100)::integer;
      FOR branch IN SELECT b FROM jsonb_array_elements(step->'branches') b LOOP
        cumulative := cumulative+(branch->>'weight')::integer;
        EXIT WHEN pick<cumulative;
      END LOOP;
    END IF;
    assigned.branch_id := branch->>'id'; assigned.target_step_id:=branch->>'goto_step_id';
    assigned.canonical_subject_key := subject;
    UPDATE public.wa_bot_split_counters SET cursor_value=cursor_value+1
      WHERE organization_id=p_org AND bot_id=r.bot_id AND revision=r.flow_revision AND step_id=p_step AND is_test=r.is_test;
  END IF;
  subject := assigned.canonical_subject_key;
  -- A contact can gain a lead after the first split. Link all known identities to
  -- the existing choice instead of allocating again when the richer ID appears.
  FOREACH alias_key IN ARRAY aliases LOOP
    INSERT INTO public.wa_bot_split_assignments(organization_id,bot_id,revision,step_id,is_test,subject_key,canonical_subject_key,assignment_deal_id,branch_id,target_step_id)
      VALUES(p_org,r.bot_id,r.flow_revision,p_step,r.is_test,alias_key,subject,r.deal_id,assigned.branch_id,assigned.target_step_id)
      ON CONFLICT(organization_id,bot_id,revision,step_id,is_test,subject_key) DO UPDATE
        SET assignment_deal_id=COALESCE(wa_bot_split_assignments.assignment_deal_id,EXCLUDED.assignment_deal_id)
        WHERE wa_bot_split_assignments.canonical_subject_key=EXCLUDED.canonical_subject_key;
  END LOOP;
  SELECT n::integer-1 INTO target_index FROM jsonb_array_elements(r.flow_snapshot->'steps') WITH ORDINALITY AS t(s,n)
    WHERE s->>'id'=assigned.target_step_id;
  IF target_index IS NULL THEN RAISE EXCEPTION 'Distribution target missing'; END IF;
  PERFORM public.wa_bot_record_event(p_org,p_run,p_step,'exited','branch:'||assigned.branch_id,assigned.target_step_id);
  -- Persist choice, event and resume cursor in the same transaction.
  UPDATE public.wa_bot_runs SET split_subject_key=subject,step_index=target_index,
    vars=jsonb_set(vars,'{_resume_step_id}',to_jsonb(assigned.target_step_id)),updated_at=now()
    WHERE id=p_run AND organization_id=p_org;
  RETURN jsonb_build_object('branch_id',assigned.branch_id,'target_step_id',assigned.target_step_id);
END;
$$;
REVOKE ALL ON FUNCTION public.wa_bot_allocate_branch(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_bot_allocate_branch(uuid,uuid,text) TO service_role;
