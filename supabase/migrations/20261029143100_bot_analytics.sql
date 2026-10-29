-- Server-only aggregation. One cohort, complete counts (no PostgREST page limit).
CREATE OR REPLACE FUNCTION public.wa_bot_analytics(
  p_org uuid, p_bot uuid, p_start timestamptz, p_end timestamptz,
  p_revision text DEFAULT NULL, p_goal text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE
  b public.wa_bots%ROWTYPE; rev text; current_rev text; snap jsonb; answer jsonb;
  as_of timestamptz := statement_timestamp(); revisions jsonb; first_at timestamptz; legacy bigint;
BEGIN
  IF p_start IS NULL OR p_end IS NULL OR p_start > p_end THEN RAISE EXCEPTION 'Invalid period'; END IF;
  SELECT * INTO b FROM public.wa_bots WHERE id=p_bot AND organization_id=p_org;
  IF NOT FOUND THEN RETURN NULL; END IF;
  current_rev := public.wa_bot_flow_revision(to_jsonb(b));
  rev := COALESCE(p_revision,current_rev);
  SELECT flow_snapshot INTO snap FROM public.wa_bot_runs
    WHERE organization_id=p_org AND bot_id=p_bot AND flow_revision=rev AND analytics_version=1
      AND NOT is_test ORDER BY created_at DESC LIMIT 1;
  IF snap IS NULL AND rev=current_rev THEN snap:=to_jsonb(b); END IF;
  IF snap IS NULL THEN RAISE EXCEPTION 'Unknown revision'; END IF;
  IF p_goal IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snap->'steps') s WHERE s->>'id'=p_goal)
    THEN RAISE EXCEPTION 'Unknown goal'; END IF;

  SELECT min(created_at) INTO first_at FROM public.wa_bot_runs
    WHERE organization_id=p_org AND bot_id=p_bot AND analytics_version=1 AND NOT is_test;
  SELECT count(*) INTO legacy FROM public.wa_bot_runs WHERE organization_id=p_org AND bot_id=p_bot
    AND NOT is_test AND analytics_version IS DISTINCT FROM 1 AND created_at BETWEEN p_start AND LEAST(p_end,as_of);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'startedAt',first,'runs',n) ORDER BY first DESC),'[]'::jsonb)
    INTO revisions FROM (
      SELECT flow_revision id,min(created_at) first,count(*) FILTER(WHERE created_at BETWEEN p_start AND LEAST(p_end,as_of)) n
      FROM public.wa_bot_runs WHERE organization_id=p_org AND bot_id=p_bot AND analytics_version=1 AND NOT is_test
        AND created_at<=as_of GROUP BY flow_revision
    ) versions;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(revisions) v WHERE v->>'id'=current_rev) THEN
    revisions:=jsonb_build_array(jsonb_build_object('id',current_rev,'startedAt',b.updated_at,'runs',0))||revisions;
  END IF;

  WITH cohort AS MATERIALIZED (
    SELECT r.*,COALESCE(split_subject_key,'deal:'||deal_id::text,'contact:'||contact_id::text,'conversation:'||conversation_id::text,'run:'||id::text) subject
    FROM public.wa_bot_runs r WHERE organization_id=p_org AND bot_id=p_bot AND analytics_version=1
      AND NOT is_test AND flow_revision=rev AND created_at BETWEEN p_start AND LEAST(p_end,as_of)
  ), events AS MATERIALIZED (
    SELECT e.* FROM public.wa_bot_events e JOIN cohort c ON c.id=e.run_id
      WHERE e.organization_id=p_org AND e.bot_id=p_bot AND e.occurred_at<=as_of
  ), step_counts AS (
    SELECT step_id,
      count(*) FILTER(WHERE kind='entered') entered,
      count(*) FILTER(WHERE kind='failed') failed,
      count(*) FILTER(WHERE kind='skipped') skipped,
      -- Use the live cursor, not absence of the first exit: a loop can wait here again.
      count(*) FILTER(WHERE kind='entered' AND (
        (c.status='waiting_reply' AND c.vars->>'_waiting_step_id'=e.step_id) OR
        (c.status='running' AND COALESCE(c.vars#>>'{_pending_step_exit,step_id}',
          c.vars->>'_resume_step_id',c.flow_snapshot->'steps'->c.step_index->>'id')=e.step_id)
      )) waiting
    FROM events e JOIN cohort c ON c.id=e.run_id GROUP BY step_id
  ), output_counts AS (
    SELECT step_id,output_id,count(*) n FROM events WHERE kind='exited' GROUP BY step_id,output_id
  ), group_counts AS (
    SELECT g->>'id' id,count(DISTINCT e.run_id) n FROM jsonb_array_elements(COALESCE(snap#>'{layout,groups}','[]'::jsonb)) g
    LEFT JOIN events e ON e.kind='entered' AND (g->'step_ids') ? e.step_id GROUP BY g->>'id'
  ), variant_counts AS (
    SELECT e.step_id,substring(e.output_id FROM 8) branch_id,count(DISTINCT c.subject) subjects,
      CASE WHEN p_goal IS NULL THEN NULL ELSE count(DISTINCT c.subject) FILTER(WHERE EXISTS(
        SELECT 1 FROM events goal WHERE goal.run_id=e.run_id AND goal.step_id=p_goal AND goal.kind='entered'
          AND goal.last_occurred_at>=e.occurred_at AND goal.last_occurred_at<=as_of)) END converted
    FROM events e JOIN cohort c ON c.id=e.run_id WHERE e.kind='exited' AND e.output_id LIKE 'branch:%'
    GROUP BY e.step_id,e.output_id
  ) SELECT jsonb_build_object(
    'summary',(SELECT jsonb_build_object('runs',count(*),'uniqueSubjects',count(DISTINCT subject),
      'running',count(*) FILTER(WHERE status='running'),'waiting',count(*) FILTER(WHERE status='waiting_reply'),
      'done',count(*) FILTER(WHERE status='done'),'errored',count(*) FILTER(WHERE status='error'),
      'cancelled',count(*) FILTER(WHERE status='cancelled')) FROM cohort),
    'stepCounts',COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM step_counts s),'[]'::jsonb),
    'outputCounts',COALESCE((SELECT jsonb_agg(to_jsonb(o)) FROM output_counts o),'[]'::jsonb),
    'groupCounts',COALESCE((SELECT jsonb_agg(to_jsonb(g)) FROM group_counts g),'[]'::jsonb),
    'variantCounts',COALESCE((SELECT jsonb_agg(to_jsonb(v)) FROM variant_counts v),'[]'::jsonb)
  ) INTO answer;

  RETURN answer || jsonb_build_object('botId',p_bot,'botUpdatedAt',b.updated_at,'asOf',as_of,'measurementStartedAt',first_at,'legacyRuns',legacy,
    'selectedRevision',rev,'isCurrentRevision',rev=current_rev,'revisions',revisions,'goalStepId',p_goal,
    -- Allowlist graph metadata: never return messages, URLs, payloads or credentials.
    'steps',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s->'id','type',s->'type',
      'next_step_id',s->'next_step_id','on_timeout_step_id',s->'on_timeout_step_id','else_step_id',s->'else_step_id',
      'buttons',s->'buttons','button_step_ids',s->'button_step_ids','branches',s->'branches',
      'rules',(SELECT jsonb_agg(jsonb_build_object('label',r->'label','goto_step_id',r->'goto_step_id'))
        FROM jsonb_array_elements(COALESCE(s->'rules','[]'::jsonb)) r)) ORDER BY n)
      FROM jsonb_array_elements(snap->'steps') WITH ORDINALITY t(s,n)),'[]'::jsonb),
    'groups',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',g->'id','name',g->'name','step_ids',g->'step_ids') ORDER BY n)
      FROM jsonb_array_elements(COALESCE(snap#>'{layout,groups}','[]'::jsonb)) WITH ORDINALITY t(g,n)),'[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.wa_bot_analytics(uuid,uuid,timestamptz,timestamptz,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wa_bot_analytics(uuid,uuid,timestamptz,timestamptz,text,text) TO service_role;
