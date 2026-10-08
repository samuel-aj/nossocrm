-- Run only through scripts/test-performance-db.mjs in its isolated database.
INSERT INTO public.organizations VALUES (crm_test.id(1),'A'),(crm_test.id(2),'B');
INSERT INTO public.boards VALUES
  (crm_test.id(100),crm_test.id(1),'MQL first',crm_test.id(105),crm_test.id(106),'LEAD'),
  (crm_test.id(200),crm_test.id(1),'Legacy SQL',NULL,NULL,'LEAD'),
  (crm_test.id(300),crm_test.id(1),'Legacy label',NULL,NULL,'LEAD'),
  (crm_test.id(400),crm_test.id(2),'Foreign',NULL,NULL,'LEAD');
INSERT INTO public.board_stages VALUES
  (crm_test.id(101),crm_test.id(1),crm_test.id(100),'Novo',0,'LEAD'),
  (crm_test.id(102),crm_test.id(1),crm_test.id(100),'Proposta enviada',1,'MQL'),
  (crm_test.id(103),crm_test.id(1),crm_test.id(100),'SQL',2,'SALES_QUALIFIED'),
  (crm_test.id(104),crm_test.id(1),crm_test.id(100),'Contrato',3,'CUSTOMER'),
  (crm_test.id(105),crm_test.id(1),crm_test.id(100),'Protocolado',4,'CUSTOMER'),
  (crm_test.id(106),crm_test.id(1),crm_test.id(100),'Perdido',5,'OTHER'),
  (crm_test.id(201),crm_test.id(1),crm_test.id(200),'Novo',0,'LEAD'),
  (crm_test.id(202),crm_test.id(1),crm_test.id(200),'SQL',1,'SALES_QUALIFIED'),
  (crm_test.id(203),crm_test.id(1),crm_test.id(200),'Ganho',2,'CUSTOMER'),
  (crm_test.id(301),crm_test.id(1),crm_test.id(300),'Qualificado',1,NULL),
  (crm_test.id(401),crm_test.id(2),crm_test.id(400),'Foreign',0,'MQL'),
  (crm_test.id(402),crm_test.id(2),crm_test.id(100),'Corrupt org stage',6,'MQL');

-- Seed pre-migration states without pretending they were written today.
ALTER TABLE public.deals DISABLE TRIGGER USER;
INSERT INTO public.deals(id,organization_id,board_id,stage_id,title,owner_id,created_at,last_stage_change_date,qualified_at,qualification_date_source) VALUES
  (crm_test.id(1001),crm_test.id(1),crm_test.id(100),crm_test.id(102),'No dated history',crm_test.id(11),'2026-09-01','2026-09-02',NULL,NULL),
  (crm_test.id(1002),crm_test.id(1),crm_test.id(100),crm_test.id(103),'Estimated',crm_test.id(11),'2026-09-01','2026-09-02','2026-09-11','estimated'),
  (crm_test.id(1003),crm_test.id(1),crm_test.id(200),crm_test.id(201),'Transferred',crm_test.id(11),'2026-09-01','2026-09-02',NULL,NULL),
  (crm_test.id(1004),crm_test.id(1),crm_test.id(100),crm_test.id(101),'Other owner',crm_test.id(12),'2026-09-01','2026-09-02',NULL,NULL),
  (crm_test.id(1005),crm_test.id(1),crm_test.id(100),crm_test.id(401),'Legacy mismatch',crm_test.id(11),'2026-09-01','2026-09-02',NULL,NULL),
  (crm_test.id(1006),crm_test.id(1),crm_test.id(100),crm_test.id(106),'Closed without date',crm_test.id(11),'2026-09-01','2026-09-02',NULL,NULL),
  (crm_test.id(1007),crm_test.id(1),crm_test.id(100),crm_test.id(102),'Webhook evidence',crm_test.id(11),'2026-09-01','2026-09-02',NULL,NULL),
  (crm_test.id(1008),crm_test.id(1),crm_test.id(100),crm_test.id(105),'Second win',crm_test.id(11),'2026-09-01','2026-09-02',NULL,NULL),
  (crm_test.id(1009),crm_test.id(1),crm_test.id(100),crm_test.id(101),'Stage-only old win',crm_test.id(11),'2026-09-01','2026-09-02',NULL,NULL),
  (crm_test.id(1010),crm_test.id(1),crm_test.id(200),crm_test.id(202),'Audit after transfer',crm_test.id(11),'2026-09-01','2026-09-02',NULL,NULL),
  (crm_test.id(1011),crm_test.id(1),crm_test.id(200),crm_test.id(202),'Ambiguous old board',crm_test.id(11),'2026-09-01','2026-09-02',NULL,NULL);
