BEGIN;
ALTER TABLE public.deal_signatures ADD COLUMN agent_client_signed_at timestamptz;
-- With concurrent signer callbacks an older signer snapshot may arrive last.
-- Remember the first verified customer signature independently of later snapshots.
CREATE FUNCTION crm_internal.remember_agent_client_signature() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.origin='agent' AND NEW.request->>'agent_delivery'='conversation' THEN
    NEW.agent_client_signed_at := OLD.agent_client_signed_at;
    IF NEW.agent_client_signed_at IS NULL AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(NEW.signers) s WHERE s->>'role'='contact'
        AND (NEW.status='signed' OR s->>'status'='signed' OR nullif(s->>'signed_at','') IS NOT NULL)) THEN
      NEW.agent_client_signed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER remember_agent_client_signature BEFORE UPDATE OF status,signers ON public.deal_signatures
FOR EACH ROW EXECUTE FUNCTION crm_internal.remember_agent_client_signature();
CREATE TABLE public.zapsign_agent_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  signature_id uuid NOT NULL REFERENCES public.deal_signatures(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('invite','signed')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','working','dispatching','sent','cancelled','attention')),
  due_at timestamptz NOT NULL DEFAULT now(),
  lease uuid,
  note text,
  UNIQUE(signature_id, kind)
);
CREATE INDEX zapsign_agent_notices_due_idx ON public.zapsign_agent_notices(due_at) WHERE state IN ('pending','working','dispatching');
ALTER TABLE public.zapsign_agent_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zapsign_agent_notices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zapsign_agent_notices TO service_role;

-- Commit the notification with the provider state. Only contracts explicitly
-- created for this flow can enqueue work; installing does not replay old rows.
CREATE FUNCTION crm_internal.enqueue_zapsign_agent_notice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE k text;
BEGIN
  IF NEW.origin <> 'agent' OR (NEW.request->>'agent_delivery') IS DISTINCT FROM 'conversation'
    OR NEW.doc_token IS NULL OR NEW.status NOT IN ('pending','signed') THEN RETURN NULL; END IF;
  IF NEW.agent_client_signed_at IS NOT NULL THEN
    k := 'signed';
    UPDATE public.zapsign_agent_notices SET state='cancelled', note='O cliente já assinou.'
      WHERE signature_id=NEW.id AND kind='invite' AND state IN ('pending','working');
  ELSIF NEW.sign_url IS NOT NULL THEN k := 'invite';
  ELSE RETURN NULL; END IF;
  INSERT INTO public.zapsign_agent_notices (organization_id,signature_id,kind) VALUES (NEW.organization_id,NEW.id,k)
    ON CONFLICT(signature_id,kind) DO NOTHING;
  RETURN NULL;
END $$;
CREATE TRIGGER enqueue_zapsign_agent_notice AFTER UPDATE OF status, sign_url, signers ON public.deal_signatures
FOR EACH ROW EXECUTE FUNCTION crm_internal.enqueue_zapsign_agent_notice();

-- A webhook can beat the HTTP response. Match the actual primary signer by token,
-- retaining any signature already recorded by the webhook on the same locked row.
CREATE FUNCTION public.bind_agent_contract_signer(p_org uuid,p_id uuid,p_doc text,p_signer jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  UPDATE public.deal_signatures s SET sign_url=coalesce(s.sign_url,p_signer->>'sign_url'),
    signers=(SELECT coalesce(jsonb_agg(CASE WHEN item->>'token'=p_signer->>'token'
      THEN p_signer || item || '{"role":"contact"}'::jsonb ELSE item END ORDER BY pos),'[]'::jsonb)
      FROM jsonb_array_elements(s.signers) WITH ORDINALITY e(item,pos)) ||
      CASE WHEN s.signers @> jsonb_build_array(jsonb_build_object('token',p_signer->>'token'))
        THEN '[]'::jsonb ELSE jsonb_build_array(p_signer) END
    WHERE s.organization_id=p_org AND s.id=p_id AND s.doc_token=p_doc AND s.origin='agent'
      AND coalesce(p_signer->>'token','') <> '' AND p_signer->>'role'='contact'
$$;
REVOKE ALL ON FUNCTION public.bind_agent_contract_signer(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bind_agent_contract_signer(uuid,uuid,text,jsonb) TO service_role;

CREATE FUNCTION public.claim_zapsign_agent_notice() RETURNS SETOF public.zapsign_agent_notices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- After dispatch starts the provider may already have a copy. Never retry an unknown send.
  UPDATE public.zapsign_agent_notices SET state='attention', note='Envio sem confirmação. Confira a conversa.'
    WHERE state='dispatching' AND due_at<=now();
  RETURN QUERY UPDATE public.zapsign_agent_notices n SET state='working', lease=gen_random_uuid(), due_at=now()+interval '3 minutes'
    WHERE n.id=(SELECT j.id FROM public.zapsign_agent_notices j WHERE j.state IN ('pending','working') AND j.due_at<=now()
      ORDER BY j.due_at,j.id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING n.*;
END $$;
REVOKE ALL ON FUNCTION public.claim_zapsign_agent_notice() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_zapsign_agent_notice() TO service_role;

-- Preserve the existing general tick and all its wake-up conditions.
SELECT cron.schedule('zapsign-agent-notices', '30 seconds', $job$
  SELECT public.wa_agents_call_app('/api/wa-agents/tick','{}'::jsonb)
  WHERE EXISTS (SELECT 1 FROM public.zapsign_agent_notices WHERE state IN ('pending','working','dispatching') AND due_at<=now())
$job$);
COMMIT;
