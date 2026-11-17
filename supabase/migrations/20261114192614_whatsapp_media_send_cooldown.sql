-- A separate, rolling transport guard. Does not replace per-conversation agent receipts.
create table public.wa_media_send_cooldowns (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.wa_conversations(id) on delete cascade,
  media_key text not null check (media_key ~ '^[a-f0-9]{64}$'),
  attempt_id uuid not null,
  blocked_until timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, conversation_id, media_key)
);
alter table public.wa_media_send_cooldowns enable row level security;
revoke all on public.wa_media_send_cooldowns from public, anon, authenticated;
grant select, insert, update, delete on public.wa_media_send_cooldowns to service_role;

create or replace function public.claim_wa_media_cooldown(
  p_org uuid, p_conversation uuid, p_media_key text, p_attempt uuid
) returns table(acquired boolean, retry_after_seconds integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_until timestamptz;
begin
  if p_attempt is null or p_media_key is null or p_media_key !~ '^[a-f0-9]{64}$'
    or not exists (select 1 from public.wa_conversations c where c.id = p_conversation and c.organization_id = p_org) then
    raise exception 'Invalid media conversation scope';
  end if;
  insert into public.wa_media_send_cooldowns as existing
    (organization_id, conversation_id, media_key, attempt_id, blocked_until, updated_at)
    values (p_org, p_conversation, p_media_key, p_attempt, v_now + interval '60 seconds', v_now)
  on conflict (organization_id, conversation_id, media_key) do update
    set attempt_id = excluded.attempt_id, blocked_until = excluded.blocked_until, updated_at = excluded.updated_at
    where existing.blocked_until <= v_now
  returning blocked_until into v_until;
  if found then return query select true, 60; return; end if;
  select c.blocked_until into v_until from public.wa_media_send_cooldowns c
    where c.organization_id = p_org and c.conversation_id = p_conversation and c.media_key = p_media_key;
  return query select false, greatest(1, ceil(extract(epoch from (v_until - clock_timestamp())))::integer);
end;
$$;

-- Before hooks: cover the whole remaining request lifetime, not only 60s.
create or replace function public.touch_wa_media_cooldown(
  p_org uuid, p_conversation uuid, p_media_key text, p_attempt uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.wa_media_send_cooldowns set blocked_until = clock_timestamp() + interval '300 seconds', updated_at = clock_timestamp()
    where organization_id = p_org and conversation_id = p_conversation and media_key = p_media_key and attempt_id = p_attempt;
  return found;
end;
$$;
-- A provider acknowledgement starts the actual short cooldown. A stale worker cannot shorten a newer lease.
create or replace function public.finish_wa_media_cooldown(
  p_org uuid, p_conversation uuid, p_media_key text, p_attempt uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.wa_media_send_cooldowns set blocked_until = clock_timestamp() + interval '60 seconds', updated_at = clock_timestamp()
    where organization_id = p_org and conversation_id = p_conversation and media_key = p_media_key and attempt_id = p_attempt;
  return found;
end;
$$;
revoke all on function public.claim_wa_media_cooldown(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.touch_wa_media_cooldown(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.finish_wa_media_cooldown(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_wa_media_cooldown(uuid, uuid, text, uuid) to service_role;
grant execute on function public.touch_wa_media_cooldown(uuid, uuid, text, uuid) to service_role;
grant execute on function public.finish_wa_media_cooldown(uuid, uuid, text, uuid) to service_role;