UPDATE public.deals SET is_lost=true WHERE id=crm_test.id(1006);
UPDATE public.deals SET is_won=true,closed_at='2026-09-08' WHERE id=crm_test.id(1008);
INSERT INTO public.deal_stage_events(organization_id,deal_id,board_id,from_stage_id,to_stage_id,occurred_at) VALUES
  (crm_test.id(1),crm_test.id(1002),crm_test.id(100),crm_test.id(103),crm_test.id(102),'2026-09-05'),
  (crm_test.id(1),crm_test.id(1003),crm_test.id(100),crm_test.id(101),crm_test.id(102),'2026-09-04'),
  (crm_test.id(1),crm_test.id(1004),crm_test.id(100),crm_test.id(101),crm_test.id(102),'2026-09-04'),
  (crm_test.id(1),crm_test.id(1009),crm_test.id(100),crm_test.id(102),crm_test.id(105),'2026-09-05'),
  (crm_test.id(1),crm_test.id(1010),crm_test.id(100),crm_test.id(101),crm_test.id(102),'2026-09-04'),
  (crm_test.id(1),crm_test.id(1011),crm_test.id(100),crm_test.id(101),crm_test.id(102),'2026-09-04'),
  (crm_test.id(1),crm_test.id(1011),crm_test.id(200),crm_test.id(201),crm_test.id(202),'2026-09-04');
INSERT INTO public.deal_events(organization_id,deal_id,kind,old_value,new_value,detail,created_at) VALUES
  (crm_test.id(1),crm_test.id(1003),'created',NULL,to_jsonb(crm_test.id(101)),jsonb_build_object('board_id',crm_test.id(100)),'2026-09-01'),
  (crm_test.id(1),crm_test.id(1003),'won',NULL,NULL,NULL,'2026-09-05'),
  (crm_test.id(1),crm_test.id(1003),'reopened',NULL,NULL,NULL,'2026-09-06'),
  (crm_test.id(1),crm_test.id(1003),'lost',NULL,NULL,'{"reason":"Original reason","category":"qualified"}','2026-09-07'),
  (crm_test.id(1),crm_test.id(1003),'lost',NULL,NULL,'{"reason":"Edited reason","category":"qualified","updated":true}','2026-09-08'),
  (crm_test.id(1),crm_test.id(1003),'stage',to_jsonb(crm_test.id(106)),to_jsonb(crm_test.id(201)),jsonb_build_object('old_board_id',crm_test.id(100),'board_id',crm_test.id(200)),'2026-09-09'),
  (crm_test.id(1),crm_test.id(1008),'won',NULL,NULL,NULL,'2026-09-05'),
  (crm_test.id(1),crm_test.id(1008),'reopened',NULL,NULL,NULL,'2026-09-06'),
  (crm_test.id(1),crm_test.id(1010),'stage',to_jsonb(crm_test.id(102)),to_jsonb(crm_test.id(202)),jsonb_build_object('old_board_id',crm_test.id(100),'board_id',crm_test.id(200)),'2026-09-05'),
  (crm_test.id(1),crm_test.id(1010),'won',NULL,NULL,NULL,'2026-09-06'),
  (crm_test.id(1),crm_test.id(1011),'won',NULL,NULL,NULL,'2026-09-06');
INSERT INTO public.webhook_events_out(organization_id,deal_id,to_stage_id,event_type,payload,created_at) VALUES
  (crm_test.id(1),crm_test.id(1007),crm_test.id(102),'deal.stage_changed',jsonb_build_object('deal',jsonb_build_object('board_id',crm_test.id(100)),'occurred_at','2026-09-03T00:00:00Z'),'2026-09-04');
