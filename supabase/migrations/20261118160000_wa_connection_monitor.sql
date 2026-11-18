BEGIN;

CREATE INDEX wa_connections_health_due ON public.wa_connections(health_next_probe_at, id)
  WHERE health_monitor_enabled;

-- A reservation expires even if the worker crashes. It never implies a successful probe.
CREATE FUNCTION public.wa_claim_connection_probes(p_limit integer DEFAULT 20)
RETURNS TABLE (id uuid, provider text, instance_name text, instance_token text, base_url text, meta_phone_number_id text,last_connected_at timestamptz)
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
    RETURNING c.id, c.provider::text, c.instance_name::text, c.instance_token::text, c.base_url::text, c.meta_phone_number_id::text, c.last_connected_at;
$$;
REVOKE ALL ON FUNCTION public.wa_claim_connection_probes(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_claim_connection_probes(integer) TO service_role;

-- Keep the scheduler's perspective even when the app cannot write its own logs.
-- A 202 only establishes acceptance by the CRM endpoint, not a WhatsApp delivery.
CREATE TABLE crm_internal.wa_connection_monitor_dispatches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  requested_at timestamptz NOT NULL DEFAULT now(),
  request_id bigint,
  result text NOT NULL CHECK (result IN ('pending','accepted','http_error','timeout','transport_error','no_response','not_queued')),
  http_status integer
);
CREATE INDEX wa_monitor_dispatch_time ON crm_internal.wa_connection_monitor_dispatches(requested_at);
CREATE INDEX wa_monitor_dispatch_pending ON crm_internal.wa_connection_monitor_dispatches(request_id) WHERE result='pending';
REVOKE ALL ON crm_internal.wa_connection_monitor_dispatches FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION crm_internal.dispatch_wa_connection_monitor() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE req bigint;
BEGIN
  UPDATE crm_internal.wa_connection_monitor_dispatches d
  SET result=CASE WHEN r.timed_out THEN 'timeout'
                  WHEN r.status_code=202 THEN 'accepted'
                  WHEN r.status_code IS NULL THEN 'transport_error'
                  ELSE 'http_error' END,
      http_status=r.status_code
  FROM net._http_response r WHERE d.result='pending' AND d.request_id=r.id;
  UPDATE crm_internal.wa_connection_monitor_dispatches SET result='no_response'
    WHERE result='pending' AND requested_at < now()-interval '3 minutes';
  DELETE FROM crm_internal.wa_connection_monitor_dispatches WHERE requested_at < now()-interval '30 days';
  req := public.wa_agents_call_app('/api/wa-agents/tick','{"job":"connection_health"}'::jsonb);
  INSERT INTO crm_internal.wa_connection_monitor_dispatches(request_id,result)
    VALUES (req,CASE WHEN req IS NULL THEN 'not_queued' ELSE 'pending' END);
END $$;
REVOKE ALL ON FUNCTION crm_internal.dispatch_wa_connection_monitor() FROM PUBLIC, anon, authenticated, service_role;

SELECT cron.schedule('wa-connection-health', '* * * * *', $job$
  SELECT crm_internal.dispatch_wa_connection_monitor();
$job$);
COMMIT;
