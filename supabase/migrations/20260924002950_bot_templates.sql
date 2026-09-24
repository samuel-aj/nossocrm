-- Snapshots contain only the portable, sanitized format. All access goes through
-- authenticated org-scoped server routes; no direct client writes/public access.
create table public.wa_bot_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  official boolean not null default false,
  published boolean not null default false,
  snapshot jsonb not null check (octet_length(snapshot::text) <= 1100000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not published or official)
);
create index wa_bot_templates_org_idx on public.wa_bot_templates(organization_id);
create index wa_bot_templates_official_idx on public.wa_bot_templates(published) where official;
alter table public.wa_bot_templates enable row level security;
revoke all on public.wa_bot_templates from public, anon, authenticated;
grant select, insert, update, delete on public.wa_bot_templates to service_role;
