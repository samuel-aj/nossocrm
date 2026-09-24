-- Staging only. Isolated organization, no connected numbers or bots; rolls back.
begin;
do $$
declare
  org uuid := gen_random_uuid(); contact uuid := gen_random_uuid();
  lead uuid := gen_random_uuid(); other_lead uuid := gen_random_uuid();
  conversation uuid := gen_random_uuid(); label uuid;
  original_deal jsonb; runs_before bigint; messages_before bigint;
begin
  insert into public.organizations(id,name) values(org,'TEST bot conversation link');
  insert into public.contacts(id,organization_id,name) values(contact,org,'TEST contact');
  insert into public.deals(id,organization_id,contact_id,title,tags,is_lost)
    values(lead,org,contact,'TEST lost lead',array['Recuperação'],true),
          (other_lead,org,contact,'TEST other lead','{}',false);
  insert into public.wa_labels(organization_id,name) values(org,'Resposta') returning id into label;
  insert into public.wa_conversations(id,organization_id,contact_id,wa_phone,label_ids)
    values(conversation,org,contact,'test-'||gen_random_uuid(),array[label]);
  select to_jsonb(d)-'tags'-'updated_at' into original_deal from public.deals d where id=lead;
  select count(*) into runs_before from public.wa_bot_runs where organization_id=org;
  select count(*) into messages_before from public.wa_messages where organization_id=org;

  update public.wa_conversations c set deal_id=d.id from public.deals d
    where d.id=lead and d.organization_id=org and d.deleted_at is null
      and c.id=conversation and c.organization_id=org and c.contact_id=d.contact_id
      and c.is_group=false and c.deal_id is null;
  assert (select deal_id=lead from public.wa_conversations where id=conversation),'Missing link';
  assert (select tags @> array['Recuperação','Resposta'] from public.deals where id=lead),'Labels lost';
  assert (select cardinality(label_ids)=2 from public.wa_conversations where id=conversation),'Chat labels not synchronized';
  assert (select to_jsonb(d)-'tags'-'updated_at'=original_deal from public.deals d where id=lead),'Link changed lead business fields';
  assert (select count(*)=runs_before from public.wa_bot_runs where organization_id=org),'Link started another bot';
  assert (select count(*)=messages_before from public.wa_messages where organization_id=org),'Link created a message';

  -- Existing user selection must win even when the acquisition is retried.
  update public.wa_conversations c set deal_id=other_lead
    where c.id=conversation and c.organization_id=org and c.contact_id=contact
      and c.is_group=false and c.deal_id is null;
  assert (select deal_id=lead from public.wa_conversations where id=conversation),'Existing link overwritten';
end $$;
rollback;
