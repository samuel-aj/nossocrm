-- Personal settings and an ID-only event journal. Reads are authorized by the server.
create table public.crm_notification_preferences (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 preferences jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now(),
 primary key (organization_id,user_id)
);
create table public.crm_notification_events (
 id bigint generated always as identity primary key,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 kind text not null check (kind in ('message','lead')),
 source_id uuid not null,
 board_id uuid,
 created_at timestamptz not null default clock_timestamp()
);
create index crm_notification_events_org_time on public.crm_notification_events(organization_id,created_at,id);
alter table public.crm_notification_preferences enable row level security;
alter table public.crm_notification_events enable row level security;
revoke all on public.crm_notification_preferences,public.crm_notification_events from public,anon,authenticated;
grant all on public.crm_notification_preferences,public.crm_notification_events to service_role;
grant usage,select on sequence public.crm_notification_events_id_seq to service_role;
create schema if not exists private;
create function private.capture_crm_notification() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if TG_TABLE_NAME = 'wa_messages' then
  if NEW.direction = 'in' and NEW.deleted_at is null and (NEW.body is not null or NEW.media_type is not null) then
   insert into public.crm_notification_events(organization_id,kind,source_id) values(NEW.organization_id,'message',NEW.id);
  end if;
 elsif NEW.deleted_at is null and NEW.board_id is not null then
  if TG_OP = 'INSERT' then
   insert into public.crm_notification_events(organization_id,kind,source_id,board_id) values(NEW.organization_id,'lead',NEW.id,NEW.board_id);
  elsif NEW.board_id is distinct from OLD.board_id then
   insert into public.crm_notification_events(organization_id,kind,source_id,board_id) values(NEW.organization_id,'lead',NEW.id,NEW.board_id);
  end if;
 end if;
 return NEW;
end $$;
revoke all on function private.capture_crm_notification() from public,anon,authenticated;
create trigger crm_notify_incoming after insert on public.wa_messages for each row execute function private.capture_crm_notification();
create trigger crm_notify_lead after insert or update of board_id on public.deals for each row execute function private.capture_crm_notification();
