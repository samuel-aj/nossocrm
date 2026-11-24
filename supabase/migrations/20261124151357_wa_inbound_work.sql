begin;

-- An entry is the original received message, including when the delivery of the
-- immediate pg_net notification fails. Installing this does not replay history.
create table public.wa_inbound_work (
  message_id uuid primary key references public.wa_messages(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.wa_conversations(id) on delete cascade,
  arrival bigint generated always as identity,
  connection_id uuid,
  initial_status_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '24 hours',
  available_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts between 0 and 5),
  state text not null default 'pending' check (state in ('pending','claimed','dispatching','done','cancelled','review')),
  lease_token uuid,
  active_step text check (active_step in ('bots','started','message_received','dispatch')),
  completed_steps text[] not null default '{}',
  reason text,
  last_failure text,
  finished_at timestamptz,
  check ((state in ('claimed','dispatching')) = (lease_token is not null)),
  check ((state='dispatching') = (active_step is not null)),
  check ((state in ('done','cancelled','review')) = (finished_at is not null))
);
alter table public.wa_inbound_work enable row level security;
revoke all on public.wa_inbound_work from public, anon, authenticated, service_role;
grant select on public.wa_inbound_work to service_role;
revoke all on sequence public.wa_inbound_work_arrival_seq from public, anon, authenticated, service_role;
create index wa_inbound_work_due on public.wa_inbound_work(available_at,arrival)
  where state in ('pending','claimed','dispatching');
create index wa_inbound_work_conversation on public.wa_inbound_work(conversation_id,arrival)
  where state in ('pending','claimed','dispatching');
create unique index wa_inbound_work_one_lease on public.wa_inbound_work(conversation_id)
  where state in ('claimed','dispatching');
create index wa_inbound_work_finished on public.wa_inbound_work(finished_at) where finished_at is not null;

-- The caller holds the conversation row lock. Check the live conversation,
-- not the state observed by a previous delivery attempt.
create function crm_internal.wa_inbound_cancel_reason(
  q public.wa_inbound_work, p_step text, p_terminal boolean
) returns text language plpgsql stable set search_path='' as $$
declare
  c public.wa_conversations;
  m public.wa_messages;
  first_bots boolean := p_step='bots' and q.attempts<=1 and not p_terminal;
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
  if exists (select 1 from public.wa_messages o where o.organization_id=q.organization_id
    and o.conversation_id=c.id and o.direction='out' and o.created_at>=m.created_at and o.status<>'failed'
    -- Even a delivered agent message may be a proactive greeting or just the
    -- first part of the answer. The agent's cursor confirms the whole turn.
    and (coalesce(o.source,'') not in ('bot','agent')
      or (o.source='bot' and (p_terminal or q.attempts>1))))
    then return 'already_answered'; end if;
  if exists (select 1 from public.wa_agent_connection_pending d where d.organization_id=q.organization_id
    and d.conversation_id=c.id and d.inbound_id=q.message_id) then return 'connection_queue'; end if;
  if not first_bots and exists (select 1 from public.wa_messages n where n.organization_id=q.organization_id
    and n.conversation_id=c.id and n.direction='in' and n.deleted_at is null
    and (n.created_at,n.id)>(m.created_at,m.id)) then return 'superseded'; end if;
  return null;
end $$;
revoke all on function crm_internal.wa_inbound_cancel_reason(public.wa_inbound_work,text,boolean)
  from public, anon, authenticated, service_role;

