-- Only scripts/test-performance-db.mjs: empty, isolated PGlite, synthetic IDs.
-- Seed legacy states before migration, so its prospective boundary is tested.
ALTER TABLE public.deals DISABLE TRIGGER USER;
INSERT INTO public.deals(id,organization_id,board_id,stage_id,title,owner_id,created_at,is_won,is_lost,closed_at,qualified_at,qualification_date_source) VALUES
  (crm_test.id(3001),crm_test.id(1),crm_test.id(100),crm_test.id(104),'Known original dates',crm_test.id(11),'2026-01-01',true,false,'2026-02-02','2026-02-01','transition'),
  (crm_test.id(3002),crm_test.id(1),crm_test.id(100),crm_test.id(104),'Undated customer',crm_test.id(11),'2026-01-01',false,false,NULL,NULL,NULL),
  (crm_test.id(3003),crm_test.id(1),crm_test.id(100),crm_test.id(105),'Unchanged old protocol',crm_test.id(11),'2026-01-01',false,false,NULL,NULL,NULL),
  (crm_test.id(3004),crm_test.id(1),crm_test.id(100),crm_test.id(108),'Regressing old protocol',crm_test.id(11),'2026-01-01',false,false,NULL,NULL,NULL),
  (crm_test.id(3005),crm_test.id(1),crm_test.id(100),crm_test.id(104),'Dated legacy customer',crm_test.id(11),'2026-01-01',false,false,'2026-02-02','2026-02-01','history'),
  (crm_test.id(3006),crm_test.id(1),crm_test.id(100),crm_test.id(103),'Estimated qualification',crm_test.id(11),'2026-01-01',false,false,NULL,'2026-02-01','estimated');
ALTER TABLE public.deals ENABLE TRIGGER USER;
CREATE TEMP TABLE cumulative_existing_deals AS SELECT id,to_jsonb(d) original FROM public.deals d;
CREATE TEMP TABLE cumulative_existing_events AS SELECT id,to_jsonb(e) original FROM public.deal_lifecycle_events e;
CREATE FUNCTION crm_test.reject_cumulative_backfill() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Cumulative migration must not update operational deals'; END $$;
CREATE TRIGGER reject_cumulative_backfill BEFORE UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION crm_test.reject_cumulative_backfill();

-- APPLY CUMULATIVE MIGRATION HERE

SELECT crm_test.assert(NOT EXISTS (SELECT 1 FROM public.deals d JOIN cumulative_existing_deals b USING(id) WHERE to_jsonb(d) IS DISTINCT FROM b.original),'migration leaves all existing deals byte-identical');
SELECT crm_test.assert(NOT EXISTS (SELECT 1 FROM public.deal_lifecycle_events e JOIN cumulative_existing_events b USING(id) WHERE to_jsonb(e) IS DISTINCT FROM b.original),'migration leaves all existing evidence byte-identical');
SELECT crm_test.assert((SELECT count(*) FROM public.deal_lifecycle_events)=(SELECT count(*) FROM cumulative_existing_events),'migration does not backfill historical evidence');
DROP TRIGGER reject_cumulative_backfill ON public.deals;

-- A single physical move confirms the missing prefix without intermediate moves.
INSERT INTO public.deals(id,organization_id,board_id,stage_id,title,owner_id,created_at,value) VALUES
  (crm_test.id(3101),crm_test.id(1),crm_test.id(100),crm_test.id(101),'Cumulative jump',crm_test.id(11),'2026-01-01',250);
INSERT INTO public.deal_items(organization_id,deal_id,product_id,name,quantity,price)
  VALUES(crm_test.id(1),crm_test.id(3101),crm_test.id(91),'Synthetic product',2,125);
