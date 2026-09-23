-- Staging DEMO fixtures only. All changes, including queued work, are rolled back.
BEGIN;
CREATE TEMP TABLE crm_test_results(test text, passed boolean);
GRANT ALL ON crm_test_results TO authenticated;
UPDATE public.organization_settings SET lead_distribution_enabled=true, lead_distribution_manual=true
 WHERE organization_id='428e1830-2ff5-425a-b9b1-f9379897c2c6';
UPDATE public.lead_distribution SET active=false WHERE organization_id='428e1830-2ff5-425a-b9b1-f9379897c2c6';
INSERT INTO public.lead_distribution(organization_id,user_id,weight,active)
 VALUES('428e1830-2ff5-425a-b9b1-f9379897c2c6','d08ed7fb-95ac-4820-a209-0e844cab0d74',100,true)
 ON CONFLICT(organization_id,user_id) DO UPDATE SET active=true,weight=100;
SET LOCAL request.jwt.claims = '{"role":"authenticated","sub":"d57196ab-ff56-4802-a181-3de195a3ed0f"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE sid uuid; did uuid; owner uuid;
BEGIN
 SELECT id INTO sid FROM public.board_stages WHERE board_id='bb7b7e2b-2818-4579-ae20-bf052e51cf41' ORDER BY "order" LIMIT 1;
 INSERT INTO public.deals(organization_id,board_id,stage_id,status,title,value,is_won,is_lost)
 VALUES('428e1830-2ff5-425a-b9b1-f9379897c2c6','bb7b7e2b-2818-4579-ae20-bf052e51cf41',sid,sid::text,'TESTE: manual sem responsável elegível',0,false,false)
 RETURNING id,owner_id INTO did,owner;
 IF owner IS NOT NULL THEN RAISE EXCEPTION 'Super admin received lead'; END IF;
 INSERT INTO crm_test_results VALUES('manual creation survives ineligible distribution entry',true);
END $$;
RESET ROLE;
INSERT INTO public.lead_distribution(organization_id,user_id,weight,active)
 VALUES('428e1830-2ff5-425a-b9b1-f9379897c2c6','d57196ab-ff56-4802-a181-3de195a3ed0f',100,true)
 ON CONFLICT(organization_id,user_id) DO UPDATE SET active=true,weight=100;
SET LOCAL ROLE authenticated;
DO $$ DECLARE sid uuid; owner uuid;
BEGIN
 SELECT id INTO sid FROM public.board_stages WHERE board_id='bb7b7e2b-2818-4579-ae20-bf052e51cf41' ORDER BY "order" LIMIT 1;
 INSERT INTO public.deals(organization_id,board_id,stage_id,status,title,value,is_won,is_lost)
 VALUES('428e1830-2ff5-425a-b9b1-f9379897c2c6','bb7b7e2b-2818-4579-ae20-bf052e51cf41',sid,sid::text,'TESTE: manual com rodízio',0,false,false)
 RETURNING owner_id INTO owner;
 IF owner IS DISTINCT FROM 'd57196ab-ff56-4802-a181-3de195a3ed0f'::uuid THEN RAISE EXCEPTION 'Valid owner not assigned'; END IF;
 INSERT INTO crm_test_results VALUES('manual creation assigns valid organization member',true);
END $$;
RESET ROLE;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
DO $$ DECLARE org uuid := '428e1830-2ff5-425a-b9b1-f9379897c2c6'; sid uuid; cid uuid; did uuid; bot uuid; batch uuid:=gen_random_uuid(); targets jsonb; r jsonb; n integer;
BEGIN
 SELECT id INTO sid FROM public.board_stages WHERE board_id='bb7b7e2b-2818-4579-ae20-bf052e51cf41' ORDER BY "order" LIMIT 1;
 INSERT INTO public.contacts(organization_id,name,phone) VALUES(org,'TESTE: lote rollback','+12025550123') RETURNING id INTO cid;
 INSERT INTO public.deals(organization_id,board_id,stage_id,title,contact_id,is_won,is_lost)
 VALUES(org,'bb7b7e2b-2818-4579-ae20-bf052e51cf41',sid,'TESTE: lote rollback',cid,false,false) RETURNING id INTO did;
 INSERT INTO public.wa_bots(organization_id,name,enabled,steps) VALUES(org,'TESTE: robô sem envio',true,'[{"id":"fim","type":"end"}]') RETURNING id INTO bot;
 targets:=jsonb_build_array(jsonb_build_object('deal_id',did,'contact_id',cid,'phone','+12025550123'));
 r:=public.enqueue_bulk_bot_runs(org,bot,batch,targets);
 IF r->0->>'status'<>'queued' THEN RAISE EXCEPTION 'Not queued: %',r; END IF;
 r:=public.enqueue_bulk_bot_runs(org,bot,batch,targets);
 IF r->0->>'status'<>'existing' THEN RAISE EXCEPTION 'Retry was not idempotent'; END IF;
 SELECT count(*) INTO n FROM public.wa_bot_runs WHERE bulk_batch_id=batch;
 IF n<>1 THEN RAISE EXCEPTION 'Duplicate execution'; END IF;
 INSERT INTO crm_test_results VALUES('same batch retry creates exactly one execution',true);
 r:=public.enqueue_bulk_bot_runs(org,bot,gen_random_uuid(),targets);
 IF r->0->>'status'<>'skipped' THEN RAISE EXCEPTION 'Active robot overwritten'; END IF;
 INSERT INTO crm_test_results VALUES('active conversation not restarted by another batch',true);
 r:=public.enqueue_bulk_bot_runs(org,bot,gen_random_uuid(),jsonb_build_array(jsonb_build_object('deal_id',gen_random_uuid(),'contact_id',cid,'phone','+12025550124')));
 IF r->0->>'status'<>'skipped' THEN RAISE EXCEPTION 'Invalid lead accepted'; END IF;
 INSERT INTO crm_test_results VALUES('unknown lead excluded',true);
 IF has_function_privilege('authenticated','public.enqueue_bulk_bot_runs(uuid,uuid,uuid,jsonb)','execute') OR has_function_privilege('anon','public.enqueue_bulk_bot_runs(uuid,uuid,uuid,jsonb)','execute') THEN RAISE EXCEPTION 'Public queue access'; END IF;
 INSERT INTO crm_test_results VALUES('only backend can enqueue bulk runs',true);
END $$;
SELECT * FROM crm_test_results;
ROLLBACK;
