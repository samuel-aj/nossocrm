-- Only through scripts/test-lead-source-db.mjs, in an empty isolated database.
ALTER TABLE public.deals ADD COLUMN custom_fields jsonb DEFAULT '{}';
ALTER TABLE public.deals ADD COLUMN contact_id uuid;
ALTER TABLE public.deals ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.deal_events ADD COLUMN field text;
ALTER TABLE public.deal_events ADD COLUMN actor_kind text;
ALTER TABLE public.deal_events ADD COLUMN actor_id uuid;
CREATE TABLE public.organization_settings(organization_id uuid PRIMARY KEY REFERENCES public.organizations);
CREATE TABLE public.custom_field_definitions(organization_id uuid REFERENCES public.organizations,key text,entity_type text,options text[]);
ALTER TABLE public.organization_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY settings_visible ON public.organization_settings FOR SELECT TO authenticated
  USING (organization_id=CASE auth.uid() WHEN crm_test.id(11) THEN crm_test.id(1) ELSE crm_test.id(2) END);
GRANT SELECT ON public.organization_settings TO authenticated;
GRANT ALL ON public.organization_settings TO service_role;
CREATE POLICY deals_edit ON public.deals FOR UPDATE TO authenticated USING (owner_id=auth.uid()) WITH CHECK (owner_id=auth.uid());
GRANT UPDATE ON public.deals TO authenticated;
INSERT INTO public.organizations VALUES (crm_test.id(1),'A'),(crm_test.id(2),'B');
INSERT INTO public.organization_settings VALUES (crm_test.id(1)),(crm_test.id(2));
INSERT INTO public.custom_field_definitions VALUES
  (crm_test.id(1),'origem','deal',ARRAY['Google Ads',' Recomendação antiga ','google ads','Meta Ads']),
  (crm_test.id(2),'origem','contact',ARRAY['Do not copy contact source']);
INSERT INTO public.boards VALUES
  (crm_test.id(100),crm_test.id(1),'Sales A',NULL,NULL,'LEAD'),
  (crm_test.id(200),crm_test.id(1),'Second board A',NULL,NULL,'LEAD'),
  (crm_test.id(300),crm_test.id(2),'Board B',NULL,NULL,'LEAD');
INSERT INTO public.board_stages VALUES
  (crm_test.id(101),crm_test.id(1),crm_test.id(100),'New',0,'LEAD'),
  (crm_test.id(102),crm_test.id(1),crm_test.id(100),'Qualified',1,'MQL'),
  (crm_test.id(103),crm_test.id(1),crm_test.id(100),'Customer',2,'CUSTOMER'),
  (crm_test.id(201),crm_test.id(1),crm_test.id(200),'New',0,'LEAD'),
  (crm_test.id(301),crm_test.id(2),crm_test.id(300),'New',0,'LEAD');
INSERT INTO public.deals(id,organization_id,board_id,stage_id,title,owner_id,custom_fields) VALUES
  (crm_test.id(1001),crm_test.id(1),crm_test.id(100),crm_test.id(101),'Legacy',crm_test.id(11),'{"origem":"  Meta Ads  ","utm_source":"facebook","utm_medium":"cpc","utm_campaign":"Keep original"}'),
  (crm_test.id(1002),crm_test.id(1),crm_test.id(100),crm_test.id(101),'Old UTM only',crm_test.id(11),'{"utm_source":"google","utm_medium":"cpc"}'),
  (crm_test.id(1003),crm_test.id(2),crm_test.id(300),crm_test.id(301),'Foreign legacy',crm_test.id(12),'{"origem":"Indicação"}');

-- Detect even harmless-looking migration UPDATEs that would dispatch CRM work.
CREATE TABLE crm_test.operational_updates(id uuid);
CREATE FUNCTION crm_test.count_operational_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN INSERT INTO crm_test.operational_updates VALUES (NEW.id); RETURN NEW; END $$;
CREATE TRIGGER test_operational_update AFTER UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION crm_test.count_operational_write();
CREATE TABLE crm_test.original_deals AS SELECT id,to_jsonb(d) AS original FROM public.deals d;
CREATE TABLE crm_test.original_policies AS SELECT * FROM pg_policies WHERE schemaname='public';
CREATE TABLE crm_test.original_event_ids AS SELECT id FROM public.deal_lifecycle_events;

-- APPLY LEAD SOURCE MIGRATION HERE

SELECT crm_test.assert((SELECT count(*)=0 FROM crm_test.operational_updates),'migration must issue zero operational updates');
SELECT crm_test.assert((SELECT lead_source_options=ARRAY['Google Ads','Recomendação antiga','Meta Ads']
  FROM public.organization_settings WHERE organization_id=crm_test.id(1)),'legacy configured options migrate without dropping custom categories');
