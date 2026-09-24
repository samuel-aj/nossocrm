-- Run as postgres against staging AFTER applying migration. Everything is isolated
-- in new organizations and rolled back. No customer rows or messages touched.
begin;
do $$
declare org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid();
 d uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); r uuid:=gen_random_uuid();
 old_id uuid; new_id uuid; n int;
begin
 insert into public.organizations(id,name) values(org,'TEST recovery alerts'),(other_org,'TEST foreign alerts');
 insert into public.deals(id,organization_id,title) values(d,org,'TEST recovery alert lead');
 insert into public.wa_bots(id,organization_id,name,enabled,trigger) values(b,org,'TEST alerts',false,'{"type":"manual"}');
 insert into public.wa_bot_runs(id,organization_id,bot_id,deal_id,status) values(r,org,b,d,'done');
 old_id:=public.activate_deal_alert(org,d,b,r,'alert-1','Respondeu à recuperação');
 assert public.activate_deal_alert(org,d,b,r,'alert-1','Duplicate')=old_id,'resume must return same immutable ID';
 select count(*) into n from public.deal_alert_events where run_id=r;
 assert n=1,'duplicate audit event';
 select count(*) into n from public.crm_notification_events where kind='alert' and source_id=old_id;
 assert n=1,'duplicate notification';
 new_id:=public.activate_deal_alert(org,d,b,r,'alert-2','Novo alerta');
 assert not public.acknowledge_deal_alert(org,d,old_id,gen_random_uuid()),'old acknowledgement cleared newer alert';
 assert (select active_alert->>'id' from public.deals where id=d)=new_id::text,'new alert lost';
 assert not public.acknowledge_deal_alert(other_org,d,new_id,gen_random_uuid()),'foreign org acknowledged';
 begin
   perform public.activate_deal_alert(other_org,d,b,r,'foreign','Forbidden');
   raise exception 'foreign org activation was accepted';
 exception when raise_exception then
   if SQLERRM='foreign org activation was accepted' then raise; end if;
 end;
 assert public.acknowledge_deal_alert(org,d,new_id,gen_random_uuid()),'current alert not acknowledged';
 assert not public.acknowledge_deal_alert(org,d,new_id,gen_random_uuid()),'repeat acknowledge changed history';
 assert public.activate_deal_alert(org,d,b,r,'alert-2','Retry')=new_id,'resume after ack changed ID';
 assert (select active_alert is null from public.deals where id=d),'resume after ack reactivated alert';
 assert not has_function_privilege('authenticated','public.activate_deal_alert(uuid,uuid,uuid,uuid,text,text)','EXECUTE'),'public activation';
 assert not has_function_privilege('authenticated','public.acknowledge_deal_alert(uuid,uuid,uuid,uuid)','EXECUTE'),'public acknowledgement';
 assert not has_table_privilege('authenticated','public.deal_alert_events','SELECT'),'audit exposed';
 -- A temporary permissive policy exposes only this isolated fixture row so
 -- an authenticated direct write must still be denied by the server-managed guard.
 execute format('create policy alert_fixture_write on public.deals for all to authenticated using (id=%L::uuid) with check (id=%L::uuid)',d,d);
 begin
   execute 'set local role authenticated';
   update public.deals set active_alert=jsonb_build_object('id',new_id,'message','forged') where id=d;
   if found then raise exception 'authenticated forged an alert'; end if;
   execute 'reset role';
 exception when insufficient_privilege then
   execute 'reset role';
 end;
 assert (select active_alert is null from public.deals where id=d),'authenticated forged active_alert';
end $$;
rollback;
