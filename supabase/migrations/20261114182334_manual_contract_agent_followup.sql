BEGIN;

-- New manually reviewed contracts may keep the existing agent responsible for
-- post-signature service. This changes trigger logic only: no historical row,
-- conversation state, paused agent, or existing notice is rewritten here.
CREATE OR REPLACE FUNCTION crm_internal.remember_agent_client_signature() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF (NEW.origin='agent' AND NEW.request->>'agent_delivery'='conversation')
    OR (NEW.origin IN ('manual','rule') AND NEW.request->>'agent_delivery'='signed_only') THEN
    NEW.agent_client_signed_at := OLD.agent_client_signed_at;
    IF NEW.agent_client_signed_at IS NULL AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(NEW.signers) s WHERE s->>'role'='contact'
        AND (NEW.status='signed' OR s->>'status'='signed' OR nullif(s->>'signed_at','') IS NOT NULL)) THEN
      NEW.agent_client_signed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION crm_internal.enqueue_zapsign_agent_notice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE k text;
BEGIN
  IF ((NEW.origin='agent' AND NEW.request->>'agent_delivery'='conversation')
    OR (NEW.origin IN ('manual','rule') AND NEW.request->>'agent_delivery'='signed_only')) IS DISTINCT FROM true
    OR coalesce(NEW.request->>'agent_id','')=''
    OR coalesce(NEW.request->>'conversation_id','')=''
    OR coalesce(NEW.request->>'connection_id','')=''
    OR coalesce(NEW.request->>'recipient','')=''
    OR NEW.doc_token IS NULL OR NEW.status NOT IN ('pending','signed') THEN RETURN NULL; END IF;
  IF NEW.agent_client_signed_at IS NOT NULL THEN
    k := 'signed';
    UPDATE public.zapsign_agent_notices SET state='cancelled', note='O cliente já assinou.'
      WHERE signature_id=NEW.id AND kind='invite' AND state IN ('pending','working');
  ELSIF NEW.origin='agent' AND NEW.request->>'agent_delivery'='conversation' AND NEW.sign_url IS NOT NULL THEN
    k := 'invite';
  ELSE RETURN NULL; END IF;
  INSERT INTO public.zapsign_agent_notices (organization_id,signature_id,kind) VALUES (NEW.organization_id,NEW.id,k)
    ON CONFLICT(signature_id,kind) DO NOTHING;
  RETURN NULL;
END $$;

COMMIT;
