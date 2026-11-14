-- Private receipts for registered AI media. No existing customer records are changed.
create table public.wa_agent_media_deliveries (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.wa_conversations(id) on delete cascade,
  media_key text not null check (media_key ~ '^[a-f0-9]{64}$'),
  attempt_id uuid not null,
  state text not null check (state in ('sending', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, conversation_id, media_key)
);
alter table public.wa_agent_media_deliveries enable row level security;
revoke all on public.wa_agent_media_deliveries from public, anon, authenticated;
grant select, insert, update, delete on public.wa_agent_media_deliveries to service_role;
comment on table public.wa_agent_media_deliveries is
  'Once-per-conversation AI media receipts. Sending includes uncertain delivery; never automatically retried.';
