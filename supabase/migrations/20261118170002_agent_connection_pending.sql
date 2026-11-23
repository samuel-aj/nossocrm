-- Only prospective work is enrolled: failed historical runs may already have
-- produced external effects, even when they have no outbound message in the CRM.
create table public.wa_agent_connection_pending (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.wa_conversations(id) on delete cascade,
  connection_id uuid not null references public.wa_connections(id) on delete cascade,
  agent_id uuid not null references public.wa_ai_agents(id) on delete cascade,
  inbound_id uuid references public.wa_messages(id) on delete cascade,
  rule jsonb,
  anchor_at timestamptz,
  agent_state_at timestamptz,
  deal_won boolean not null default false,
  intent_key text not null,
  remaining_lines text[],
  after_send jsonb,
  sent_ids uuid[] not null default '{}',
  guard_from timestamptz not null default now(),
  state text not null default 'pending' check (state in ('pending','dispatching','done','cancelled','review')),
  created_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  reason text,
  check ((inbound_id is not null) <> (rule is not null)),
  unique (conversation_id, agent_id, intent_key)
);
alter table public.wa_agent_connection_pending enable row level security;
revoke all on public.wa_agent_connection_pending from public, anon, authenticated;
grant select, insert, update, delete on public.wa_agent_connection_pending to service_role;
create index wa_agent_connection_pending_ready on public.wa_agent_connection_pending(available_at, connection_id)
  where state = 'pending';
create index wa_agent_connection_pending_claimed on public.wa_agent_connection_pending(claimed_at)
  where state = 'dispatching';
create index wa_agent_connection_pending_line on public.wa_agent_connection_pending(connection_id,state)
  where state in ('pending','dispatching','review');

-- A deliberate stop or changed WhatsApp identity invalidates older work,
-- even if the operator later pairs another phone with this connection row.
create function public.cancel_disabled_wa_agent_replies() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.wa_agent_connection_pending set state='cancelled',reason='line_disabled'
    where connection_id=new.id and organization_id=new.organization_id and state in ('pending','dispatching');
  return new;
end;
$$;
revoke all on function public.cancel_disabled_wa_agent_replies() from public, anon, authenticated;
create trigger wa_cancel_pending_on_disable after update of health_monitor_enabled,health_identity_mismatch_at
  on public.wa_connections for each row when (
    (old.health_monitor_enabled and not new.health_monitor_enabled) or
    (new.health_identity_mismatch_at is not null and new.health_identity_mismatch_at is distinct from old.health_identity_mismatch_at))
  execute function public.cancel_disabled_wa_agent_replies();

-- Capture under the same row lock as the follow-up compare-and-swap. A new
-- customer message or a human intervention during capture is checked again at
-- dispatch. A turn blocked before generation needs only identifiers. When a
-- provider explicitly refuses prepared text, save its approved unsent suffix
-- and post-delivery actions inside the service-role-only queue.
create function public.enqueue_wa_agent_connection_reply(
  p_org uuid, p_conversation uuid, p_connection uuid, p_agent uuid, p_inbound uuid,
  p_rule jsonb, p_cycle timestamptz, p_state_at timestamptz,
  p_lines text[] default null, p_sent uuid[] default '{}', p_started timestamptz default null,
  p_after_send jsonb default null
) returns void language plpgsql security definer set search_path = '' as $$
declare anchor_time timestamptz; event_key text;
begin
  if not exists (select 1 from public.wa_conversations c where c.id=p_conversation
    and c.organization_id=p_org and c.connection_id=p_connection and c.ai_agent_id=p_agent
    and c.ai_status='active') then return; end if;
  if not exists(select 1 from public.wa_connections l where l.id=p_connection and l.organization_id=p_org
    and l.health_monitor_enabled and l.health_identity_mismatch_at is null) then return; end if;
  if p_inbound is not null then
    select created_at into strict anchor_time from public.wa_messages where id=p_inbound
      and direction='in' and conversation_id=p_conversation and organization_id=p_org;
    event_key := 'in:' || p_inbound::text;
  else
    if p_rule->>'id' is null then raise exception 'missing follow-up rule'; end if;
    anchor_time := p_cycle;
    event_key := 'followup:' || coalesce(extract(epoch from p_cycle)::text,'none') || ':' || (p_rule->>'id');
  end if;
  insert into public.wa_agent_connection_pending(organization_id,conversation_id,connection_id,agent_id,
    inbound_id,rule,anchor_at,agent_state_at,intent_key,remaining_lines,sent_ids,guard_from,deal_won,after_send)
    values(p_org,p_conversation,p_connection,p_agent,p_inbound,p_rule,anchor_time,p_state_at,event_key,
      p_lines,p_sent,coalesce(p_started,now()), exists (
        select 1 from public.wa_conversations c join public.deals d on d.id=c.deal_id and d.organization_id=c.organization_id
        where c.id=p_conversation and c.organization_id=p_org and d.is_won),p_after_send)
    on conflict(conversation_id,agent_id,intent_key) do nothing;
end;
$$;