SELECT crm_test.assert((SELECT lead_source_options IS NULL FROM public.organization_settings WHERE organization_id=crm_test.id(2)),
  'contact options and foreign organization configuration never leak into deal source');
SELECT crm_test.assert((SELECT options=ARRAY['Google Ads',' Recomendação antiga ','google ads','Meta Ads'] FROM public.custom_field_definitions
  WHERE organization_id=crm_test.id(1)),'legacy source definition unchanged');
SELECT crm_test.assert(NOT EXISTS(SELECT 1 FROM public.deals d JOIN crm_test.original_deals o USING(id)
  WHERE to_jsonb(d)-'lead_source'-'lead_source_initialized' IS DISTINCT FROM o.original),'all original deal data preserved byte for byte');
SELECT crm_test.assert((SELECT bool_and(NOT lead_source_initialized AND lead_source IS NULL) FROM public.deals),'legacy deals remain untouched/uninitialized');
SELECT crm_test.assert((SELECT lead_source='Meta Ads' AND lead_source_snapshot_source='current'
  FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(1001) LIMIT 1),'old ledger uses labeled current-source evidence');
SELECT crm_test.assert(NOT EXISTS((SELECT * FROM crm_test.original_policies EXCEPT SELECT * FROM pg_policies WHERE schemaname='public')
  UNION ALL (SELECT * FROM pg_policies WHERE schemaname='public' EXCEPT SELECT * FROM crm_test.original_policies)),'migration changes no RLS policy');

-- Ordinary update initializes only source, without claiming a source change or
-- re-inferencing an old UTM-only record. UTMs and legacy object stay untouched.
UPDATE public.deals SET title='Legacy edited' WHERE id=crm_test.id(1001);
UPDATE public.deals SET title='UTM edited' WHERE id=crm_test.id(1002);
SELECT crm_test.assert((SELECT lead_source='Meta Ads' AND lead_source_initialized AND custom_fields->>'origem'='  Meta Ads  '
  AND custom_fields->>'utm_campaign'='Keep original' FROM public.deals WHERE id=crm_test.id(1001)),'lazy source normalization preserves legacy and UTMs');
SELECT crm_test.assert((SELECT lead_source IS NULL AND lead_source_initialized FROM public.deals WHERE id=crm_test.id(1002)),'old UTMs never infer source');
SELECT crm_test.assert((SELECT count(*)=0 FROM public.deal_events WHERE kind='lead_source'),'lazy init is not an acquisition change');

-- Native clear takes precedence even if the stored native value is already
-- NULL. Column-specific intent must work across multiple rows in one update.
UPDATE public.deals SET lead_source=NULL,custom_fields=custom_fields||'{"origem":"Google Ads"}' WHERE id=crm_test.id(1001);
UPDATE public.deals SET lead_source=NULL,custom_fields=custom_fields||'{"origem":"Indicação"}' WHERE id IN (crm_test.id(1001),crm_test.id(1002));
SELECT crm_test.assert((SELECT bool_and(lead_source IS NULL AND lead_source_initialized) FROM public.deals
  WHERE id IN (crm_test.id(1001),crm_test.id(1002))),'explicit null wins conflicting legacy input even when null already stored');
UPDATE public.deals SET title='No resurrection' WHERE id=crm_test.id(1001);
SELECT crm_test.assert((SELECT lead_source IS NULL FROM public.deals WHERE id=crm_test.id(1001)),'ordinary update does not resurrect cleared legacy');
UPDATE public.deals SET custom_fields=custom_fields||'{"origem":"  Presencial "}' WHERE id=crm_test.id(1001);
SELECT crm_test.assert((SELECT lead_source='Presencial' FROM public.deals WHERE id=crm_test.id(1001)),'explicit changed legacy field is accepted');
UPDATE public.deals SET custom_fields='{"utm_source":"google","utm_medium":"cpc"}' WHERE id=crm_test.id(1001);
SELECT crm_test.assert((SELECT lead_source='Presencial' FROM public.deals WHERE id=crm_test.id(1001)),'omitting legacy source in replacement object never clears established source');
UPDATE public.deals SET custom_fields=custom_fields||'{"origem":null}' WHERE id=crm_test.id(1001);
SELECT crm_test.assert((SELECT lead_source IS NULL FROM public.deals WHERE id=crm_test.id(1001)),'explicit legacy null clears');
UPDATE public.deals SET lead_source='  Feira   regional ',custom_fields=custom_fields||'{"origem":"Meta Ads"}' WHERE id=crm_test.id(1001);
SELECT crm_test.assert((SELECT lead_source='Feira regional' AND custom_fields->>'origem'='Meta Ads' FROM public.deals WHERE id=crm_test.id(1001)),'native category wins and preserves conflicting legacy data');

