BEGIN;

ALTER TABLE public.wa_connection_incident_notices
  ADD COLUMN mail_provider text CHECK (mail_provider IN ('resend','hostinger')),
  DROP CONSTRAINT wa_connection_incident_notices_mail_state_check,
  ADD CHECK (mail_state IN ('pending','sending','submitting','sent','cancelled','expired','unconfirmed','failed'));

-- Every attempt made by an older deployment used Resend's idempotency key.
UPDATE public.wa_connection_incident_notices SET mail_provider='resend'
WHERE attempts>0 AND mail_state IN ('pending','sending');

CREATE FUNCTION public.wa_claim_connection_email_batch(p_limit int,p_providers text[],p_hostinger_start_at timestamptz)
RETURNS TABLE(id uuid,lease_token uuid,phase text,recipient_email text,line_label text,reason text,occurred_at timestamptz,mail_provider text)
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF cardinality(p_providers) IS NULL OR cardinality(p_providers)=0 OR array_position(p_providers,NULL) IS NOT NULL
     OR NOT (p_providers <@ ARRAY['hostinger','resend']::text[])
     OR ('hostinger'=ANY(p_providers) AND p_hostinger_start_at IS NULL) THEN
    RAISE EXCEPTION 'invalid mail provider configuration';
  END IF;

  -- A crash after an irreversible request is indistinguishable from a lost response.
  UPDATE public.wa_connection_incident_notices n SET mail_state='unconfirmed',last_error='hostinger_unconfirmed',lease_until=NULL,lease_token=NULL
  WHERE n.mail_state='submitting' AND n.lease_until<=now();
  IF p_providers[1]='hostinger' THEN
    UPDATE public.wa_connection_incident_notices n SET mail_state='cancelled',last_error='before_mail_activation'
    WHERE n.mail_state='pending' AND n.mail_provider IS NULL AND n.created_at<p_hostinger_start_at;
  END IF;
  UPDATE public.wa_connection_incident_notices n SET mail_state='expired',last_error='idempotency_window_elapsed'
  WHERE n.mail_state IN ('pending','sending') AND n.first_attempt_at<now()-interval '23 hours';
  UPDATE public.wa_connection_incident_notices n SET mail_state='expired',last_error='recovery_outdated'
  WHERE n.phase='resolved' AND n.mail_state='pending' AND n.created_at<now()-interval '24 hours';
  UPDATE public.wa_connection_incident_notices n SET mail_state='cancelled',lease_token=NULL,lease_until=NULL
  FROM public.wa_connection_incidents i
  WHERE n.phase='opened' AND n.incident_id=i.id AND i.resolved_at IS NOT NULL
    AND n.mail_state IN ('pending','sending') AND (n.lease_until IS NULL OR n.lease_until<=now());

  RETURN QUERY
    WITH batch AS (
      SELECT n.id FROM public.wa_connection_incident_notices n
      WHERE n.mail_state IN ('pending','sending') AND n.next_attempt_at<=now()
        AND (n.lease_until IS NULL OR n.lease_until<=now())
        AND coalesce(n.mail_provider,p_providers[1])=ANY(p_providers)
        AND (coalesce(n.mail_provider,p_providers[1])<>'hostinger' OR n.created_at>=p_hostinger_start_at)
        AND (n.phase<>'resolved' OR NOT EXISTS (SELECT FROM public.wa_connection_incident_notices earlier
                 WHERE earlier.incident_id=n.incident_id AND earlier.user_id=n.user_id
                   AND earlier.phase='opened' AND earlier.mail_state IN ('sending','submitting')))
      ORDER BY n.next_attempt_at,n.created_at,n.id FOR UPDATE SKIP LOCKED LIMIT greatest(1,least(p_limit,32))
    ), claimed AS (
      UPDATE public.wa_connection_incident_notices n SET
        mail_state=CASE WHEN r.user_id IS NULL OR r.email IS DISTINCT FROM n.recipient_email THEN 'cancelled' ELSE 'sending' END,
        mail_provider=coalesce(n.mail_provider,p_providers[1]),
        attempts=n.attempts+1,first_attempt_at=coalesce(n.first_attempt_at,now()),
        lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes'
      FROM batch b JOIN public.wa_connection_incident_notices prior ON prior.id=b.id
        JOIN public.wa_connection_incidents i ON i.id=prior.incident_id
        JOIN public.wa_connections c ON c.id=i.connection_id
        LEFT JOIN LATERAL crm_internal.wa_line_recipients(c.organization_id,c.id,c.health_alert_owner_id) r ON r.user_id=prior.user_id
      WHERE n.id=b.id RETURNING n.*
    )
    SELECT n.id,n.lease_token,n.phase,n.recipient_email,i.line_label,i.reason,
           CASE WHEN n.phase='opened' THEN i.opened_at ELSE i.resolved_at END,n.mail_provider
    FROM claimed n JOIN public.wa_connection_incidents i ON i.id=n.incident_id WHERE n.mail_state='sending';
