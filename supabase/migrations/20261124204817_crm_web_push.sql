begin;

-- A browser endpoint is a capability: only the authenticated server routes may access it.
create table public.crm_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null check (endpoint like 'https://%' and octet_length(endpoint) <= 4096),
  endpoint_hash text not null check (endpoint_hash = encode(sha256(convert_to(endpoint, 'UTF8')), 'hex')),
  p256dh text not null check (length(p256dh) between 1 and 128),
  auth text not null check (length(auth) between 1 and 64),
  created_at timestamptz not null default now(),
  unique (endpoint_hash, organization_id)
);
create index crm_push_subscriptions_org_user on public.crm_push_subscriptions(organization_id, user_id);

create table public.crm_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.crm_push_subscriptions(id) on delete cascade,
  event_id bigint not null references public.crm_notification_events(id) on delete cascade,
  message_id uuid not null,
  created_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  attempts smallint not null default 0,
  lease_token uuid,
  lease_until timestamptz,
  finished_at timestamptz,
  unique (subscription_id, message_id),
  check ((lease_token is null) = (lease_until is null))
);
create index crm_push_deliveries_due on public.crm_push_deliveries(available_at, id) where finished_at is null;
create index crm_push_deliveries_age on public.crm_push_deliveries(created_at);
create index crm_push_deliveries_event on public.crm_push_deliveries(event_id);
alter table public.crm_push_subscriptions enable row level security;
alter table public.crm_push_deliveries enable row level security;
revoke all on public.crm_push_subscriptions, public.crm_push_deliveries from public, anon, authenticated, service_role;
grant select, delete on public.crm_push_subscriptions to service_role;
grant select on public.crm_push_deliveries to service_role;

-- Match withTabOrg and reject disabled offices or disabled/deleted accounts even
-- if an old device still exists. A push has no current browser session to consult.
create function public.crm_push_recipient_role(p_org uuid, p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when p.role::text = 'super_admin' then 'super_admin'
              when membership.user_id is not null then coalesce(membership.role::text, p.role::text)
              when p.organization_id = p_org then p.role::text end
  from public.profiles p
  join auth.users u on u.id = p.id and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now())
  join public.organizations org on org.id = p_org and org.is_active is not false
  left join public.user_organizations membership on membership.user_id = p.id and membership.organization_id = org.id
  where p.id = p_user
$$;