-- Insert uses sufficient UTM evidence only. Neither a reused contact nor a
-- source network name or click ID alone constitutes acquisition evidence.
INSERT INTO public.deals(id,organization_id,board_id,stage_id,title,owner_id,contact_id,custom_fields) VALUES
  (crm_test.id(1101),crm_test.id(1),crm_test.id(100),crm_test.id(101),'Paid search',crm_test.id(11),crm_test.id(99),'{"utm_source":"GOOGLE","utm_medium":" CPC "}'),
  (crm_test.id(1102),crm_test.id(1),crm_test.id(100),crm_test.id(101),'Paid social',crm_test.id(11),crm_test.id(99),'{"utm_source":"instagram","utm_medium":"paid_social"}'),
  (crm_test.id(1103),crm_test.id(1),crm_test.id(100),crm_test.id(101),'Organic',crm_test.id(11),crm_test.id(99),'{"utm_source":"instagram","utm_medium":"organic"}'),
  (crm_test.id(1104),crm_test.id(1),crm_test.id(100),crm_test.id(101),'Ambiguous',crm_test.id(11),crm_test.id(99),'{"utm_source":"facebook","fbclid":"a-click-id"}'),
  (crm_test.id(1105),crm_test.id(1),crm_test.id(100),crm_test.id(101),'Missing',crm_test.id(11),crm_test.id(99),'{}'),
  (crm_test.id(1106),crm_test.id(1),crm_test.id(100),crm_test.id(101),'Legacy explicit empty',crm_test.id(11),crm_test.id(99),'{"origem":null,"utm_source":"google","utm_medium":"cpc"}');
SELECT crm_test.assert((SELECT lead_source='Google Ads' FROM public.deals WHERE id=crm_test.id(1101)),'new paid Google classification');
SELECT crm_test.assert((SELECT lead_source='Meta Ads' FROM public.deals WHERE id=crm_test.id(1102)),'new paid Meta classification');
SELECT crm_test.assert((SELECT lead_source='Orgânico/Rede Social' FROM public.deals WHERE id=crm_test.id(1103)),'explicit organic classification');
SELECT crm_test.assert((SELECT bool_and(lead_source IS NULL) FROM public.deals WHERE id IN(crm_test.id(1104),crm_test.id(1105),crm_test.id(1106))),'ambiguous, missing and explicitly unknown remain unknown despite contact reuse');
INSERT INTO public.deals(id,organization_id,board_id,stage_id,title,owner_id,lead_source,lead_source_initialized,custom_fields) VALUES
  (crm_test.id(1107),crm_test.id(1),crm_test.id(100),crm_test.id(101),'Explicit unknown',crm_test.id(11),NULL,true,'{"origem":"Meta Ads","utm_source":"google","utm_medium":"cpc"}');
SELECT crm_test.assert((SELECT lead_source IS NULL AND lead_source_initialized FROM public.deals WHERE id=crm_test.id(1107)),'explicit native null insert beats both legacy and paid UTMs');

-- New snapshots are independent of subsequent source edits. A simultaneous
-- transfer/source update snapshots OLD on exit and NEW on entry.
UPDATE public.deals SET lead_source='Indicação',stage_id=crm_test.id(102) WHERE id=crm_test.id(1101);
UPDATE public.deals SET board_id=crm_test.id(200),stage_id=crm_test.id(201),lead_source='Presencial' WHERE id=crm_test.id(1101);
SELECT crm_test.assert((SELECT lead_source='Google Ads' AND lead_source_snapshot_source='transition'
  FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(1101) AND event_type='entered_board' AND board_id=crm_test.id(100)),'creation snapshot stays at original acquisition');
SELECT crm_test.assert((SELECT bool_and(lead_source='Indicação' AND lead_source_snapshot_source='transition')
  FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(1101) AND event_type IN ('stage_changed','qualified','left_board')),'movement and transfer exit preserve their event source');
SELECT crm_test.assert((SELECT lead_source='Presencial' AND lead_source_snapshot_source='transition'
  FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(1101) AND event_type='entered_board' AND board_id=crm_test.id(200)),'transfer entry captures new source');
SELECT crm_test.assert((SELECT lead_source='Meta Ads' AND lead_source_snapshot_source='current'
  FROM public.deal_lifecycle_events WHERE deal_id=crm_test.id(1001) LIMIT 1),'legacy enrichment is frozen and never silently refreshed');

