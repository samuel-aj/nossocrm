begin;

create index wa_connection_incidents_line_opened on public.wa_connection_incidents(connection_id, opened_at desc);

-- The connection screen and Chats poll the same cache. Read the visible lines and
-- their delivery receipts in a single snapshot. The caller supplies authorized IDs.
create function public.wa_line_diagnostics(p_org uuid, p_connections uuid[])
returns table(
  connection_id uuid, opened_at timestamptz, incident_reason text,
  last_delivered_message_at timestamptz, last_inbound_at timestamptz,
  failed_count integer, pending_count integer, review_count integer,
  last_incident_opened_at timestamptz, last_incident_resolved_at timestamptz,
  last_incident_source text, diagnostic_reason text, diagnostic_source text, diagnostic_at timestamptz
) language sql stable security invoker set search_path = '' as $$
  select c.id, case when i.resolved_at is null then i.opened_at end, i.reason, delivered.created_at, inbound.created_at,
    case when recent.total >= 2 and recent.failed = recent.total then recent.failed else 0 end,
    pending.queued, pending.review, i.opened_at, i.resolved_at, i.source,
    coalesce(finding.reason, i.reason), coalesce(finding.source, i.source), coalesce(finding.observed_at, i.opened_at)
  from public.wa_connections c
  left join lateral (
    select incident.* from public.wa_connection_incidents incident
    where incident.connection_id = c.id and incident.organization_id = p_org
    order by incident.opened_at desc limit 1
  ) i on true
  left join lateral (
    select e.reason, e.source, e.observed_at from public.wa_connection_health_events e
    where e.connection_id = c.id and e.organization_id = p_org
      and e.observed_at >= i.opened_at and (i.resolved_at is null or e.observed_at <= i.resolved_at)
      and e.applied and e.state <> 'connected' and e.source not in ('manual', 'delivery')
      and e.reason is not null
    -- Keep a provider's specific diagnosis even if a later poll just says "closed".
    order by case when e.reason = 'number_changed' then 0
                  when e.reason ~ '^(evolution_disconnect_[0-9]+|meta_code_[0-9]+|evolution_send_http_[0-9]+)' then 1
                  when e.reason ~ '^(evolution_http_[0-9]+|meta_http_[0-9]+|probe_timeout|probe_transport_error|meta_health_blocked|meta_missing_credentials)$' then 2
                  when e.source in ('webhook', 'send_failure', 'poll') and e.reason <> 'verification_unavailable' then 3
                  else 4 end,
             e.observed_at desc, e.id desc limit 1
  ) finding on true
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
    where i.opened_at is not null and i.resolved_at is null and v.connection_id = c.id and v.organization_id = p_org
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