ALTER TABLE public.deals ENABLE TRIGGER USER;
-- Any UPDATE by the migration would fail: operational triggers must not fire.
CREATE FUNCTION crm_test.reject_backfill_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Migration must not update deals'; END $$;
CREATE TRIGGER reject_backfill_update BEFORE UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION crm_test.reject_backfill_update();

-- APPLY PERFORMANCE MIGRATION HERE

DROP TRIGGER reject_backfill_update ON public.deals;
SELECT crm_test.assert((SELECT qualifies AND at_sql FROM crm_internal.deal_stage_rules(crm_test.id(100),crm_test.id(1),crm_test.id(102))),'MQL has priority over SQL');
SELECT crm_test.assert((SELECT NOT won FROM crm_internal.deal_stage_rules(crm_test.id(100),crm_test.id(1),crm_test.id(104))),'Contract CUSTOMER is not Protocolado');
SELECT crm_test.assert((SELECT won FROM crm_internal.deal_stage_rules(crm_test.id(100),crm_test.id(1),crm_test.id(105))),'Explicit Protocolado is won');
SELECT crm_test.assert((SELECT qualifies FROM crm_internal.deal_stage_rules(crm_test.id(200),crm_test.id(1),crm_test.id(202))),'Legacy SQL fallback');
SELECT crm_test.assert((SELECT qualifies FROM crm_internal.deal_stage_rules(crm_test.id(300),crm_test.id(1),crm_test.id(301))),'Legacy label fallback');
SELECT crm_test.assert(NOT EXISTS(SELECT 1 FROM public.deal_lifecycle_events WHERE deal_id IN(crm_test.id(1001),crm_test.id(1002))),'No fabricated history from current/estimated state');
SELECT crm_test.assert((SELECT count(*)=1 AND min(occurred_at)='2026-09-04'::timestamptz AND bool_and(snapshot_source='current') FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(1003) AND board_id=crm_test.id(100) AND event_type='qualified'),'Earlier board qualification recovered and approximation marked');
SELECT crm_test.assert((SELECT occurred_at='2026-09-03'::timestamptz FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(1007) AND event_type='qualified'),'Webhook timestamp evidence retained');
SELECT crm_test.assert((SELECT count(*)=1 AND min(loss_reason)='Original reason' FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(1003) AND event_type='lost'),'Loss reason edits do not fabricate another loss');
SELECT crm_test.assert((SELECT count(*)=1 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(1003) AND event_type='won' AND board_id=crm_test.id(100)),'Historic win survives reopens and transfers');
SELECT crm_test.assert((SELECT count(*)=1 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(1003) AND event_type='left_board' AND board_id=crm_test.id(100)),'Backfill stores both transfer sides');
SELECT crm_test.assert((SELECT count(*)=2 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(1008) AND event_type='won'),'Current second closure does not disappear behind an earlier win');
SELECT crm_test.assert((SELECT count(*)=1 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(1009) AND event_type='won' AND occurred_at='2026-09-05'::timestamptz),'Stage-only old outcome has dated evidence');
SELECT crm_test.assert((SELECT count(*)=1 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(1010) AND event_type='won' AND board_id=crm_test.id(200)),'Later audited transfer outranks stale stage-event board');
SELECT crm_test.assert(NOT EXISTS(SELECT 1 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(1011) AND event_type='won'),'Ambiguous simultaneous board history is not invented');