CREATE TEMP TABLE cumulative_initial_arrival AS SELECT occurred_at FROM public.deal_stage_events WHERE deal_id=crm_test.id(3101);
UPDATE public.deals SET stage_id=crm_test.id(105) WHERE id=crm_test.id(3101);
SELECT crm_test.assert((SELECT is_won AND NOT is_lost AND qualified_at=last_stage_change_date AND closed_at=last_stage_change_date FROM public.deals WHERE id=crm_test.id(3101)),'jump past CUSTOMER records qualification and gain at the actual movement');
SELECT crm_test.assert((SELECT count(*)=2 FROM public.deal_stage_events WHERE deal_id=crm_test.id(3101)),'only initial and actual target arrivals exist');
SELECT crm_test.assert((SELECT count(*)=1 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(3101) AND event_type='stage_changed'),'no synthetic stage_changed events');
SELECT crm_test.assert((SELECT array_agg(stage_id ORDER BY stage_id)=ARRAY[crm_test.id(102),crm_test.id(103),crm_test.id(104)] FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(3101) AND event_type='stage_completed'),'only missing preceding stages are confirmed');
SELECT crm_test.assert((SELECT count(*)=3 AND bool_and(e.occurred_at=d.last_stage_change_date AND e.source='transition' AND e.snapshot_source='transition' AND e.owner_id=crm_test.id(11) AND e.items->0->>'price'='125' AND e.value=250) FROM public.deal_lifecycle_events e JOIN public.deals d ON d.id=e.deal_id WHERE d.id=crm_test.id(3101) AND e.event_type='stage_completed'),'completion snapshots use the actual write date owner products and value');
SELECT crm_test.assert((SELECT count(*)=1 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(3101) AND event_type='qualified'),'one canonical qualification');
SELECT crm_test.assert((SELECT count(*)=1 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(3101) AND event_type='won'),'one canonical gain');
SELECT crm_test.assert((SELECT min(occurred_at)=(SELECT occurred_at FROM cumulative_initial_arrival) FROM public.deal_stage_events WHERE deal_id=crm_test.id(3101) AND to_stage_id=crm_test.id(101)),'original arrival date is retained');

CREATE TEMP TABLE cumulative_first_jump AS SELECT qualified_at,closed_at FROM public.deals WHERE id=crm_test.id(3101);
CREATE TEMP TABLE cumulative_first_completion AS SELECT stage_id,occurred_at FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(3101) AND event_type='stage_completed';
UPDATE public.deals SET stage_id=crm_test.id(104) WHERE id=crm_test.id(3101);
UPDATE public.deals SET stage_id=crm_test.id(105) WHERE id=crm_test.id(3101);
UPDATE public.deals SET title=title||' edited',stage_id=stage_id WHERE id=crm_test.id(3101);
SELECT crm_test.assert((SELECT count(*)=3 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(3101) AND event_type='stage_completed'),'repeated movement and title edits do not duplicate completions');
SELECT crm_test.assert(NOT EXISTS (SELECT 1 FROM cumulative_first_completion b JOIN public.deal_lifecycle_events e USING(stage_id) WHERE e.deal_id=crm_test.id(3101) AND e.event_type='stage_completed' AND e.occurred_at IS DISTINCT FROM b.occurred_at),'repeated movement preserves completion dates');
SELECT crm_test.assert((SELECT d.closed_at=b.closed_at AND d.qualified_at=b.qualified_at FROM public.deals d CROSS JOIN cumulative_first_jump b WHERE d.id=crm_test.id(3101)),'same customer phase preserves first gain and qualification');

-- Known dates, including a legacy CUSTOMER flag mismatch, never become today.
UPDATE public.deals SET stage_id=crm_test.id(105) WHERE id IN (crm_test.id(3001),crm_test.id(3002),crm_test.id(3005),crm_test.id(3006));
SELECT crm_test.assert((SELECT bool_and(is_won AND closed_at='2026-02-02'::timestamptz AND qualified_at='2026-02-01'::timestamptz) FROM public.deals WHERE id IN(crm_test.id(3001),crm_test.id(3005))),'existing dates survive without a matching ledger event or a legacy win flag');
SELECT crm_test.assert(NOT EXISTS (SELECT 1 FROM public.deal_lifecycle_events WHERE deal_id IN(crm_test.id(3001),crm_test.id(3005)) AND event_type='won'),'retaining existing closure does not emit another gain');
SELECT crm_test.assert((SELECT is_won AND closed_at=last_stage_change_date AND qualified_at=last_stage_change_date FROM public.deals WHERE id=crm_test.id(3002)),'advance fills previously undated customer milestones');
SELECT crm_test.assert((SELECT qualified_at=last_stage_change_date AND qualification_date_source='transition' FROM public.deals WHERE id=crm_test.id(3006)),'an estimate is confirmed at the real future movement');
UPDATE public.deals SET title=title||' edited',stage_id=stage_id WHERE id=crm_test.id(3003);
UPDATE public.deals SET stage_id=crm_test.id(105) WHERE id=crm_test.id(3004);
SELECT crm_test.assert((SELECT bool_and(NOT is_won AND closed_at IS NULL AND qualified_at IS NULL) FROM public.deals WHERE id IN(crm_test.id(3003),crm_test.id(3004))),'no-op and backward moves do not normalize old protocol positions');
SELECT crm_test.assert(NOT EXISTS (SELECT 1 FROM public.deal_lifecycle_events WHERE deal_id IN(crm_test.id(3003),crm_test.id(3004)) AND event_type='stage_completed'),'no-op and regressions do not confirm missing prefixes');