create function public.register_crm_push_subscription(
  p_org uuid, p_user uuid, p_endpoint text, p_p256dh text, p_auth text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  fingerprint text := encode(sha256(convert_to(p_endpoint, 'UTF8')), 'hex');
  registration uuid;
begin
  if public.crm_push_recipient_role(p_org,p_user) is null then
    raise exception 'Push indisponível para este usuário nesta organização' using errcode='42501';
  end if;
  -- Keep one identity per browser, allowing the same user to enable multiple offices.
  -- A fresh id on key rotation prevents an old provider response revoking the new keys.
  perform pg_advisory_xact_lock(hashtextextended(fingerprint, 0));
  delete from public.crm_push_subscriptions where endpoint_hash = fingerprint
    and (user_id <> p_user or (organization_id = p_org and (p256dh <> p_p256dh or auth <> p_auth)));
  select id into registration from public.crm_push_subscriptions
    where endpoint_hash = fingerprint and organization_id = p_org and user_id = p_user;
  if registration is null then
    insert into public.crm_push_subscriptions(organization_id, user_id, endpoint, endpoint_hash, p256dh, auth)
      values (p_org, p_user, p_endpoint, fingerprint, p_p256dh, p_auth) returning id into registration;
  end if;
  return registration;
end $$;

-- Use the existing installation's internal URL and secret with a fixed path.
-- A failed wakeup never loses the queued delivery; cron will pick it up.
create function crm_internal.wake_crm_web_push() returns void
language plpgsql security definer set search_path = '' as $$
declare base text; secret text;
begin
  select value into base from public.platform_config where key='wa_agents_app_url';
  select value into secret from public.platform_config where key='wa_agents_internal_secret';
  if nullif(base,'') is not null and nullif(secret,'') is not null then
    perform net.http_post(url:=rtrim(base,'/')||'/api/notifications/push/dispatch',
      headers:=jsonb_build_object('Content-Type','application/json','X-Internal-Secret',secret),
      body:='{"job":"web_push"}'::jsonb, timeout_milliseconds:=20000);
  end if;
exception when others then
  raise warning 'CRM: falha ao chamar o serviço de push (%).', SQLSTATE;
end $$;

-- The existing incoming-message trigger already journals this event in the same
-- transaction as the message. Fan out only to opted-in devices. The dispatcher
-- must check the live membership, lead scope and conversation permissions before
-- each send, allowing for a change of owner/access after this snapshot.
create function crm_internal.queue_crm_web_push() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.crm_push_deliveries(subscription_id, event_id, message_id)
    select s.id, new.id, new.source_id
    from public.crm_push_subscriptions s
    join public.crm_notification_preferences p on p.organization_id = s.organization_id and p.user_id = s.user_id
    where s.organization_id = new.organization_id and p.preferences->'messages' = 'true'::jsonb
      and exists (
        select 1 from public.wa_messages m join public.wa_conversations c
          on c.id=m.conversation_id and c.organization_id=m.organization_id
        where m.id=new.source_id and m.organization_id=new.organization_id and m.direction='in'
          and m.deleted_at is null and c.is_group is false
          and coalesce(m.wa_timestamp,m.created_at) >= new.created_at - interval '2 minutes'
      )
    for key share of s
    on conflict (subscription_id, message_id) do nothing;
  if found then perform crm_internal.wake_crm_web_push(); end if;
  return new;
exception when others then
  -- An optional notification must not abort the inbound message or its journal.
  raise warning 'CRM: falha ao enfileirar o push (%).', SQLSTATE;
  return new;
end $$;
create trigger queue_crm_web_push after insert on public.crm_notification_events
  for each row when (new.kind='message') execute function crm_internal.queue_crm_web_push();

create function public.claim_crm_push_deliveries(p_limit integer)
returns table (id uuid, lease_token uuid, event_id text, organization_id uuid,
               user_id uuid, subscription_id uuid, message_id uuid)
language sql security definer set search_path = '' as $$
  with due as (
    select d.id from public.crm_push_deliveries d where d.finished_at is null
      and d.available_at<=now() and d.attempts<5 and d.created_at>now()-interval '24 hours'
    order by d.available_at, d.id limit greatest(0,least(coalesce(p_limit,20),50)) for update of d skip locked
  ), claimed as (
    update public.crm_push_deliveries d set attempts=d.attempts+1,
      lease_token=gen_random_uuid(), lease_until=now()+interval '5 minutes', available_at=now()+interval '5 minutes'
    from due where d.id=due.id returning d.*
  )
  select c.id,c.lease_token,c.event_id::text,s.organization_id,s.user_id,c.subscription_id,c.message_id
  from claimed c join public.crm_push_subscriptions s on s.id=c.subscription_id
$$;

create function public.finish_crm_push_delivery(p_id uuid, p_lease uuid, p_outcome text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  job public.crm_push_deliveries;
begin
  if p_outcome is null or p_outcome not in ('sent','skip','gone','retry') then
    raise exception 'Resultado de push inválido';
  end if;
  if p_outcome='gone' then
    -- Registration/key rotation uses the same parent-before-child lock order.
    perform s.id from public.crm_push_subscriptions s join public.crm_push_deliveries d on d.subscription_id=s.id
      where d.id=p_id and d.lease_token=p_lease for update of s;
  end if;
  select * into job from public.crm_push_deliveries d where d.id=p_id and d.lease_token=p_lease
    and d.lease_until>now() and d.finished_at is null for update;
  if not found then return false; end if;
  if p_outcome='gone' then
    delete from public.crm_push_subscriptions where id=job.subscription_id;
  elsif p_outcome='retry' and job.attempts<5 and job.created_at>now()-interval '24 hours' then
    update public.crm_push_deliveries set lease_token=null,lease_until=null,
      available_at=now()+interval '30 seconds'*power(2,job.attempts-1) where id=p_id;
  else
    update public.crm_push_deliveries set lease_token=null,lease_until=null,finished_at=now() where id=p_id;
  end if;
  return true;
end $$;
revoke all on function crm_internal.wake_crm_web_push(), crm_internal.queue_crm_web_push()
  from public,anon,authenticated,service_role;
revoke all on function public.crm_push_recipient_role(uuid,uuid),
  public.register_crm_push_subscription(uuid,uuid,text,text,text),
  public.claim_crm_push_deliveries(integer),public.finish_crm_push_delivery(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.crm_push_recipient_role(uuid,uuid),
  public.register_crm_push_subscription(uuid,uuid,text,text,text),
  public.claim_crm_push_deliveries(integer),public.finish_crm_push_delivery(uuid,uuid,text)
  to service_role;

select cron.schedule('crm-web-push','* * * * *',$job$
  with old as (
    select id from public.crm_push_deliveries where created_at<=now()-interval '24 hours'
    order by created_at limit 500 for update skip locked
  ) delete from public.crm_push_deliveries d using old where d.id=old.id;
  select crm_internal.wake_crm_web_push() where exists (
    select 1 from public.crm_push_deliveries where finished_at is null and available_at<=now()
      and attempts<5 and created_at>now()-interval '24 hours'
  );
$job$);
commit;
