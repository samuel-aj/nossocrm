-- Additive only: no existing leads, conversations, messages or dates are rewritten.
create table public.followup_calendars (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  timezone text not null default 'America/Sao_Paulo',
  slots jsonb not null default '[]'::jsonb check (jsonb_typeof(slots) = 'array'),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.followup_calendars enable row level security;
revoke all on public.followup_calendars from anon, authenticated;
grant all on public.followup_calendars to service_role;

alter table public.stage_followup_rules
  add column agent_id uuid references public.wa_ai_agents(id) on delete set null,
  add column agent_instruction text not null default '' check (length(agent_instruction) <= 2000);
alter table public.stage_followup_rules drop constraint stage_followup_rules_action_type_check;
alter table public.stage_followup_rules add constraint stage_followup_rules_action_type_check
  check (action_type in ('bot', 'message', 'agent'));

-- Merge only the follow-up key under a row lock, preserving concurrent agent state.
-- All expired rules are consumed together: reopening business hours sends one follow-up,
-- never a burst of the weekend backlog. Caller supplies the actual latest due rule.
create function public.claim_agent_followup(p_org uuid, p_conversation uuid, p_agent uuid,
  p_cycle text, p_expected jsonb, p_done jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  update public.wa_conversations
  set ai_state = jsonb_set(coalesce(ai_state, '{}'::jsonb), '{followups}',
    jsonb_build_object('cycle', p_cycle, 'done', p_done))
  where id = p_conversation and organization_id = p_org and ai_agent_id = p_agent
    and ai_status = 'active' and (select max(m.created_at) from public.wa_messages m where m.organization_id = p_org and m.conversation_id = p_conversation and m.direction = 'in') is not distinct from p_cycle::timestamptz
    and (ai_lock_until is null or ai_lock_until < now())
    and (ai_state -> 'followups') is not distinct from p_expected;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;
revoke all on function public.claim_agent_followup(uuid,uuid,uuid,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.claim_agent_followup(uuid,uuid,uuid,text,jsonb,jsonb) to service_role;

-- Never overwrites memory, approval, human pause, or an active robot.
create function public.activate_stage_followup_agent(p_org uuid, p_conversation uuid, p_agent uuid, p_anchor timestamptz, p_run uuid default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  update public.wa_conversations c
  set ai_agent_id = p_agent, ai_status = 'active', ai_status_changed_at = now(),
    ai_state = case when c.ai_agent_id is distinct from p_agent
      then jsonb_set(coalesce(c.ai_state, '{}'::jsonb), '{respostas}', '0'::jsonb)
      else c.ai_state end
  where c.id = p_conversation and c.organization_id = p_org
    and (c.ai_status is null or c.ai_status = 'active')
    and c.ai_approval is null
    and (c.ai_lock_until is null or c.ai_lock_until < now())
    and not exists (select 1 from public.wa_messages m where m.organization_id = p_org and m.conversation_id = p_conversation and m.direction = 'in' and (p_anchor is null or m.created_at > p_anchor))
    and exists (select 1 from public.wa_ai_agents a where a.id = p_agent and a.organization_id = p_org and a.enabled)
    and not exists (select 1 from public.wa_bot_runs b where b.organization_id = p_org
      and b.conversation_id = p_conversation and b.status in ('running', 'waiting_reply') and b.id is distinct from p_run);
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;
revoke all on function public.activate_stage_followup_agent(uuid,uuid,uuid,timestamptz,uuid) from public, anon, authenticated;
grant execute on function public.activate_stage_followup_agent(uuid,uuid,uuid,timestamptz,uuid) to service_role;
