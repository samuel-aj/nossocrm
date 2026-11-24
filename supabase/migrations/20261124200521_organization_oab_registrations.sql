create table public.organization_oab_registrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  professional_name text not null check (
    char_length(professional_name) between 2 and 120
    and professional_name = btrim(professional_name)
    and professional_name !~ '[[:cntrl:]]'
  ),
  state text not null check (state in (
    'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA',
    'PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
  )),
  number text not null check (number ~ '^[0-9]{1,7}[A-Z]?$' and number !~ '^0+[A-Z]?$'),
  confirmed_by uuid not null,
  confirmed_at timestamptz not null default now(),
  unique (organization_id, state, number)
);

-- Only the authenticated administrator route may record or revoke an attestation.
alter table public.organization_oab_registrations enable row level security;
revoke all on table public.organization_oab_registrations from public, anon, authenticated, service_role;
grant select, insert, delete on table public.organization_oab_registrations to service_role;
