BEGIN;
-- One row lock serializes observations, incident transitions and notification enqueue.
alter table public.wa_connections
  add column health_monitor_enabled boolean not null default true,
  add column health_next_probe_at timestamptz not null default now(),
  add column health_state_at timestamptz,
  add column health_source text,
  add column health_checked_at timestamptz,
  add column health_check_error text,
  add column health_identity_mismatch_at timestamptz,
  add column health_uncertain_since timestamptz,
  add column health_alert_owner_id uuid references public.profiles(id) on delete set null;
-- Old disconnected lines include lines explicitly disconnected by their operators.
update public.wa_connections set health_monitor_enabled = false where status = 'disconnected';

create table public.wa_connection_incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.wa_connections(id) on delete cascade,
  line_label text not null,
  opened_at timestamptz not null,
  reason text not null,
  source text not null,
  resolved_at timestamptz,
  resolution text,
  check (resolved_at is null or resolved_at>=opened_at)
);
create unique index wa_connection_one_open_incident on public.wa_connection_incidents(connection_id) where resolved_at is null;
create index wa_connection_incidents_org on public.wa_connection_incidents(organization_id, opened_at desc);

create table public.wa_connection_health_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.wa_connections(id) on delete cascade,
  observed_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  state text not null, source text not null, reason text, applied boolean not null
);
create index wa_connection_health_events_line on public.wa_connection_health_events(connection_id, observed_at desc);

-- The bell and the mail worker use the same, organization-scoped recipients.
create table public.wa_connection_incident_notices (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.wa_connection_incidents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  phase text not null check (phase in ('opened','resolved')),
  created_at timestamptz not null default clock_timestamp(),
  recipient_email text,
  mail_state text not null default 'pending' check (mail_state in ('pending','sending','sent','cancelled','expired')),
  attempts int not null default 0, first_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(), lease_token uuid, lease_until timestamptz, last_error text,
  unique(incident_id, user_id, phase)
);
create index wa_connection_notice_feed on public.wa_connection_incident_notices(organization_id, user_id, created_at desc);
create index wa_connection_notice_mail on public.wa_connection_incident_notices(next_attempt_at) where mail_state in ('pending','sending');

alter table public.wa_connection_incidents enable row level security;
alter table public.wa_connection_health_events enable row level security;
alter table public.wa_connection_incident_notices enable row level security;
revoke all on public.wa_connection_incidents, public.wa_connection_health_events, public.wa_connection_incident_notices from public, anon, authenticated;
grant all on public.wa_connection_incidents, public.wa_connection_health_events, public.wa_connection_incident_notices to service_role;
grant usage, select on sequence public.wa_connection_health_events_id_seq to service_role;

