-- Service-only writes; clients receive active_alert through existing deals RLS/realtime.
alter table public.deals add column active_alert jsonb;
create table public.deal_alert_events (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 deal_id uuid not null references public.deals(id) on delete cascade,
 bot_id uuid not null,
 run_id uuid not null,
 block_id text not null,
 message text not null check(length(message) between 1 and 300),
 created_at timestamptz not null default clock_timestamp(),
 acknowledged_at timestamptz,
 acknowledged_by uuid,
 unique(run_id,block_id)
);
alter table public.deal_alert_events enable row level security;
revoke all on public.deal_alert_events from public,anon,authenticated;
grant all on public.deal_alert_events to service_role;
alter table public.crm_notification_events drop constraint crm_notification_events_kind_check;
alter table public.crm_notification_events add constraint crm_notification_events_kind_check check(kind in ('message','lead','alert'));

create function private.protect_deal_alert() returns trigger language plpgsql set search_path = '' as $$
begin
 if current_user not in ('postgres','service_role','supabase_admin') and
   ((TG_OP='INSERT' and NEW.active_alert is not null) or (TG_OP='UPDATE' and NEW.active_alert is distinct from OLD.active_alert)) then
   raise exception 'Alerts are server managed' using errcode='42501';
 end if;
 return NEW;
end $$;
create trigger protect_deal_alert before insert or update on public.deals for each row execute function private.protect_deal_alert();

create function public.activate_deal_alert(p_org uuid,p_deal uuid,p_bot uuid,p_run uuid,p_block text,p_message text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare d public.deals; a public.deal_alert_events;
begin
 select * into d from public.deals where id=p_deal and organization_id=p_org and deleted_at is null for update;
 if not found then raise exception 'Lead not found'; end if;
 if not exists(select 1 from public.wa_bot_runs where id=p_run and organization_id=p_org and bot_id=p_bot and deal_id=p_deal) then raise exception 'Run does not belong to lead'; end if;
 insert into public.deal_alert_events(organization_id,deal_id,bot_id,run_id,block_id,message)
 values(p_org,p_deal,p_bot,p_run,p_block,btrim(p_message)) on conflict(run_id,block_id) do nothing returning * into a;
 if not found then return (select id from public.deal_alert_events where run_id=p_run and block_id=p_block); end if;
 update public.deals set active_alert=jsonb_build_object('id',a.id,'message',a.message,'bot_id',p_bot,'run_id',p_run,'block_id',p_block,'created_at',a.created_at) where id=p_deal and organization_id=p_org;
 insert into public.crm_notification_events(organization_id,kind,source_id,board_id) values(p_org,'alert',a.id,d.board_id);
 return a.id;
end $$;
create function public.acknowledge_deal_alert(p_org uuid,p_deal uuid,p_expected uuid,p_user uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
 update public.deals set active_alert=null where id=p_deal and organization_id=p_org and deleted_at is null and active_alert->>'id'=p_expected::text;
 if not found then return false; end if;
 update public.deal_alert_events set acknowledged_at=clock_timestamp(),acknowledged_by=p_user where id=p_expected and organization_id=p_org and deal_id=p_deal and acknowledged_at is null;
 return true;
end $$;
revoke all on function public.activate_deal_alert(uuid,uuid,uuid,uuid,text,text),public.acknowledge_deal_alert(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.activate_deal_alert(uuid,uuid,uuid,uuid,text,text),public.acknowledge_deal_alert(uuid,uuid,uuid,uuid) to service_role;