-- Insert at an advanced target is a new declaration, not a historical repair.
INSERT INTO public.deals(id,organization_id,board_id,stage_id,title,owner_id,created_at) VALUES
  (crm_test.id(3102),crm_test.id(1),crm_test.id(100),crm_test.id(105),'Created at advanced stage',crm_test.id(11),'2026-01-01');
SELECT crm_test.assert((SELECT is_won AND closed_at=qualified_at FROM public.deals WHERE id=crm_test.id(3102)),'direct advanced creation records milestones');
SELECT crm_test.assert((SELECT count(*)=4 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(3102) AND event_type='stage_completed'),'advanced insert confirms the missing earlier prefix');
SELECT crm_test.assert((SELECT count(*)=1 FROM public.deal_stage_events WHERE deal_id=crm_test.id(3102)),'advanced insertion has one real arrival');

-- Loss is an exit branch even if its configured order precedes the target.
INSERT INTO public.boards VALUES (crm_test.id(800),crm_test.id(1),'Loss in the middle',crm_test.id(805),crm_test.id(802),'LEAD');
INSERT INTO public.board_stages VALUES
  (crm_test.id(801),crm_test.id(1),crm_test.id(800),'New',0,'LEAD'),
  (crm_test.id(802),crm_test.id(1),crm_test.id(800),'Lost',1,'OTHER'),
  (crm_test.id(803),crm_test.id(1),crm_test.id(800),'Qualified',2,'MQL'),
  (crm_test.id(804),crm_test.id(1),crm_test.id(800),'Signed',3,'CUSTOMER'),
  (crm_test.id(805),crm_test.id(1),crm_test.id(800),'Protocol',4,'custom-protocol');
INSERT INTO public.deals(id,organization_id,board_id,stage_id,title,owner_id,created_at) VALUES
  (crm_test.id(3103),crm_test.id(1),crm_test.id(800),crm_test.id(801),'Skip exit branch',crm_test.id(11),'2026-01-01'),
  (crm_test.id(3104),crm_test.id(1),crm_test.id(100),crm_test.id(101),'Explicit loss on protocol',crm_test.id(11),'2026-01-01'),
  (crm_test.id(3105),crm_test.id(1),crm_test.id(100),crm_test.id(101),'Move to lost',crm_test.id(11),'2026-01-01');
UPDATE public.deals SET stage_id=crm_test.id(805) WHERE id=crm_test.id(3103);
SELECT crm_test.assert(NOT EXISTS (SELECT 1 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(3103) AND stage_id=crm_test.id(802)),'lost branch is never cumulatively completed');
UPDATE public.deals SET stage_id=crm_test.id(105),is_lost=true,is_won=false WHERE id=crm_test.id(3104);
UPDATE public.deals SET stage_id=crm_test.id(106) WHERE id=crm_test.id(3105);
SELECT crm_test.assert((SELECT bool_and(is_lost AND NOT is_won AND qualified_at IS NULL) FROM public.deals WHERE id IN(crm_test.id(3104),crm_test.id(3105))),'explicit and stage losses remain lost');
SELECT crm_test.assert(NOT EXISTS (SELECT 1 FROM public.deal_lifecycle_events WHERE deal_id IN(crm_test.id(3104),crm_test.id(3105)) AND event_type='stage_completed'),'losses do not confirm prefixes');

