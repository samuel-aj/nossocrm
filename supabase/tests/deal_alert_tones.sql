-- Isolated synthetic fixtures only; the local runner uses in-memory PostgreSQL.
begin;
do $$
declare org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid();
  d uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); r uuid:=gen_random_uuid();
  legacy_id uuid; red_id uuid; event_count int; note_count int;
begin
  insert into public.organizations(id,name) values(org,'TEST alert tones'),(other_org,'TEST foreign');
  insert into public.deals(id,organization_id,title) values(d,org,'TEST tone lead');
  insert into public.wa_bots(id,organization_id,name,enabled,trigger) values(b,org,'TEST alert tones',false,'{"type":"manual"}');
  insert into public.wa_bot_runs(id,organization_id,bot_id,deal_id,status) values(r,org,b,d,'done');
  legacy_id:=public.activate_deal_alert(org,d,b,r,'old','Legacy caller');
  assert (select tone='green' from public.deal_alert_events where id=legacy_id),'legacy event not green';
  assert (select active_alert->>'tone'='green' from public.deals where id=d),'legacy active not green';
  red_id:=public.activate_deal_alert_with_tone(org,d,b,r,'red','  Documentos pendentes  ','red');
  assert (select tone='red' and message='Documentos pendentes' from public.deal_alert_events where id=red_id),'red event lost';
  assert (select active_alert->>'tone'='red' and active_alert->>'id'=red_id::text from public.deals where id=d),'red active lost';
  assert public.activate_deal_alert_with_tone(org,d,b,r,'red','Retry','green')=red_id,'retry changed event';
  assert public.activate_deal_alert(org,d,b,r,'red','Old client retry')=red_id,'legacy retry changed event';
  assert (select tone='red' and message='Documentos pendentes' from public.deal_alert_events where id=red_id),'retry changed event data';
  assert (select active_alert->>'tone'='red' from public.deals where id=d),'retry changed active tone';
  select count(*) into event_count from public.deal_alert_events where run_id=r;
  assert event_count=2,'duplicate events';
  select count(*) into note_count from public.crm_notification_events where kind='alert' and source_id=red_id;
  assert note_count=1,'duplicate notification';
  assert not public.acknowledge_deal_alert(org,d,legacy_id,gen_random_uuid()),'stale acknowledgement cleared red alert';
  assert not public.acknowledge_deal_alert(other_org,d,red_id,gen_random_uuid()),'foreign acknowledgement';
  begin
    perform public.activate_deal_alert_with_tone(other_org,d,b,r,'foreign','Forbidden','red');
    raise exception 'foreign activation accepted';
  exception when raise_exception then
    if SQLERRM='foreign activation accepted' then raise; end if;
  end;
  begin
    perform public.activate_deal_alert_with_tone(org,d,b,gen_random_uuid(),'wrong-run','Forbidden','red');
    raise exception 'foreign run accepted';
  exception when raise_exception then
    if SQLERRM='foreign run accepted' then raise; end if;
  end;
  begin
    perform public.activate_deal_alert_with_tone(org,d,b,r,'purple','Reserved for AI','purple');
    raise exception 'unsupported tone accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.activate_deal_alert_with_tone(org,d,b,r,'null','Invalid',null);
    raise exception 'null tone accepted';
  exception when invalid_parameter_value then null;
  end;
  assert (select count(*)=event_count from public.deal_alert_events where run_id=r),'invalid call wrote event';
  assert (select active_alert->>'id'=red_id::text from public.deals where id=d),'failed call changed active alert';
  assert public.acknowledge_deal_alert(org,d,red_id,gen_random_uuid()),'current alert not acknowledged';
  assert (select acknowledged_at is not null and tone='red' from public.deal_alert_events where id=red_id),'ack lost tone';
  assert public.activate_deal_alert_with_tone(org,d,b,r,'red','Retry after ack','green')=red_id,'ack retry changed ID';
  assert (select active_alert is null from public.deals where id=d),'ack retry reactivated alert';
  assert not has_function_privilege('authenticated','public.activate_deal_alert_with_tone(uuid,uuid,uuid,uuid,text,text,text)','EXECUTE'),'new function exposed to authenticated';
  assert not has_function_privilege('anon','public.activate_deal_alert_with_tone(uuid,uuid,uuid,uuid,text,text,text)','EXECUTE'),'new function exposed to anon';
  assert has_function_privilege('service_role','public.activate_deal_alert_with_tone(uuid,uuid,uuid,uuid,text,text,text)','EXECUTE'),'service cannot activate';
  assert not has_function_privilege('authenticated','public.activate_deal_alert(uuid,uuid,uuid,uuid,text,text)','EXECUTE'),'legacy function exposed';
  assert not has_table_privilege('authenticated','public.deal_alert_events','SELECT'),'event audit exposed';
  assert (select count(*)=1 from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.proname='activate_deal_alert'),'legacy RPC overloaded';
  assert (select count(*)=1 from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.proname='activate_deal_alert_with_tone'),'new RPC overloaded';
  assert not (select prosecdef from pg_proc where oid='public.activate_deal_alert_with_tone(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure),'new function bypasses RLS';
  execute 'set local role service_role';
  red_id:=public.activate_deal_alert_with_tone(org,d,b,r,'service','Service-only activation','red');
  assert (select active_alert->>'tone'='red' from public.deals where id=d),'service role did not activate red alert';
  assert public.acknowledge_deal_alert(org,d,red_id,gen_random_uuid()),'service role could not acknowledge';
  execute 'reset role';
end $$;
rollback;
select 'PASS: alert tones, idempotency, expected-ID acknowledgement, org/run guards, ACL and unique RPC names' as result;