-- Gate the ordinary follow-up scheduler too. Otherwise it could dispatch the
-- next rule concurrently with a recovered follow-up from the same cycle.
create function public.claim_connection_aware_followup(
  p_org uuid, p_conversation uuid, p_agent uuid, p_cycle text, p_expected jsonb,
  p_done jsonb, p_rule jsonb, p_connection uuid, p_state_at timestamptz
) returns text language plpgsql security definer set search_path = '' as $$
declare line_status text;
begin
  perform 1 from public.wa_conversations c where c.id=p_conversation and c.organization_id=p_org
    and c.connection_id is not distinct from p_connection for update;
  if not found then return 'skip'; end if;
  if exists (select 1 from public.wa_agent_connection_pending q where q.conversation_id=p_conversation
    and q.agent_id=p_agent and q.rule is not null and q.anchor_at is not distinct from p_cycle::timestamptz
    and (q.state in ('pending','dispatching','review') or (q.state='cancelled' and q.reason='superseded'))) then return 'skip'; end if;
  if not public.claim_agent_followup(p_org,p_conversation,p_agent,p_cycle,p_expected,p_done) then return 'skip'; end if;
  select c.status into line_status from public.wa_connections c where c.id=p_connection and c.organization_id=p_org;
  if line_status is not null and line_status <> 'connected' then
    perform public.enqueue_wa_agent_connection_reply(p_org,p_conversation,p_connection,p_agent,null,
      p_rule,p_cycle::timestamptz,p_state_at);
    return 'queued';
  end if;
  return 'claimed';
end;
$$;

-- Rechecked both before the model and before the provider. During a multipart
-- reply its own agent output is allowed; manual, API and bot output still wins.
create function public.wa_agent_connection_reply_decision(p_id uuid, p_started boolean default false)
returns text language plpgsql stable security definer set search_path = '' as $$
declare q public.wa_agent_connection_pending; c public.wa_conversations; last_in public.wa_messages;
begin
  select * into q from public.wa_agent_connection_pending where id=p_id;
  if not found or q.state <> 'dispatching' then return 'superseded'; end if;
  select * into c from public.wa_conversations where id=q.conversation_id and organization_id=q.organization_id;
  if not found or c.connection_id is distinct from q.connection_id or c.ai_status is distinct from 'active'
    or c.ai_agent_id is distinct from q.agent_id or c.ai_status_changed_at is distinct from q.agent_state_at
    or c.ai_approval is not null then return 'superseded'; end if;
  if exists (select 1 from public.deals d where d.id=c.deal_id and d.organization_id=q.organization_id
    and ((d.is_won and (q.rule is not null or not q.deal_won)) or d.is_lost or d.deleted_at is not null))
    then return 'superseded'; end if;
  if not exists(select 1 from public.wa_ai_agents a where a.id=q.agent_id and a.organization_id=q.organization_id
    and a.enabled) then return 'superseded'; end if;
  select * into last_in from public.wa_messages m where m.conversation_id=c.id and m.organization_id=q.organization_id
    and m.direction='in' order by m.created_at desc,m.id desc limit 1;
  if last_in.deleted_at is not null then return 'superseded'; end if;
  if (q.inbound_id is not null and (last_in.id is distinct from q.inbound_id or c.ai_last_processed_at >= q.anchor_at))
    or (q.rule is not null and last_in.created_at is distinct from q.anchor_at) then return 'superseded'; end if;
  if exists (select 1 from public.wa_messages m where m.organization_id=q.organization_id and m.conversation_id=c.id
    and m.direction='out' and not (coalesce(m.status='failed',false) and coalesce(m.source,'')='agent'
      and coalesce(m.error,'') ~* '(connection closed|instance is not connected|número desconectado)')
    and m.created_at >= case when q.inbound_id is not null then q.anchor_at else q.guard_from end
    and not (m.id=any(q.sent_ids) and m.source='agent')
    and not (p_started and coalesce(m.source,'')='agent' and m.created_at>=q.claimed_at)) then return 'superseded'; end if;
  if not exists(select 1 from public.wa_connections l where l.id=q.connection_id and l.organization_id=q.organization_id
    and l.health_monitor_enabled and l.health_identity_mismatch_at is null
    and l.health_uncertain_since is null and l.status='connected'
    and not exists(select 1 from public.wa_connection_incidents i where i.connection_id=l.id and i.resolved_at is null)
  ) then return 'offline'; end if;
  return 'ready';
end;
$$;

-- Move only one item per worker call. A crash once handed to an agent may
-- have executed external side effects. Keep that item for human reconciliation.
create function public.claim_pending_wa_agent_reply()
returns setof public.wa_agent_connection_pending language plpgsql security definer set search_path = '' as $$
begin
  update public.wa_agent_connection_pending set state='review',reason='delivery_uncertain'
    where state='dispatching' and claimed_at < now()-interval '30 minutes';
  return query
  with item as (
    select q.id from public.wa_agent_connection_pending q join public.wa_connections l
      on l.id=q.connection_id and l.organization_id=q.organization_id
    where q.state='pending' and q.available_at<=now() and l.status='connected' and l.health_monitor_enabled
      and l.health_identity_mismatch_at is null and l.health_uncertain_since is null
      and not exists(select 1 from public.wa_connection_incidents i where i.connection_id=l.id and i.resolved_at is null)
    order by q.available_at,q.id limit 1 for update of q skip locked
  ) update public.wa_agent_connection_pending q set state='dispatching',claimed_at=now()
    from item where q.id=item.id returning q.*;
end;
$$;
revoke all on function public.enqueue_wa_agent_connection_reply(uuid,uuid,uuid,uuid,uuid,jsonb,timestamptz,timestamptz,text[],uuid[],timestamptz,jsonb),
  public.claim_connection_aware_followup(uuid,uuid,uuid,text,jsonb,jsonb,jsonb,uuid,timestamptz),
  public.wa_agent_connection_reply_decision(uuid,boolean), public.claim_pending_wa_agent_reply()
  from public, anon, authenticated;
grant execute on function public.enqueue_wa_agent_connection_reply(uuid,uuid,uuid,uuid,uuid,jsonb,timestamptz,timestamptz,text[],uuid[],timestamptz,jsonb),
  public.claim_connection_aware_followup(uuid,uuid,uuid,text,jsonb,jsonb,jsonb,uuid,timestamptz),
  public.wa_agent_connection_reply_decision(uuid,boolean), public.claim_pending_wa_agent_reply() to service_role;
