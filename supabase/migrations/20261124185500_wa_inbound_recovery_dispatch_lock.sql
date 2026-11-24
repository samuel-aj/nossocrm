begin;

-- claimLock() serializes the engine before it requests the dispatch phase.
-- The queue checks for a competing engine before that point. At dispatch the
-- current engine owns the lock; still check every independent sign of an answer.
create function crm_internal.wa_inbound_recovery_uncertain(q public.wa_inbound_work,p_check_lock boolean)
returns boolean language sql stable set search_path='' as $$
  select ((q.recover_only_if_unanswered or cardinality(q.completed_steps)=0) and exists (
    select 1 from public.wa_ai_agent_runs r
    where r.organization_id=q.organization_id and r.conversation_id=q.conversation_id
      and r.trigger='resume' and r.status in ('ok','error') and r.created_at>=q.created_at
      and r.created_at - greatest(coalesce(r.duration_ms,0),0) * interval '1 millisecond' >= q.created_at
  )) or (q.recover_only_if_unanswered and (
    exists (select 1 from public.wa_messages i join public.wa_messages o
      on o.organization_id=i.organization_id and o.conversation_id=i.conversation_id
      where i.id=q.message_id and i.organization_id=q.organization_id and i.conversation_id=q.conversation_id
        and o.direction='out' and (o.created_at>=i.created_at or o.wa_timestamp>=i.wa_timestamp))
    or exists (select 1 from public.wa_agent_connection_pending d
      where d.organization_id=q.organization_id and d.conversation_id=q.conversation_id
        and d.state in ('pending','dispatching','review') and d.created_at>=q.created_at)
    or (p_check_lock and exists (select 1 from public.wa_conversations c where c.id=q.conversation_id
      and c.organization_id=q.organization_id and c.ai_lock_until>now()))
  ));
$$;
revoke all on function crm_internal.wa_inbound_recovery_uncertain(public.wa_inbound_work,boolean) from public,anon,authenticated,service_role;

create or replace function crm_internal.wa_inbound_resume_uncertain(q public.wa_inbound_work)
returns boolean language sql stable set search_path='' as $$
  select crm_internal.wa_inbound_recovery_uncertain(q,true)
$$;

create or replace function public.advance_wa_inbound_work(
  p_message_id uuid,p_lease_token uuid,p_step text,p_finished boolean default false
) returns text language plpgsql security definer set search_path='' as $$
declare q public.wa_inbound_work; cancellation text;
begin
  if p_step is null or p_step not in ('bots','started','message_received','dispatch') or p_finished is null
    or (p_finished and p_step='dispatch') then raise exception 'invalid inbound phase'; end if;
  select w.* into q from public.wa_inbound_work w join public.wa_conversations c on c.id=w.conversation_id
    where w.message_id=p_message_id and w.lease_token=p_lease_token and w.available_at>clock_timestamp()
    for no key update of c,w;
  if not found then return 'stale'; end if;
  if p_finished then
    if q.active_step is distinct from p_step then return 'stale'; end if;
    update public.wa_inbound_work set state='claimed',completed_steps=array_append(completed_steps,p_step),
      active_step=null where message_id=q.message_id;
    return 'ready';
  end if;
  if q.active_step is not null or p_step=any(q.completed_steps) then return 'stale'; end if;
  cancellation := crm_internal.wa_inbound_cancel_reason(q,p_step,q.expires_at<=now());
  if cancellation is not null then
    update public.wa_inbound_work set state='cancelled',reason=cancellation,lease_token=null,finished_at=now() where message_id=q.message_id;
    return 'cancelled';
  end if;
  if q.expires_at<=now() or ((q.recover_only_if_unanswered or p_step='bots') and crm_internal.wa_inbound_recovery_uncertain(q,p_step<>'dispatch')) then
    update public.wa_inbound_work set state='review',
      reason=case when q.expires_at<=now() then 'expired' else 'dispatch_uncertain' end,
      lease_token=null,finished_at=now() where message_id=q.message_id;
    return 'stale';
  end if;
  update public.wa_inbound_work set state='dispatching',active_step=p_step where message_id=q.message_id;
  return 'ready';
end $$;

commit;