UPDATE public.deals SET title='Only title changed',last_stage_change_date=now(),closed_at=now(),qualified_at=now(),qualification_date_source='transition' WHERE id=crm_test.id(1001);
UPDATE public.deals SET title='Only title changed' WHERE id=crm_test.id(1006);
SELECT crm_test.assert((SELECT qualified_at IS NULL AND closed_at IS NULL AND last_stage_change_date='2026-09-02'::timestamptz FROM public.deals WHERE id=crm_test.id(1001)),'No movement: no fabricated dates, even from client-provided date fields');
SELECT crm_test.assert((SELECT closed_at IS NULL FROM public.deals WHERE id=crm_test.id(1006)),'Legacy closed deal without date stays undated on irrelevant edit');
UPDATE public.deals SET stage_id=crm_test.id(104) WHERE id IN(crm_test.id(1001),crm_test.id(1002));
SELECT crm_test.assert((SELECT qualified_at IS NULL FROM public.deals WHERE id=crm_test.id(1001)),'Advance within already-qualified stages cannot manufacture first qualification');
SELECT crm_test.assert((SELECT qualified_at='2026-09-11'::timestamptz AND qualification_date_source='estimated' FROM public.deals WHERE id=crm_test.id(1002)),'Advance within qualified stages cannot promote estimated date');
SELECT crm_test.assert(NOT EXISTS(SELECT 1 FROM public.deal_lifecycle_events WHERE deal_id IN(crm_test.id(1001),crm_test.id(1002)) AND event_type='qualified'),'No observed qualification from already-qualified legacy movement');
UPDATE public.deals SET title='Legacy irrelevant edit accepted' WHERE id=crm_test.id(1005);

-- Structural checks apply even to a BYPASSRLS service role.
SET ROLE service_role;
DO $$ BEGIN
  BEGIN
    UPDATE public.deals SET stage_id=crm_test.id(401) WHERE id=crm_test.id(1001);
    RAISE EXCEPTION 'Cross-board stage accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.deals SET board_id=crm_test.id(400),stage_id=crm_test.id(401) WHERE id=crm_test.id(1001);
    RAISE EXCEPTION 'Foreign organization board accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.deals SET stage_id=crm_test.id(402) WHERE id=crm_test.id(1001);
    RAISE EXCEPTION 'Foreign organization stage accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET ROLE;

INSERT INTO public.deals(id,organization_id,board_id,stage_id,title,owner_id,value) VALUES
  (crm_test.id(2001),crm_test.id(1),crm_test.id(100),crm_test.id(101),'Snapshot title',crm_test.id(11),125);
INSERT INTO public.deal_items(organization_id,deal_id,product_id,name,quantity,price)
  VALUES(crm_test.id(1),crm_test.id(2001),crm_test.id(900),'Service',2,62.5);
UPDATE public.deals SET stage_id=crm_test.id(102) WHERE id=crm_test.id(2001);
CREATE TEMP TABLE qualification_before AS SELECT qualified_at FROM public.deals WHERE id=crm_test.id(2001);
UPDATE public.deals SET stage_id=crm_test.id(105) WHERE id=crm_test.id(2001);
UPDATE public.deals SET stage_id=crm_test.id(101) WHERE id=crm_test.id(2001);
UPDATE public.deals SET stage_id=crm_test.id(106),loss_category='qualified',loss_reason='Original loss' WHERE id=crm_test.id(2001);
UPDATE public.deals SET loss_reason='Edited loss',value=999,title='New title',owner_id=crm_test.id(12) WHERE id=crm_test.id(2001);
UPDATE public.deal_items SET price=999 WHERE deal_id=crm_test.id(2001);
UPDATE public.deals SET board_id=crm_test.id(200),stage_id=crm_test.id(201) WHERE id=crm_test.id(2001);
UPDATE public.deals SET stage_id=crm_test.id(202) WHERE id=crm_test.id(2001);
UPDATE public.deals SET board_id=crm_test.id(100),stage_id=crm_test.id(101) WHERE id=crm_test.id(2001);
SELECT crm_test.assert((SELECT d.qualified_at=q.qualified_at FROM public.deals d CROSS JOIN qualification_before q WHERE d.id=crm_test.id(2001)),'Return to board restores first qualification');
SELECT crm_test.assert((SELECT count(*)=2 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(2001) AND event_type='qualified'),'One first qualification per board');
SELECT crm_test.assert((SELECT count(*)=1 AND min(value)=125 AND min(title)='Snapshot title' AND bool_and(owner_id=crm_test.id(11)) AND bool_and(items->0->>'price'='62.5') FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(2001) AND event_type='won'),'Won snapshot stays immutable after editing/reopening');
SELECT crm_test.assert((SELECT count(*)=1 AND min(loss_reason)='Original loss' FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(2001) AND event_type='lost'),'One loss event with original reason');
SELECT crm_test.assert((SELECT count(*)=2 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(2001) AND event_type='reopened'),'Reopens captured including board transfer');
SELECT crm_test.assert((SELECT count(*)=3 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(2001) AND event_type='entered_board'),'Creation and two board entries captured');
SELECT crm_test.assert((SELECT count(*)=5 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(2001) AND event_type='stage_changed'),'Only actual same-board movements record stage snapshots');
SELECT crm_test.assert((SELECT owner_id=crm_test.id(11) AND items->0->>'price'='62.5' AND value=125 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(2001) AND event_type='stage_changed' AND stage_id=crm_test.id(105)),'Stage arrival preserves the owner and products at that movement');
SELECT crm_test.assert((SELECT owner_id=crm_test.id(12) AND items->0->>'price'='999' AND value=999 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(2001) AND event_type='stage_changed' AND stage_id=crm_test.id(202)),'Later arrival captures changed owner and products rather than reusing prior lifecycle snapshot');
INSERT INTO public.deals(id,organization_id,board_id,stage_id,title,owner_id,value) VALUES
  (crm_test.id(2002),crm_test.id(1),crm_test.id(100),crm_test.id(105),'Created at Protocolado',crm_test.id(11),222);