-- Actor headers cannot impersonate a bot from an authenticated user; service
-- integration identity follows the existing production current_actor helper.
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',crm_test.id(11))::text,false);
SELECT set_config('request.headers','{"x-crm-actor-kind":"bot","x-crm-actor-id":"00000000-0000-4000-8000-000000000099"}',false);
UPDATE public.deals SET lead_source='User acquisition' WHERE id=crm_test.id(1105);
SELECT crm_test.assert((SELECT actor_kind='user' AND actor_id=crm_test.id(11) FROM public.deal_events
  WHERE deal_id=crm_test.id(1105) AND kind='lead_source' ORDER BY created_at DESC LIMIT 1),'authenticated source audit cannot spoof bot');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
SELECT set_config('request.headers','{"x-crm-actor-kind":"integration","x-crm-actor-id":"00000000-0000-4000-8000-000000000099"}',false);
UPDATE public.deals SET lead_source=NULL WHERE id=crm_test.id(1105);
SELECT crm_test.assert(EXISTS(SELECT 1 FROM public.deal_events WHERE deal_id=crm_test.id(1105) AND kind='lead_source'
  AND actor_kind='integration' AND actor_id=crm_test.id(99) AND old_value='"User acquisition"'::jsonb AND new_value IS NULL),'integration source clear audit keeps actor and actual change');

UPDATE public.organization_settings SET lead_source_options=ARRAY[' Google Ads ','google ads','Feira regional'] WHERE organization_id=crm_test.id(1);
SELECT crm_test.assert((SELECT lead_source_options=ARRAY['Google Ads','Feira regional'] FROM public.organization_settings WHERE organization_id=crm_test.id(1)),'organization options normalized and deduped');
UPDATE public.organization_settings SET lead_source_options='{}' WHERE organization_id=crm_test.id(1);
SELECT crm_test.assert((SELECT cardinality(lead_source_options)=0 FROM public.organization_settings WHERE organization_id=crm_test.id(1)),'empty options intentionally distinct from defaults');
DO $$ BEGIN
  BEGIN UPDATE public.organization_settings SET lead_source_options=ARRAY[repeat('x',121)]; RAISE EXCEPTION 'accepted too long option'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.organization_settings SET lead_source_options=ARRAY[NULL::text]; RAISE EXCEPTION 'accepted null option'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.organization_settings SET lead_source_options=array_fill('x'::text,ARRAY[51]); RAISE EXCEPTION 'accepted too many options'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claim.sub',crm_test.id(11)::text,false);
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',crm_test.id(11))::text,false);
SET ROLE authenticated;
SELECT crm_test.assert(NOT EXISTS(SELECT 1 FROM public.deals WHERE organization_id=crm_test.id(2)),'foreign source invisible through existing deals RLS');
SELECT crm_test.assert(NOT EXISTS(SELECT 1 FROM public.deal_lifecycle_events WHERE organization_id=crm_test.id(2)),'new ledger source keeps existing visibility');
SELECT crm_test.assert((SELECT count(*)=1 FROM public.organization_settings),'options stay in visible organization');
UPDATE public.deals SET lead_source='Authorized source' WHERE id=crm_test.id(1107);
SELECT crm_test.assert((SELECT lead_source='Authorized source' AND lead_source_initialized FROM public.deals WHERE id=crm_test.id(1107)),
  'authorized user can write source through private triggers without direct helper execute grants');
WITH affected AS (UPDATE public.deals SET lead_source='Cross org attempt' WHERE id=crm_test.id(1003) RETURNING id)
  SELECT crm_test.assert(NOT EXISTS(SELECT 1 FROM affected),'source trigger does not bypass row update permissions');
DO $$ BEGIN
  BEGIN UPDATE public.deal_lifecycle_events SET lead_source='Tampered'; RAISE EXCEPTION 'client changed immutable source history'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.organization_settings SET lead_source_options=ARRAY['Client attempt']; RAISE EXCEPTION 'client bypassed settings API'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE service_role;
UPDATE public.organization_settings SET lead_source_options=NULL WHERE organization_id=crm_test.id(1);
SELECT crm_test.assert((SELECT lead_source_options IS NULL FROM public.organization_settings WHERE organization_id=crm_test.id(1)),
  'authorized settings API service role can restore defaults through validator');
DO $$ BEGIN
  BEGIN UPDATE public.deal_lifecycle_events SET lead_source='Service tamper'; RAISE EXCEPTION 'service modified snapshots directly'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT crm_test.assert(NOT has_function_privilege('authenticated','crm_internal.sync_deal_lead_source()','EXECUTE')
  AND NOT has_function_privilege('service_role','crm_internal.capture_lead_source_event()','EXECUTE'),'private trigger functions not callable by clients or service');
SELECT 'Native lead source SQL regressions passed (compatibility, inference, immutable snapshots, actor, RLS and zero operational backfill)' AS result;
