BEGIN;

CREATE INDEX wa_connections_health_due ON public.wa_connections(health_next_probe_at, id)
  WHERE health_monitor_enabled;

-- A reservation expires even if the worker crashes. It never implies a successful probe.
CREATE FUNCTION public.wa_claim_connection_probes(p_limit integer DEFAULT 20)
RETURNS TABLE (id uuid, provider text, instance_name text, instance_token text, base_url text, meta_phone_number_id text)
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH due AS (
    SELECT c.id FROM public.wa_connections c
    WHERE c.health_monitor_enabled AND (
      c.last_connected_at IS NOT NULL OR c.status = 'connected'
      OR (c.health_source = 'manual' AND c.status = 'connecting' AND c.health_state_at > now() - interval '10 minutes')
      OR c.health_uncertain_since > now() - interval '10 minutes'
    )
      AND c.health_next_probe_at <= now()
    ORDER BY c.health_next_probe_at, c.id LIMIT least(greatest(coalesce(p_limit, 20), 1), 40)
    FOR UPDATE SKIP LOCKED
  ) UPDATE public.wa_connections c SET health_next_probe_at = now() + interval '2 minutes'
    FROM due WHERE due.id = c.id
    RETURNING c.id, c.provider::text, c.instance_name::text, c.instance_token::text, c.base_url::text, c.meta_phone_number_id::text;
$$;
REVOKE ALL ON FUNCTION public.wa_claim_connection_probes(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_claim_connection_probes(integer) TO service_role;

-- Uses the existing authenticated tick. It must wake up even when the CRM is closed
-- and the previous tick consumed every follow-up that would normally wake the clock.
SELECT cron.schedule('wa-connection-health', '* * * * *', $job$
  SELECT public.wa_agents_call_app('/api/wa-agents/tick', '{"job":"connection_health"}'::jsonb);
$job$);
COMMIT;