grant usage on schema crm_internal to service_role;
create function crm_internal.wa_line_recipients(p_org uuid, p_line uuid, p_owner uuid)
returns table(user_id uuid,email text) language sql stable security definer set search_path = '' as $$
  select p.id, nullif(trim(u.email),'')
    from public.profiles p
    join auth.users u on u.id=p.id
    left join public.user_organizations m on m.user_id=p.id and m.organization_id=p_org
    left join public.user_visibility_rules v on v.user_id=p.id and v.organization_id=p_org
   where (m.user_id is not null or (p.organization_id=p_org and p.role<>'super_admin'))
     and ((p.id=p_owner and (v.rules#>'{whatsapp,connection_ids}' is null
             or v.rules#>'{whatsapp,connection_ids}'='null'::jsonb
             or (v.rules#>'{whatsapp,connection_ids}') ? p_line::text))
          or coalesce(m.role,p.role) in ('admin','super_admin'))
     and (u.banned_until is null or u.banned_until <= now())
$$;

create function crm_internal.wa_validate_alert_owner() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.health_alert_owner_id is not null and not exists (
    select from crm_internal.wa_line_recipients(new.organization_id,new.id,new.health_alert_owner_id) r
    where r.user_id=new.health_alert_owner_id) then
    raise exception 'Responsável sem acesso a este número na organização' using errcode='23514';
  end if;
  return new;
end $$;
create trigger wa_validate_alert_owner before insert or update of health_alert_owner_id,organization_id
  on public.wa_connections for each row execute function crm_internal.wa_validate_alert_owner();

create function crm_internal.wa_line_notify(p_incident public.wa_connection_incidents, p_owner uuid, p_phase text)
returns void language sql security definer set search_path = '' as $$
  insert into public.wa_connection_incident_notices
    (incident_id,organization_id,user_id,phase,recipient_email,mail_state)
  select p_incident.id,p_incident.organization_id,r.user_id,p_phase,r.email,
         case when r.email is null then 'cancelled' else 'pending' end
    from crm_internal.wa_line_recipients(p_incident.organization_id,p_incident.connection_id,p_owner) r
  on conflict (incident_id,user_id,phase) do nothing;
  select public.wa_agents_call_app('/api/wa-agents/tick','{"job":"connection_health"}'::jsonb)
$$;

-- The underlying generic caller is intentionally unavailable to service_role.
-- This narrowly scoped wake only calls the authenticated health job after commit.
create function public.wa_wake_connection_monitor() returns void language sql security definer set search_path='' as $$
  select public.wa_agents_call_app('/api/wa-agents/tick','{"job":"connection_health"}'::jsonb);
$$;
revoke all on function public.wa_wake_connection_monitor() from public,anon,authenticated;
grant execute on function public.wa_wake_connection_monitor() to service_role;

create function public.wa_observe_connection(
  p_connection_id uuid, p_state text, p_source text, p_observed_at timestamptz,
  p_reason text default null, p_owner_phone text default null, p_profile_name text default null
) returns boolean language plpgsql set search_path = '' as $$
<<observation>>
declare
  c public.wa_connections%rowtype;
  i public.wa_connection_incidents%rowtype;
  t timestamptz := least(p_observed_at,clock_timestamp());
  reason text := left(regexp_replace(coalesce(p_reason,p_state),'[^A-Za-z0-9_.:-]','_','g'),80);
  open_incident boolean := false;
  close_mode text;
begin
  if p_state is null or p_state not in ('connected','connecting','disconnected','unknown')
     or p_source is null or p_source not in ('poll','webhook','send_failure','send_blocked','delivery','manual')
     or p_observed_at is null then raise exception 'invalid connection observation'; end if;
  select * into c from public.wa_connections where id=p_connection_id for update;
  if not found then return false; end if;
  if not c.health_monitor_enabled and p_source <> 'manual' then return false; end if;
  select * into i from public.wa_connection_incidents where connection_id=c.id and resolved_at is null;

  if p_source='send_blocked' then
    -- A local preflight is evidence about the cached state only. A probe may
    -- have corrected the row while this failed worker was completing.
    if c.status='connected' or c.last_connected_at is null then return false; end if;
    open_incident := true;
  elsif p_state='unknown' then
    if (c.health_checked_at is not null and t<c.health_checked_at)
       or (c.health_state_at is not null and t<c.health_state_at) then return false; end if;
    update public.wa_connections set
      health_checked_at=case when p_source='poll' then t else health_checked_at end,
      health_next_probe_at=case when p_source='webhook' then least(now(),health_next_probe_at) else health_next_probe_at end,
      health_uncertain_since=coalesce(health_uncertain_since,t),health_check_error=reason where id=c.id;
    open_incident := (c.last_connected_at is not null or c.status='connected') and c.health_uncertain_since <= t-interval '5 minutes';
    if open_incident then reason := 'verification_unavailable'; end if;
    if p_source='webhook' and c.health_uncertain_since is null then
      perform public.wa_wake_connection_monitor();
    end if;
  else
    if (t < greatest(c.health_state_at,c.last_connected_at,i.opened_at)
       or (t=c.health_state_at and c.status='connected' and p_state<>'connected'))
       then
      if p_source='webhook' then
        insert into public.wa_connection_health_events(organization_id,connection_id,observed_at,state,source,reason,applied)
        values(c.organization_id,c.id,t,p_state,p_source,reason,false);
      end if;
      return false;
    end if;
    -- A transient Evolution "connecting" can arrive just after "open".
    -- Preserve the last good state until an independent provider probe or an
    -- actual rejected send confirms a problem. The observation is still audited.
    if p_source='webhook' and p_state='connecting' and c.status='connected' then
      update public.wa_connections set health_next_probe_at=least(now(),health_next_probe_at),
        health_check_error='checking_transition',health_uncertain_since=coalesce(health_uncertain_since,t)
        where id=c.id;
      insert into public.wa_connection_health_events(organization_id,connection_id,observed_at,state,source,reason,applied)
      values(c.organization_id,c.id,t,p_state,p_source,reason,false);
      if c.health_uncertain_since is null then perform public.wa_wake_connection_monitor(); end if;
      return false;
    end if;
    -- If a session has been paired to a different phone, quarantine it. Never
    -- relabel old chats or deliver their pending replies from the new identity.
    if p_state='connected' and p_owner_phone is not null and c.phone_number is not null
       and p_owner_phone<>all(public.br_phone_variants(c.phone_number)) then
      reason := 'number_changed';
      p_state := 'disconnected';
      p_owner_phone := null;
      p_profile_name := null;
      update public.wa_connections set health_identity_mismatch_at=t where id=c.id;
      if i.id is not null then update public.wa_connection_incidents set reason='number_changed' where id=i.id; end if;
    elsif c.health_identity_mismatch_at is not null and p_state='connected' then
      if p_owner_phone is null or p_source not in ('manual','webhook')
         or not p_owner_phone=any(public.br_phone_variants(c.phone_number)) then return false; end if;
      update public.wa_connections set health_identity_mismatch_at=null where id=c.id;
    end if;
    if p_source='webhook' and p_state='connected' and i.id is not null then
      -- An "open" callback alone does not prove this line can send again.
      update public.wa_connections set health_next_probe_at=least(now(),health_next_probe_at),
        health_check_error='awaiting_probe' where id=c.id;
      insert into public.wa_connection_health_events(organization_id,connection_id,observed_at,state,source,reason,applied)
      values(c.organization_id,c.id,t,p_state,p_source,'awaiting_probe',false);
      if c.health_check_error is distinct from 'awaiting_probe' then perform public.wa_wake_connection_monitor(); end if;
      return false;
    end if;
    update public.wa_connections set status=p_state, health_state_at=t, health_source=p_source,
      health_monitor_enabled=case when p_source='manual' and reason<>'number_changed' then p_state<>'disconnected' else health_monitor_enabled end,
      health_checked_at=case when p_source='poll' then greatest(t,health_checked_at) else health_checked_at end,
      health_next_probe_at=case when p_state<>'connected' and p_source<>'poll' then least(now(),health_next_probe_at) else health_next_probe_at end,
      health_check_error=null,health_uncertain_since=null,
      last_connected_at=case when p_state='connected' and (status<>'connected' or last_connected_at is null) then t else last_connected_at end,
      phone_number=coalesce(p_owner_phone,phone_number),profile_name=coalesce(p_profile_name,profile_name)
      where id=c.id;
    if p_state='connected' then close_mode := 'reconnected';
    elsif reason='number_changed' then open_incident := true;
    elsif p_source='manual' and p_state='disconnected' then close_mode := 'disabled';
    else open_incident := (c.last_connected_at is not null or c.status='connected') and p_source<>'manual'
      and not (coalesce(c.health_source,'')='manual' and c.status='connecting' and t-c.health_state_at<interval '2 minutes'); end if;
  end if;

  if p_source in ('webhook','manual','send_failure') or (p_source='send_blocked' and i.id is null)
     or (p_state='unknown' and c.health_check_error is distinct from reason)
     or (p_source='poll' and p_state<>'unknown' and (c.status<>p_state or c.health_check_error is not null))
     or (p_source='delivery' and c.status<>'connected') then
    insert into public.wa_connection_health_events(organization_id,connection_id,observed_at,state,source,reason,applied)
    values(c.organization_id,c.id,t,p_state,p_source,reason,true);
  end if;
  if close_mode is not null and i.id is not null then
    update public.wa_connection_incidents set resolved_at=t, resolution=close_mode where id=i.id returning * into i;
    -- Don't send a belated "down" email after the line has recovered.
    update public.wa_connection_incident_notices set mail_state='cancelled'
      where incident_id=i.id and phase='opened' and mail_state='pending';
    if close_mode='reconnected' then perform crm_internal.wa_line_notify(i,c.health_alert_owner_id,'resolved'); end if;
  elsif open_incident and i.id is null then
    insert into public.wa_connection_incidents(organization_id,connection_id,line_label,opened_at,reason,source)
    values(c.organization_id,c.id,coalesce(nullif(c.phone_number,''),nullif(c.profile_name,''),'WhatsApp'),t,reason,p_source)
    returning * into i;
    perform crm_internal.wa_line_notify(i,c.health_alert_owner_id,'opened');
  elsif open_incident and i.reason='verification_unavailable' and p_state='disconnected' then
    update public.wa_connection_incidents set reason=observation.reason,source=p_source where id=i.id;
  end if;
  return true;
end $$;

-- A delivered/read receipt confirms the outbound session as of the message's
-- send time. A belated receipt from yesterday cannot clear today's outage.
create function crm_internal.wa_line_delivery() returns trigger language plpgsql set search_path = '' as $$
declare line uuid;
begin
  if tg_op='UPDATE' and old.status in ('delivered','read') then return new; end if;
  select connection_id into line from public.wa_conversations where id=new.conversation_id and organization_id=new.organization_id;
  if line is not null then
    perform public.wa_observe_connection(line,'connected','delivery',least(new.created_at,new.wa_timestamp),'receipt');
  end if;
  return new;
end $$;
create trigger wa_line_delivery after insert or update of status on public.wa_messages
  for each row when (new.direction='out' and new.status in ('delivered','read') and new.evolution_message_id is not null
       and new.source is not null and new.source<>'echo') execute function crm_internal.wa_line_delivery();
revoke all on function crm_internal.wa_line_delivery() from public,anon,authenticated;
grant execute on function crm_internal.wa_line_delivery() to service_role;

create function public.wa_connection_bell(p_org uuid,p_user uuid,p_until timestamptz)
returns table(id uuid,phase text,created_at timestamptz,mail_state text,connection_id uuid,line_label text,reason text)
language sql stable set search_path='' as $$
  select n.id,n.phase,n.created_at,n.mail_state,c.id,i.line_label,i.reason
    from public.wa_connection_incident_notices n
    join public.wa_connection_incidents i on i.id=n.incident_id
    join public.wa_connections c on c.id=i.connection_id and c.organization_id=n.organization_id
   where n.organization_id=p_org and n.user_id=p_user and n.created_at<=p_until
     and ((n.phase='opened' and i.resolved_at is null)
          or (n.phase='resolved' and n.created_at>=p_until-interval '1 day'))
     and exists (select from crm_internal.wa_line_recipients(p_org,c.id,c.health_alert_owner_id) r where r.user_id=p_user)
   order by n.created_at desc
$$;
revoke all on function public.wa_connection_bell(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.wa_connection_bell(uuid,uuid,timestamptz) to service_role;

create function public.wa_claim_connection_emails(p_limit int default 16)
returns table(id uuid,lease_token uuid,phase text,recipient_email text,line_label text,reason text,occurred_at timestamptz)
language plpgsql set search_path = '' as $$
begin
  -- Resend retains idempotency keys for 24 hours. Never blind-retry an
  -- ambiguous request once outside its deduplication period.
  update public.wa_connection_incident_notices n set mail_state='expired',last_error='idempotency_window_elapsed'
    where n.mail_state in ('pending','sending') and n.first_attempt_at < now()-interval '23 hours';
  update public.wa_connection_incident_notices n set mail_state='expired',last_error='recovery_outdated'
    where n.phase='resolved' and n.mail_state='pending' and n.created_at<now()-interval '24 hours';
  update public.wa_connection_incident_notices n set mail_state='cancelled',lease_token=null,lease_until=null
    from public.wa_connection_incidents i
    where n.phase='opened' and n.incident_id=i.id and i.resolved_at is not null
      and n.mail_state in ('pending','sending') and (n.lease_until is null or n.lease_until<=now());
  return query
    with batch as (
      select n.id from public.wa_connection_incident_notices n
      where n.mail_state in ('pending','sending') and n.next_attempt_at<=now()
        and (n.lease_until is null or n.lease_until<=now())
        and (n.phase<>'resolved' or not exists (select from public.wa_connection_incident_notices earlier
                 where earlier.incident_id=n.incident_id and earlier.user_id=n.user_id
                   and earlier.phase='opened' and earlier.mail_state='sending'))
      order by n.next_attempt_at,n.created_at,n.id for update skip locked limit greatest(1,least(p_limit,32))
    ), claimed as (
      update public.wa_connection_incident_notices n set
        mail_state=case when r.user_id is null or r.email is distinct from n.recipient_email then 'cancelled' else 'sending' end,
        attempts=n.attempts+1, first_attempt_at=coalesce(n.first_attempt_at,now()),
        lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes'
      from batch b join public.wa_connection_incident_notices prior on prior.id=b.id
        join public.wa_connection_incidents incident on incident.id=prior.incident_id
        join public.wa_connections c on c.id=incident.connection_id
        left join lateral crm_internal.wa_line_recipients(c.organization_id,c.id,c.health_alert_owner_id) r on r.user_id=prior.user_id
      where n.id=b.id returning n.*
    )
    select n.id,n.lease_token,n.phase,n.recipient_email,i.line_label,i.reason,
           case when n.phase='opened' then i.opened_at else i.resolved_at end
      from claimed n join public.wa_connection_incidents i on i.id=n.incident_id where n.mail_state='sending';
end $$;

create function public.wa_finish_connection_email(p_id uuid,p_lease_token uuid,p_error text default null)
returns boolean language plpgsql set search_path = '' as $$
begin
  update public.wa_connection_incident_notices n set
    mail_state=case when p_error is null then 'sent'
                    when n.phase='opened' and i.resolved_at is not null then 'cancelled' else 'pending' end,
    lease_until=null,lease_token=null,last_error=left(p_error,80),
    next_attempt_at=now()+make_interval(mins=>least(60,1<<least(n.attempts-1,6)))
    from public.wa_connection_incidents i
    where n.id=p_id and i.id=n.incident_id and n.lease_token=p_lease_token and n.mail_state='sending';
  return found;
end $$;

revoke all on function crm_internal.wa_validate_alert_owner(), crm_internal.wa_line_recipients(uuid,uuid,uuid), crm_internal.wa_line_notify(public.wa_connection_incidents,uuid,text) from public,anon,authenticated;
grant execute on function crm_internal.wa_validate_alert_owner(), crm_internal.wa_line_recipients(uuid,uuid,uuid), crm_internal.wa_line_notify(public.wa_connection_incidents,uuid,text) to service_role;
revoke all on function public.wa_observe_connection(uuid,text,text,timestamptz,text,text,text), public.wa_claim_connection_emails(int), public.wa_finish_connection_email(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.wa_observe_connection(uuid,text,text,timestamptz,text,text,text), public.wa_claim_connection_emails(int), public.wa_finish_connection_email(uuid,uuid,text) to service_role;
COMMIT;