-- The initial HTTP request can take only its own untouched row. Cron reclaims
-- expired leases in FIFO order, one active message per conversation. The same
-- bounded scan also retires expired or unsafe work without external effects.
create function public.claim_wa_inbound_work(
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
    -- Ingress phases themselves check ordinary first delivery. Before reclaim
    -- or escalation, suppress anything taken over by a human or already served.
    cancellation := null;
    if final_reason is not null or q.attempts>0 then
      cancellation := crm_internal.wa_inbound_cancel_reason(q,'recovery',true);
    end if;
    if final_reason is not null or cancellation is not null then
      update public.wa_inbound_work set state=case when cancellation is null then 'review' else 'cancelled' end,
        reason=coalesce(cancellation,final_reason),lease_token=null,active_step=null,finished_at=now() where message_id=q.message_id;
    else
      update public.wa_inbound_work set attempts=attempts+1,state='claimed',lease_token=gen_random_uuid(),
        active_step=null,available_at=clock_timestamp()+interval '7 minutes'
        where message_id=q.message_id returning * into q;
      return next q;
      taken := taken+1;
      exit when taken>=take_count;
    end if;
  end loop;
end $$;

create function public.advance_wa_inbound_work(
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
  if q.expires_at<=now() then
    update public.wa_inbound_work set state='review',reason='expired',lease_token=null,finished_at=now() where message_id=q.message_id;
    return 'stale';
  end if;
  update public.wa_inbound_work set state='dispatching',active_step=p_step where message_id=q.message_id;
  return 'ready';
end $$;

create function public.finish_wa_inbound_work(
  p_message_id uuid,p_lease_token uuid,p_outcome text,p_reason text default null
) returns text language plpgsql security definer set search_path='' as $$
declare q public.wa_inbound_work; target text; why text; cancellation text; due timestamptz;
begin
  if p_outcome is null or p_outcome not in ('done','cancelled','retry','review') then raise exception 'invalid inbound outcome'; end if;
  select w.* into q from public.wa_inbound_work w join public.wa_conversations c on c.id=w.conversation_id
    where w.message_id=p_message_id and w.lease_token=p_lease_token and w.available_at>clock_timestamp()
    for no key update of c,w;
  if not found then return 'stale'; end if;
  target := p_outcome;
  why := left(p_reason,240);
  due := q.available_at;
  if p_outcome in ('retry','review') then
    cancellation := crm_internal.wa_inbound_cancel_reason(q,'recovery',true);
    if cancellation is not null then target := 'cancelled'; why := cancellation;
    elsif p_outcome='retry' then
      if q.active_step is not null then target := 'review'; why := 'dispatch_uncertain';
      elsif q.expires_at<=now() then target := 'review'; why := 'expired';
      elsif q.attempts>=5 then target := 'review'; why := 'attempts_exhausted';
      else
        -- The caller requests retry only on a known pre-effect failure.
        target := 'pending';
        due := least(q.expires_at,clock_timestamp()+interval '30 seconds'*power(2,q.attempts-1));
      end if;
    end if;
  end if;
  update public.wa_inbound_work set state=target,reason=why,lease_token=null,active_step=null,available_at=due,
    finished_at=case when target<>'pending' then now() end,
    last_failure=case when p_outcome in ('retry','review') then left(p_reason,240) else last_failure end
    where message_id=q.message_id;
  return target;
end $$;
revoke all on function public.claim_wa_inbound_work(uuid,integer,uuid,uuid),
  public.advance_wa_inbound_work(uuid,uuid,text,boolean),public.finish_wa_inbound_work(uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.claim_wa_inbound_work(uuid,integer,uuid,uuid),
  public.advance_wa_inbound_work(uuid,uuid,text,boolean),public.finish_wa_inbound_work(uuid,uuid,text,text)
  to service_role;

-- Keep the existing two paths valid for already queued requests and existing
-- schedulers. Only a fixed internal path can receive the installation's secret.
create or replace function public.wa_agents_call_app(p_path text,p_body jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path='' as $$
declare base text; secret text; req bigint;
begin
  if p_path is null or p_path not in ('/api/wa-agents/ingest','/api/wa-agents/tick','/api/wa-agents/inbound-recovery') then
    raise warning 'wa_agents_call_app: caminho não permitido (%)', p_path;
    return null;
  end if;
  select value into base from public.platform_config where key='wa_agents_app_url';
  select value into secret from public.platform_config where key='wa_agents_internal_secret';
  if nullif(base,'') is null or nullif(secret,'') is null then return null; end if;
  select net.http_post(url:=rtrim(base,'/')||p_path,
    headers:=jsonb_build_object('Content-Type','application/json','X-Internal-Secret',secret),
    body:=coalesce(p_body,'{}'::jsonb),timeout_milliseconds:=20000) into req;
  return req;
exception when others then
  raise warning 'wa_agents_call_app falhou: %', SQLERRM;
  return null;
end $$;
revoke all on function public.wa_agents_call_app(text,jsonb) from public,anon,authenticated,service_role;

-- Same admission as the message-received bot trigger. Only enrollment changes:
-- a failure to dispatch HTTP leaves the entry available to cron. A DB failure
-- to *enroll* rolls back the message insert, so its normal ingestion can retry.
create or replace function public.wa_ai_agent_ingest() returns trigger
language plpgsql security definer set search_path='' as $$
declare conv record; eligible boolean := false; deadline timestamptz;
begin
  if new.direction<>'in' or new.deleted_at is not null then return new; end if;
  deadline := least(now(),new.created_at,new.wa_timestamp)+interval '24 hours';
  if deadline<=now() then return new; end if;
  select id,connection_id,ai_agent_id,ai_status,ai_status_changed_at,coalesce(is_group,false) as is_group into conv
    from public.wa_conversations where id=new.conversation_id and organization_id=new.organization_id;
  if not found or conv.is_group then return new; end if;

  if public.wa_agents_beta_enabled(new.organization_id) then
    if conv.ai_agent_id is not null and coalesce(conv.ai_status,'active')='active' then
      eligible := true;
    elsif conv.connection_id is not null and (conv.ai_status is null or (conv.ai_status='active' and conv.ai_agent_id is null))
      and exists (select 1 from public.wa_ai_agents a where a.organization_id=new.organization_id
        and a.enabled and conv.connection_id=any(a.connection_ids)
        and coalesce(a.triggers->'inbound'->>'mode','any')<>'none'
        and (conv.ai_status is null or a.triggers->'inbound'->>'mode'='keywords')) then
      eligible := true;
    end if;
  end if;
  if not eligible and exists (select 1 from public.wa_bot_runs r where r.organization_id=new.organization_id
    and r.conversation_id=conv.id and r.status='waiting_reply') then eligible := true; end if;
  if not eligible and not conv.is_group and conv.connection_id is not null and exists (
    select 1 from public.wa_bots b where b.organization_id=new.organization_id and b.enabled
      and b.trigger->>'type'='message_received' and (
        nullif(b.trigger->>'connection_id','')=conv.connection_id::text or (
          nullif(b.trigger->>'connection_id','') is null and
          (conv.connection_id=any(coalesce(b.connection_ids,'{}'::uuid[])) or b.connection_id=conv.connection_id)))
  ) then eligible := true; end if;
  if eligible then
    insert into public.wa_inbound_work(message_id,organization_id,conversation_id,connection_id,initial_status_at,expires_at)
      values(new.id,new.organization_id,conv.id,conv.connection_id,conv.ai_status_changed_at,deadline)
      on conflict(message_id) do nothing;
    if found then
      perform public.wa_agents_call_app('/api/wa-agents/inbound-recovery',jsonb_build_object(
        'organization_id',new.organization_id,'conversation_id',conv.id,'message_id',new.id));
    end if;
  end if;
  return new;
end $$;
revoke all on function public.wa_ai_agent_ingest() from public,anon,authenticated,service_role;

select cron.schedule('wa-inbound-recovery','* * * * *',$job$
  -- Retain terminal work beyond the notification feed's 24-hour lookback.
  -- Expire queue metadata only, in a bounded batch even after a prolonged outage.
  with obsolete as (
    select message_id from public.wa_inbound_work where finished_at<now()-interval '30 days'
    order by finished_at limit 200 for update skip locked
  ) delete from public.wa_inbound_work w using obsolete o where w.message_id=o.message_id;
  select public.wa_agents_call_app('/api/wa-agents/inbound-recovery','{"job":"inbound_recovery"}'::jsonb)
    where exists(select 1 from public.wa_inbound_work where state in ('pending','claimed','dispatching') and available_at<=now());
$job$);
commit;
