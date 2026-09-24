-- Only the authenticated application server may manage or read these references.
create table public.message_template_media (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.wa_connections(id) on delete cascade,
  storage_path text not null unique,
  header_type text not null check (header_type in ('image','video','document')),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','video/mp4','application/pdf')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 16777216),
  file_name text not null,
  verified_at timestamptz,
  meta_handle text,
  created_at timestamptz not null default now()
);
alter table public.message_template_media enable row level security;
revoke all on public.message_template_media from anon, authenticated;
grant all on public.message_template_media to service_role;
alter table public.message_templates
  add column header_type text check (header_type in ('image','video','document')),
  add column media_id uuid references public.message_template_media(id) on delete set null;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wa-template-media', 'wa-template-media', false, 16777216,
  array['image/jpeg','image/png','video/mp4','application/pdf'])
on conflict (id) do nothing;
-- No object policies: uploads use non-upsert, server-issued signed upload tokens;
-- reads require scoped server authorization and short-lived signed download URLs.

-- Defense in depth: a template cannot bind a file of a different tenant, number or kind.
alter table public.message_template_media add constraint message_template_media_scope_key
  unique (id, organization_id, connection_id, header_type);
alter table public.message_templates
  add constraint message_template_media_scope_fk foreign key (media_id, organization_id, connection_id, header_type)
    references public.message_template_media (id, organization_id, connection_id, header_type),
  add constraint message_template_media_kind_check check (media_id is null or
    (type = 'whatsapp_api' and header_type is not null and connection_id is not null));
alter table public.message_template_media add constraint message_template_media_format_check check (
  (header_type = 'image' and mime_type in ('image/jpeg','image/png') and byte_size <= 5242880)
  or (header_type = 'video' and mime_type = 'video/mp4')
  or (header_type = 'document' and mime_type = 'application/pdf')
);
