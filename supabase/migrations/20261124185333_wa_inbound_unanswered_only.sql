begin;

-- Incident-specific recovery. The marker outlives retries and the reopening
-- of ordinary intake. Fresh conversations normally keep existing semantics.
alter table public.wa_inbound_work add column recover_only_if_unanswered boolean not null default false;

-- Change admission and mark the current backlog under one table lock. Closing
-- the window restores the normal default without releasing already marked rows.
create function crm_internal.set_wa_unanswered_recovery_window(p_open boolean)
returns bigint language plpgsql set search_path='' as $$
declare marked bigint := 0;
begin
  if p_open is null then raise exception 'missing recovery window state'; end if;
  if p_open then
    alter table public.wa_inbound_work alter column recover_only_if_unanswered set default true;
    update public.wa_inbound_work set recover_only_if_unanswered=true
      where state in ('pending','claimed','dispatching') and not recover_only_if_unanswered;
    get diagnostics marked=row_count;
  else
    alter table public.wa_inbound_work alter column recover_only_if_unanswered set default false;
  end if;
  return marked;
end $$;
revoke all on function crm_internal.set_wa_unanswered_recovery_window(boolean) from public,anon,authenticated,service_role;

create or replace function crm_internal.wa_inbound_cancel_reason(
  q public.wa_inbound_work, p_step text, p_terminal boolean
) returns text language plpgsql stable set search_path='' as $$
declare
  c public.wa_conversations;
  m public.wa_messages;
  -- expires_at was derived from the earliest of receipt time and provider time.
  first_bots boolean := p_step='bots' and not q.recover_only_if_unanswered and q.direct_wakeup and q.attempts<=1 and not p_terminal
    and q.expires_at - interval '24 hours' > now() - interval '1 minute';
begin
  select * into c from public.wa_conversations where id=q.conversation_id and organization_id=q.organization_id;
  if not found or c.is_group or c.connection_id is distinct from q.connection_id then return 'conversation_changed'; end if;
  select * into m from public.wa_messages where id=q.message_id and organization_id=q.organization_id
    and conversation_id=q.conversation_id and direction='in' and deleted_at is null;
  if not found then return 'message_unavailable'; end if;
  -- Bots have always been able to run independently of AI status. Preserve that
  -- first delivery, except when a new operator action happened after admission.
  if (c.ai_status in ('paused','stopped','awaiting_approval') or c.ai_approval is not null)
    and not (first_bots and c.ai_status_changed_at is not distinct from q.initial_status_at)
    then return 'manual_or_paused'; end if;
  if c.ai_last_processed_at >= m.created_at then return 'already_processed'; end if;
  -- Initial assignment by an earlier turn can change ai_status_changed_at after
  -- this message arrives. Only a cursor covering this message proves it was read.
  -- For an incident replay, only a confirmed human delivery proves an answer.
  -- The uncertainty guard handles agent, bot and unconfirmed deliveries.
  if q.recover_only_if_unanswered then
    if exists (select 1 from public.wa_messages o
      where o.organization_id=q.organization_id and o.conversation_id=c.id and o.direction='out'
        and (o.created_at>=m.created_at or o.wa_timestamp>=m.wa_timestamp)
        and o.status in ('sent','delivered','read') and o.source='crm')
      then return 'already_answered'; end if;
  elsif exists (select 1 from public.wa_messages o where o.organization_id=q.organization_id
    and o.conversation_id=c.id and o.direction='out' and o.created_at>=m.created_at and o.status<>'failed'
    -- Even a delivered agent message may be a proactive greeting or just the
    -- first part of the answer. The agent's cursor confirms the whole turn.
    and (coalesce(o.source,'') not in ('bot','agent')
      or (o.source='bot' and (p_terminal or q.attempts>1 or (p_step='bots' and not first_bots)))))
    then return 'already_answered'; end if;
  if exists (select 1 from public.wa_agent_connection_pending d where d.organization_id=q.organization_id
    and d.conversation_id=c.id and d.inbound_id=q.message_id) then return 'connection_queue'; end if;
  if not first_bots and exists (select 1 from public.wa_messages n where n.organization_id=q.organization_id
    and n.conversation_id=c.id and n.direction='in' and n.deleted_at is null
    and (n.created_at,n.id)>(m.created_at,m.id)) then return 'superseded'; end if;
  return null;
end $$;

create or replace function crm_internal.wa_inbound_resume_uncertain(q public.wa_inbound_work)
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
    or exists (select 1 from public.wa_conversations c where c.id=q.conversation_id
      and c.organization_id=q.organization_id and c.ai_lock_until>now())
  ));
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
  if q.expires_at<=now() or ((q.recover_only_if_unanswered or p_step='bots') and crm_internal.wa_inbound_resume_uncertain(q)) then
    update public.wa_inbound_work set state='review',
      reason=case when q.expires_at<=now() then 'expired' else 'dispatch_uncertain' end,
      lease_token=null,finished_at=now() where message_id=q.message_id;
    return 'stale';
  end if;
  update public.wa_inbound_work set state='dispatching',active_step=p_step where message_id=q.message_id;
  return 'ready';
end $$;

commit;
