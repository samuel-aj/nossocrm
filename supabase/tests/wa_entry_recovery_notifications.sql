-- Local synthetic orgs from test/verify-wa-inbound-work.mjs.
begin;
do $$
declare
  org uuid := '00000000-0000-4000-8000-000000000001';
  foreign_org uuid := '00000000-0000-4000-8000-000000000002';
  agent_user uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  conv uuid := gen_random_uuid();
  msg uuid := gen_random_uuid();
  before_count integer;
begin
  insert into public.profiles (id,organization_id,role) values (agent_user,org,'admin'),(outsider,foreign_org,'admin');
  insert into public.wa_conversations (id,organization_id,is_group,assigned_owner_id) values (conv,org,false,agent_user);
  insert into public.wa_messages (id,organization_id,conversation_id,direction,status,created_at)
    values (msg,org,conv,'in','received',now()-interval '30 seconds');
  insert into public.wa_inbound_work (message_id,organization_id,conversation_id) values (msg,org,conv)
    on conflict (message_id) do nothing;
  update public.wa_inbound_work set state='review', reason='attempts_exhausted', finished_at=now() where message_id=msg;
  select count(*) into before_count from public.crm_notification_events where organization_id=org and kind='wa_entry_recovery' and source_id=msg;
  assert before_count=1, 'missing recovery journal event';
  assert exists (select from public.wa_entry_recovery_details(org,agent_user,array[msg]) r
    where r.message_id=msg and r.conversation_id=conv and r.owner_id=agent_user and r.reason='attempts_exhausted'),
    'an assigned conversation without a lead must be routable';
  assert not exists (select from public.wa_entry_recovery_details(org,outsider,array[msg])), 'foreign user could read the review';
  assert not exists (select from public.wa_entry_recovery_details(foreign_org,outsider,array[msg])), 'foreign message projected';
  assert not has_function_privilege('authenticated','public.wa_entry_recovery_details(uuid,uuid,uuid[])','execute'), 'review RPC exposed';
  update public.wa_conversations set assigned_owner_id=outsider where id=conv;
  assert exists (select from public.wa_entry_recovery_details(org,agent_user,array[msg]) r where r.owner_id is null),
    'foreign owner must fall back to an administrator';
  update public.wa_inbound_work set state='pending',finished_at=null where message_id=msg;
  update public.wa_inbound_work set state='review', reason='dispatch_uncertain',finished_at=now() where message_id=msg;
  assert (select count(*) from public.crm_notification_events where organization_id=org and kind='wa_entry_recovery' and source_id=msg)=1,
    'repeating a review must not duplicate the bell';
  assert exists (select from public.wa_entry_recovery_details(org,agent_user,array[msg]) r where r.reason='uncertain'),
    'uncertainty should remain distinguishable from exhaustion';
  insert into public.wa_messages (id,organization_id,conversation_id,direction,status,created_at)
    values (gen_random_uuid(),org,conv,'out','sent',now());
  assert not exists (select from public.wa_entry_recovery_details(org,agent_user,array[msg])),
    'an inbound answered after escalation should disappear on replay';
end $$;
rollback;
