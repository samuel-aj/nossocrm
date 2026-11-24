begin;

alter table public.crm_notification_events drop constraint crm_notification_events_kind_check;
alter table public.crm_notification_events add constraint crm_notification_events_kind_check
  check (kind in ('message', 'lead', 'alert', 'audio_transcription', 'human_handoff', 'wa_entry_recovery'));

create unique index crm_notification_entry_recovery_once on public.crm_notification_events (organization_id, source_id)
  where kind = 'wa_entry_recovery';

-- The queue revalidates the inbound before marking it for human review.
-- Keep the event and that decision in the same transaction.
create function crm_internal.notify_wa_entry_recovery() returns trigger
language plpgsql set search_path = '' as $$
begin
  insert into public.crm_notification_events (organization_id, kind, source_id)
    values (new.organization_id, 'wa_entry_recovery', new.message_id)
    on conflict (organization_id, source_id) where kind = 'wa_entry_recovery' do nothing;
  return new;
end;
$$;
revoke all on function crm_internal.notify_wa_entry_recovery() from public, anon, authenticated;
create trigger notify_wa_entry_recovery after update of state on public.wa_inbound_work
  for each row when (old.state is distinct from new.state and new.state = 'review')
  execute function crm_internal.notify_wa_entry_recovery();

-- Cover work that reached review between installing the queue and its bell.
insert into public.crm_notification_events (organization_id, kind, source_id, created_at)
  select w.organization_id, 'wa_entry_recovery', w.message_id, w.finished_at
  from public.wa_inbound_work w
  where w.state = 'review' and w.finished_at >= now() - interval '24 hours'
    and crm_internal.wa_inbound_cancel_reason(w, 'recovery', true) is null
  on conflict (organization_id, source_id) where kind = 'wa_entry_recovery' do nothing;

-- The feed uses the same conversation permissions as Chats for the current
-- recipient and for a proposed owner before routing to an administrator.
create function public.wa_entry_recovery_details(p_org uuid, p_user uuid, p_messages uuid[])
returns table (message_id uuid, conversation_id uuid, contact_id uuid, connection_id uuid,
  label_ids uuid[], owner_id uuid, owner_role text, reason text)
language sql stable security definer set search_path = '' as $$
  select w.message_id, c.id, c.contact_id, c.connection_id, c.label_ids, p.id,
    case when p.role = 'super_admin' then p.role else coalesce(m.role, p.role) end,
    case w.reason when 'attempts_exhausted' then 'attempts_exhausted' when 'expired' then 'expired' else 'uncertain' end
  from public.wa_inbound_work w
  join public.wa_conversations c on c.id = w.conversation_id and c.organization_id = w.organization_id
  join public.wa_messages i on i.id = w.message_id and i.conversation_id = c.id and i.organization_id = c.organization_id
  left join public.deals linked on linked.id = c.deal_id and linked.organization_id = c.organization_id and linked.deleted_at is null
  left join lateral (
    select d.owner_id from public.deals d
    where d.organization_id = c.organization_id and d.contact_id = c.contact_id and d.deleted_at is null
    order by (not d.is_won and not d.is_lost) desc nulls last, d.created_at desc, d.id
    limit 1
  ) contact_deal on true
  left join public.profiles p on p.id = coalesce(linked.owner_id, contact_deal.owner_id, c.assigned_owner_id)
    and private.team_is_org_member(w.organization_id, p.id)
  left join public.user_organizations m on m.organization_id = w.organization_id and m.user_id = p.id
  where w.organization_id = p_org and w.message_id = any(p_messages) and w.state = 'review'
    and not c.is_group and i.direction = 'in' and i.deleted_at is null
    and private.team_is_org_member(p_org, p_user)
    and crm_internal.wa_inbound_cancel_reason(w, 'recovery', true) is null;
$$;
revoke all on function public.wa_entry_recovery_details(uuid,uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.wa_entry_recovery_details(uuid,uuid,uuid[]) to service_role;

commit;
