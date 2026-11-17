-- Private simulation receipts; no production conversation or customer record is modified.
create table public.wa_agent_test_media_deliveries (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id uuid not null references public.wa_ai_agents(id) on delete cascade,
  session_id uuid not null,
  media_key text not null check (media_key ~ '^[a-f0-9]{64}$'),
  attempt_id uuid not null,
  state text not null check (state in ('pending', 'delivered')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, agent_id, session_id, media_key)
);
alter table public.wa_agent_test_media_deliveries enable row level security;
revoke all on public.wa_agent_test_media_deliveries from public, anon, authenticated;
grant select, insert, update, delete on public.wa_agent_test_media_deliveries to service_role;
comment on table public.wa_agent_test_media_deliveries is
  'Simulated media only. Scoped to office, authenticated user, agent and explicit test session. Pending receipts block concurrent generation; delivered receipts enforce media repeat policy.';
