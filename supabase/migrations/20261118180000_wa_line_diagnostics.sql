begin;

create index wa_connection_pending_diagnostics on public.wa_agent_connection_pending(connection_id, state)
  where state in ('pending', 'dispatching', 'review');

-- The connection screen and Chats poll the same cache. Read the visible lines and
-- their delivery receipts in a single snapshot. The caller supplies authorized IDs.
create function public.wa_line_diagnostics(p_org uuid, p_connections uuid[])
returns table(
  connection_id uuid, opened_at timestamptz, incident_reason text,
  last_delivered_message_at timestamptz, last_inbound_at timestamptz,
  failed_count integer, pending_count integer, review_count integer
) language sql stable security invoker set search_path = '' as $$
  select c.id, i.opened_at, i.reason, delivered.created_at, inbound.created_at,
    case when recent.total >= 2 and recent.failed = recent.total then recent.failed else 0 end,
    pending.queued, pending.review
  from public.wa_connections c
  left join public.wa_connection_incidents i on i.connection_id = c.id and i.resolved_at is null
  left join lateral (
    select max(latest.created_at) as created_at from public.wa_conversations v
    cross join lateral (
      select m.created_at from public.wa_messages m
      where m.conversation_id = v.id and m.organization_id = p_org and m.direction = 'out' and m.status in ('delivered', 'read')
      order by m.created_at desc limit 1
    ) latest where v.connection_id = c.id and v.organization_id = p_org
  ) delivered on true
  left join lateral (
    select m.created_at from public.wa_messages m join public.wa_conversations v on v.id = m.conversation_id
    where i.opened_at is not null and v.connection_id = c.id and v.organization_id = p_org
      and m.organization_id = p_org and m.direction = 'in' and m.created_at >= i.opened_at
    order by m.created_at desc limit 1
  ) inbound on true
  left join lateral (
    select count(*)::int as total, (count(*) filter(where last_five.status = 'failed'))::int as failed
    from (
      select m.status from public.wa_messages m join public.wa_conversations v on v.id = m.conversation_id
      where v.connection_id = c.id and v.organization_id = p_org and m.organization_id = p_org and m.direction = 'out'
        and m.created_at >= greatest(now() - interval '2 hours', c.last_connected_at)
      order by m.created_at desc limit 5
    ) last_five
  ) recent on true
  left join lateral (
    select (count(*) filter(where q.state in ('pending', 'dispatching')))::int as queued,
      (count(*) filter(where q.state = 'review'))::int as review
    from public.wa_agent_connection_pending q
    where q.connection_id = c.id and q.organization_id = p_org and q.state in ('pending', 'dispatching', 'review')
  ) pending on true
  where c.organization_id = p_org and c.id = any(p_connections);
$$;
revoke all on function public.wa_line_diagnostics(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.wa_line_diagnostics(uuid, uuid[]) to service_role;

commit;