-- Terminal loss may return to the process through a higher business milestone.
INSERT INTO public.deals(id,organization_id,board_id,stage_id,title,owner_id,created_at) VALUES
  (crm_test.id(3106),crm_test.id(1),crm_test.id(100),crm_test.id(106),'API loss reentry',crm_test.id(11),'2026-01-01'),
  (crm_test.id(3107),crm_test.id(1),crm_test.id(100),crm_test.id(106),'Client loss reentry',crm_test.id(11),'2026-01-01');
UPDATE public.deals SET stage_id=crm_test.id(105) WHERE id=crm_test.id(3106);
UPDATE public.deals SET stage_id=crm_test.id(105),is_won=true,is_lost=false WHERE id=crm_test.id(3107);
SELECT crm_test.assert((SELECT bool_and(is_won AND NOT is_lost AND closed_at=last_stage_change_date AND qualified_at=last_stage_change_date) FROM public.deals WHERE id IN(crm_test.id(3106),crm_test.id(3107))),'API and client loss reentry start the new gain at the movement');
SELECT crm_test.assert((SELECT count(*)=8 FROM public.deal_lifecycle_events WHERE deal_id IN(crm_test.id(3106),crm_test.id(3107)) AND event_type='stage_completed'),'loss reentry confirms only the non-loss prefix');

-- Explicit reopening still wins over the cumulative destination rule.
CREATE TEMP TABLE cumulative_before_reopen AS SELECT count(*) n FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(3102) AND event_type='stage_completed';
UPDATE public.deals SET stage_id=crm_test.id(108),is_won=false,is_lost=false WHERE id=crm_test.id(3102);
SELECT crm_test.assert((SELECT NOT is_won AND NOT is_lost AND closed_at IS NULL FROM public.deals WHERE id=crm_test.id(3102)),'explicit reopen is preserved');
SELECT crm_test.assert((SELECT count(*)=(SELECT n FROM cumulative_before_reopen) FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(3102) AND event_type='stage_completed'),'explicit reopen does not confirm extra stages');

-- Transfers use the destination process and do not inherit the source dates.
UPDATE public.deals SET board_id=crm_test.id(200),stage_id=crm_test.id(202),is_won=false,is_lost=false WHERE id IN(crm_test.id(3101),crm_test.id(3105));
SELECT crm_test.assert((SELECT bool_and(NOT is_won AND NOT is_lost AND closed_at IS NULL AND qualified_at=last_stage_change_date) FROM public.deals WHERE id IN(crm_test.id(3101),crm_test.id(3105))),'won and lost source transfers establish destination qualification');
SELECT crm_test.assert((SELECT count(*)=2 FROM public.deal_lifecycle_events WHERE deal_id IN(crm_test.id(3101),crm_test.id(3105)) AND board_id=crm_test.id(200) AND stage_id=crm_test.id(201) AND event_type='stage_completed'),'both source outcomes confirm destination prefix');
SELECT crm_test.assert(NOT EXISTS (SELECT 1 FROM public.deal_lifecycle_events e JOIN public.board_stages s ON s.id=e.stage_id WHERE e.event_type='stage_completed' AND (e.board_id<>s.board_id OR e.organization_id<>s.organization_id)),'all completions belong to their exact board and organization');

-- Customer-service boards retain their explicit completion configuration.
INSERT INTO public.deals(id,organization_id,board_id,stage_id,title,owner_id,created_at) VALUES
  (crm_test.id(3108),crm_test.id(1),crm_test.id(500),crm_test.id(501),'Service customer',crm_test.id(11),'2026-01-01');
SELECT crm_test.assert((SELECT NOT is_won FROM public.deals WHERE id=crm_test.id(3108)),'service CUSTOMER identity is not another acquisition');
UPDATE public.deals SET stage_id=crm_test.id(502) WHERE id=crm_test.id(3108);
SELECT crm_test.assert((SELECT is_won FROM public.deals WHERE id=crm_test.id(3108)),'service explicit completion still wins');
INSERT INTO public.deals(id,organization_id,board_id,stage_id,title,owner_id,created_at) VALUES
  (crm_test.id(3109),crm_test.id(1),crm_test.id(600),crm_test.id(602),'No customer configuration',crm_test.id(11),'2026-01-01');