END $$;

-- Workers running the old version can only claim rows belonging to Resend.
CREATE OR REPLACE FUNCTION public.wa_claim_connection_emails(p_limit int DEFAULT 16)
RETURNS TABLE(id uuid,lease_token uuid,phase text,recipient_email text,line_label text,reason text,occurred_at timestamptz)
LANGUAGE sql SET search_path='' AS $$
  SELECT n.id,n.lease_token,n.phase,n.recipient_email,n.line_label,n.reason,n.occurred_at
  FROM public.wa_claim_connection_email_batch(p_limit,ARRAY['resend'],NULL) n
$$;

CREATE FUNCTION public.wa_begin_hostinger_connection_email(p_id uuid,p_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $$
DECLARE armed boolean;
BEGIN
  WITH recipient AS (
    SELECT prior.id, ((prior.phase<>'opened' OR i.resolved_at IS NULL)
      AND EXISTS (SELECT FROM crm_internal.wa_line_recipients(c.organization_id,c.id,c.health_alert_owner_id) r
                  WHERE r.user_id=prior.user_id AND r.email=prior.recipient_email)) AS allowed
    FROM public.wa_connection_incident_notices prior
    JOIN public.wa_connection_incidents i ON i.id=prior.incident_id
    JOIN public.wa_connections c ON c.id=i.connection_id AND c.organization_id=prior.organization_id
    WHERE prior.id=p_id
  )
  UPDATE public.wa_connection_incident_notices n SET
    mail_state=CASE WHEN r.allowed THEN 'submitting' ELSE 'cancelled' END,
    lease_token=CASE WHEN r.allowed THEN n.lease_token END,
    lease_until=CASE WHEN r.allowed THEN n.lease_until END
  FROM recipient r
  WHERE n.id=r.id AND n.mail_provider='hostinger' AND n.mail_state='sending'
    AND n.lease_token=p_lease_token AND n.lease_until>now()
  RETURNING n.mail_state='submitting' INTO armed;
  RETURN coalesce(armed,false);
END $$;

CREATE OR REPLACE FUNCTION public.wa_finish_connection_email(p_id uuid,p_lease_token uuid,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  UPDATE public.wa_connection_incident_notices n SET
    mail_state=CASE WHEN p_error IS NULL THEN 'sent'
                    WHEN n.mail_provider='hostinger' AND p_error='hostinger_http_422' THEN 'failed'
                    WHEN n.mail_provider='hostinger' AND p_error NOT IN ('hostinger_http_401','hostinger_http_403','hostinger_http_429') THEN 'unconfirmed'
                    WHEN n.phase='opened' AND i.resolved_at IS NOT NULL THEN 'cancelled'
                    ELSE 'pending' END,
    lease_until=NULL,lease_token=NULL,last_error=left(p_error,80),
    next_attempt_at=now()+make_interval(mins=>least(60,1<<least(n.attempts-1,6)))
  FROM public.wa_connection_incidents i
  WHERE n.id=p_id AND i.id=n.incident_id AND n.lease_token=p_lease_token
    AND ((n.mail_provider='resend' AND n.mail_state='sending') OR (n.mail_provider='hostinger' AND n.mail_state='submitting'));
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION public.wa_claim_connection_email_batch(int,text[],timestamptz),public.wa_begin_hostinger_connection_email(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wa_claim_connection_email_batch(int,text[],timestamptz),public.wa_begin_hostinger_connection_email(uuid,uuid) TO service_role;
COMMIT;