SELECT crm_test.assert((SELECT is_won AND NOT is_lost AND closed_at IS NOT NULL AND qualification_date_source='transition' FROM public.deals WHERE id=crm_test.id(2002)),'Creation at explicit win stage records the observed date');
SELECT crm_test.assert((SELECT count(*)=3 AND bool_and(is_won) FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(2002)),'Created closed deal records entry qualification win with accurate state snapshots');

-- RLS is evaluated as separate authenticated identities, not owner/superuser.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',crm_test.id(11)::text,false);
SELECT crm_test.assert(EXISTS(SELECT 1 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(1003)),'Identity 11 sees visible deal history');
SELECT crm_test.assert(NOT EXISTS(SELECT 1 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(2001)),'Identity 11 loses access after owner reassignment');
SELECT set_config('request.jwt.claim.sub',crm_test.id(12)::text,false);
SELECT crm_test.assert(EXISTS(SELECT 1 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(2001)),'Identity 12 sees reassigned deal history');
SELECT crm_test.assert(NOT EXISTS(SELECT 1 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(1003)),'Identity 12 cannot read another owner history');
RESET ROLE;
UPDATE public.deals SET deleted_at=now() WHERE id=crm_test.id(2001);
SET ROLE authenticated;
SELECT crm_test.assert(NOT EXISTS(SELECT 1 FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(2001)),'Deleted deal history hidden');
RESET ROLE;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    PERFORM crm_test.assert(NOT has_table_privilege(role_name,'public.deal_lifecycle_events','INSERT,UPDATE,DELETE,TRUNCATE'),'No direct event DML for '||role_name);
    PERFORM crm_test.assert(NOT has_function_privilege(role_name,'crm_internal.record_deal_lifecycle_events()','EXECUTE'),'No callable recording trigger for '||role_name);
    PERFORM crm_test.assert(NOT has_function_privilege(role_name,'crm_internal.append_deal_lifecycle_event(public.deals,uuid,text,timestamptz,text,text,text,uuid,boolean,boolean,text,text)','EXECUTE'),'No callable insert helper for '||role_name);
  END LOOP;
END $$;
-- BYPASSRLS does not grant DML: service callers cannot forge or rewrite evidence.
SET ROLE service_role;
DO $$ BEGIN
  BEGIN
    INSERT INTO public.deal_lifecycle_events SELECT * FROM public.deal_lifecycle_events LIMIT 1;
    RAISE EXCEPTION 'Service role forged an event';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.deal_lifecycle_events SET value=0;
    RAISE EXCEPTION 'Service role rewrote event snapshots';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.deal_lifecycle_events;
    RAISE EXCEPTION 'Service role erased event history';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'PASS: migration backfill, MQL/SQL/name, explicit win, date preservation, structural guard, snapshots, transfers, reopen and independent-identity RLS' AS result;
