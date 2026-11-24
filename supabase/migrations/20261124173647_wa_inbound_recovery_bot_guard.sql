begin;

-- A backlog's first attempt is still a recovery. Only the trigger's prompt
-- notification may start an independent bot on an already-paused conversation.
alter table public.wa_inbound_work add column direct_wakeup boolean not null default false;

create or replace function crm_internal.wa_inbound_cancel_reason(
  q public.wa_inbound_work, p_step text, p_terminal boolean
) returns text language plpgsql stable set search_path='' as $$
declare
  c public.wa_conversations;
  m public.wa_messages;
  -- expires_at was derived from the earliest of receipt time and provider time.
  first_bots boolean := p_step='bots' and q.direct_wakeup and q.attempts<=1 and not p_terminal
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
  if exists (select 1 from public.wa_messages o where o.organization_id=q.organization_id
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

-- An explicit resumption that started after this inbound may have produced a
-- partial effect. If there is no cursor or human reply yet, surface it for review.
create function crm_internal.wa_inbound_resume_uncertain(q public.wa_inbound_work)
returns boolean language sql stable set search_path='' as $$
  select cardinality(q.completed_steps)=0 and exists (
    select 1 from public.wa_ai_agent_runs r
    where r.organization_id=q.organization_id and r.conversation_id=q.conversation_id
      and r.trigger='resume' and r.status in ('ok','error') and r.created_at>=q.created_at
      and r.created_at - greatest(coalesce(r.duration_ms,0),0) * interval '1 millisecond' >= q.created_at
  );
$$;
revoke all on function crm_internal.wa_inbound_resume_uncertain(public.wa_inbound_work) from public, anon, authenticated;

create or replace function public.claim_wa_inbound_work(
  p_message_id uuid default null,p_limit integer default 1,p_org uuid default null,p_conversation uuid default null
) returns setof public.wa_inbound_work language plpgsql security definer set search_path='' as $$
declare
  q public.wa_inbound_work;
  final_reason text;
  cancellation text;
  take_count integer := least(10,greatest(1,coalesce(p_limit,1)));
  taken integer := 0;
begin
  if p_message_id is not null and (p_org is null or p_conversation is null) then return; end if;
  for i in 1..(take_count*3) loop
    select w.* into q from public.wa_inbound_work w join public.wa_conversations c
      on c.id=w.conversation_id and c.organization_id=w.organization_id
    where w.state in ('pending','claimed','dispatching') and w.available_at<=now()
      and (p_org is null or w.organization_id=p_org) and (p_conversation is null or w.conversation_id=p_conversation)
      and (p_message_id is null or (w.message_id=p_message_id and w.state='pending' and w.attempts=0))
      and not exists (select 1 from public.wa_inbound_work other where other.conversation_id=w.conversation_id
        and other.message_id<>w.message_id and other.state in ('pending','claimed','dispatching')
        and (other.state in ('claimed','dispatching') or (w.state='pending' and other.arrival<w.arrival)))
    order by w.available_at,w.arrival limit 1 for no key update of c,w skip locked;
    exit when not found;
    final_reason := case when q.active_step is not null then 'dispatch_uncertain'
      when q.expires_at<=now() then 'expired'
      when q.attempts>=5 then 'attempts_exhausted' end;
    q.direct_wakeup := p_message_id is not null and q.attempts=0 and final_reason is null;
    if q.direct_wakeup then
      cancellation := crm_internal.wa_inbound_cancel_reason(q,'bots',false);
    else
      cancellation := crm_internal.wa_inbound_cancel_reason(q,'recovery',true);
    end if;
    if cancellation is null and final_reason is null and crm_internal.wa_inbound_resume_uncertain(q) then
      final_reason := 'dispatch_uncertain';
    end if;
    if final_reason is not null or cancellation is not null then
      update public.wa_inbound_work set state=case when cancellation is null then 'review' else 'cancelled' end,
        reason=coalesce(cancellation,final_reason),lease_token=null,active_step=null,finished_at=now() where message_id=q.message_id;
    else
      update public.wa_inbound_work set attempts=attempts+1,state='claimed',lease_token=gen_random_uuid(),
        direct_wakeup=q.direct_wakeup,active_step=null,available_at=clock_timestamp()+interval '7 minutes'
        where message_id=q.message_id returning * into q;
      return next q;
      taken := taken+1;
      exit when taken>=take_count;
    end if;
  end loop;
end $$;

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
  if q.expires_at<=now() or (p_step='bots' and crm_internal.wa_inbound_resume_uncertain(q)) then
    update public.wa_inbound_work set state='review',
      reason=case when q.expires_at<=now() then 'expired' else 'dispatch_uncertain' end,
      lease_token=null,finished_at=now() where message_id=q.message_id;
    return 'stale';
  end if;
  update public.wa_inbound_work set state='dispatching',active_step=p_step where message_id=q.message_id;
  return 'ready';
end $$;

commit;