SELECT crm_test.assert((SELECT NOT is_won AND closed_at IS NULL FROM public.deals WHERE id=crm_test.id(3109)),'sales shortcut without CUSTOMER still does not invent a gain');

-- Private trigger helpers expose no client/service-role writes; existing RLS remains.
SELECT crm_test.assert(NOT has_function_privilege('authenticated','crm_internal.is_forward_stage_move(uuid,uuid,uuid,uuid)','EXECUTE') AND NOT has_function_privilege('service_role','crm_internal.record_deal_stage_completions()','EXECUTE'),'completion helpers are private');
SELECT crm_test.assert(NOT has_table_privilege('authenticated','public.deal_lifecycle_events','INSERT') AND NOT has_table_privilege('service_role','public.deal_lifecycle_events','INSERT'),'ledger remains append-only through internal triggers');
SELECT crm_test.assert((SELECT relrowsecurity FROM pg_class WHERE oid='public.deal_lifecycle_events'::regclass),'ledger RLS remains enabled');
-- A reopened CUSTOMER may win again even when the entire prefix is already known.
-- Separate transactions represent real successive requests, with distinct now().
INSERT INTO public.deals(id,organization_id,board_id,stage_id,title,owner_id,created_at) VALUES
  (crm_test.id(3110),crm_test.id(1),crm_test.id(100),crm_test.id(101),'Reopened customer resumes',crm_test.id(11),'2026-01-01');
UPDATE public.deals SET stage_id=crm_test.id(105) WHERE id=crm_test.id(3110);
CREATE TEMP TABLE cumulative_reopened_first AS SELECT qualified_at,closed_at FROM public.deals WHERE id=crm_test.id(3110);
CREATE TEMP TABLE cumulative_reopened_completions AS SELECT id,occurred_at FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(3110) AND event_type='stage_completed';

-- NEXT CUMULATIVE TEST TRANSACTION
UPDATE public.deals SET stage_id=crm_test.id(104),is_won=false,is_lost=false WHERE id=crm_test.id(3110);
SELECT crm_test.assert((SELECT NOT d.is_won AND NOT d.is_lost AND d.closed_at IS NULL AND d.qualified_at=b.qualified_at FROM public.deals d CROSS JOIN cumulative_reopened_first b WHERE d.id=crm_test.id(3110)),'explicit CUSTOMER reopen preserves qualification and clears closure');
SELECT crm_test.assert((SELECT count(*)=1 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(3110) AND event_type='reopened'),'CUSTOMER reopen records the new episode');

-- NEXT CUMULATIVE TEST TRANSACTION
UPDATE public.deals SET stage_id=crm_test.id(105) WHERE id=crm_test.id(3110);
SELECT crm_test.assert((SELECT d.is_won AND NOT d.is_lost AND d.closed_at=d.last_stage_change_date AND d.closed_at>b.closed_at AND d.qualified_at=b.qualified_at FROM public.deals d CROSS JOIN cumulative_reopened_first b WHERE d.id=crm_test.id(3110)),'advance after CUSTOMER reopen creates a new gain and preserves original qualification');
SELECT crm_test.assert((SELECT count(*)=2 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(3110) AND event_type='won'),'both distinct gain episodes are recorded');
SELECT crm_test.assert((SELECT count(*)=1 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(3110) AND event_type='qualified'),'reopened episode does not duplicate qualification');
SELECT crm_test.assert((SELECT count(*)=(SELECT count(*) FROM cumulative_reopened_completions) FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(3110) AND event_type='stage_completed'),'gain after reopen needs no duplicate stage completions');
SELECT crm_test.assert(NOT EXISTS (SELECT 1 FROM cumulative_reopened_completions b LEFT JOIN public.deal_lifecycle_events e USING(id) WHERE e.id IS NULL OR e.occurred_at IS DISTINCT FROM b.occurred_at),'reopened episode preserves every prior completion date');
SELECT 'PASS: cumulative milestones, future-only migration, dates, deduplication, loss/reopen/transfers, service boards and private ledger' AS result;
