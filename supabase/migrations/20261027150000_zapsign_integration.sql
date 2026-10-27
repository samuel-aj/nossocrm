-- =============================================================================
-- Integração ZapSign (assinatura eletrônica)
-- =============================================================================
-- 1) zapsign_settings: token da conta ZapSign de cada organização e o webhook
--    que o CRM cria lá (com o segredo que valida o retorno).
-- 2) stage_signature_rules: "ao entrar nesta etapa, manda o contrato X para
--    assinar", com o mapa das variáveis do modelo e o que fazer ao assinar.
-- 3) deal_signatures: cada documento enviado para assinatura (fila + estado),
--    um por lead/etapa quando vem de regra; o manual pode repetir.
-- 4) zapsign_webhook_events: o que a ZapSign devolveu (dedupe das repetições).
-- Nada existente muda ao aplicar; começa tudo desligado. Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.zapsign_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  api_token text NOT NULL,
  sandbox boolean NOT NULL DEFAULT false,
  webhook_id text,
  webhook_url text,
  webhook_secret text NOT NULL,
  template_count integer,
  verified_at timestamptz,
  last_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.zapsign_settings ENABLE ROW LEVEL SECURITY;
-- Só o servidor (service role) lê e grava: o token nunca sai para o navegador.

CREATE TABLE IF NOT EXISTS public.stage_signature_rules (
  stage_id uuid PRIMARY KEY REFERENCES public.board_stages(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  template_token text NOT NULL,
  template_name text,
  -- título do documento na ZapSign (aceita {{variáveis}} do CRM)
  doc_name text,
  -- variável do modelo -> origem no CRM ("contato.nome", "campo:cpf", "texto:São Paulo", "")
  variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- {auth_mode, require_cpf, require_selfie_photo, require_document_photo, send, message, allow_refuse}
  signer jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- outros signatários fixos (ex.: o advogado): [{name, email, phone, qualification}]
  extra_signers jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- {stage_id, tag, bot_id}
  on_signed jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- {stage_id, tag}
  on_refused jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
CREATE INDEX IF NOT EXISTS stage_signature_rules_org_idx ON public.stage_signature_rules (organization_id);
ALTER TABLE public.stage_signature_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stage_signature_rules_select ON public.stage_signature_rules;
CREATE POLICY stage_signature_rules_select ON public.stage_signature_rules
  FOR SELECT USING (organization_id IN (SELECT public.user_org_ids(auth.uid())));

CREATE TABLE IF NOT EXISTS public.deal_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  contact_id uuid,
  stage_id uuid,                                  -- etapa do lead no envio
  origin text NOT NULL CHECK (origin IN ('rule', 'manual')),
  requested_by uuid,                              -- usuário (envio manual)
  template_token text,
  template_name text,
  doc_token text,
  doc_name text,
  status text NOT NULL CHECK (status IN ('queued', 'processing', 'pending', 'signed', 'refused', 'deleted', 'expired', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lock_until timestamptz,
  -- envio manual: variáveis e opções escolhidas na hora (regra = usa a da etapa)
  request jsonb,
  -- [{token, name, email, phone, sign_url, status, signed_at}]
  signers jsonb NOT NULL DEFAULT '[]'::jsonb,
  sign_url text,
  sent_via text,                                  -- crm_whatsapp | zapsign_whatsapp | zapsign_email | link
  sent_at timestamptz,
  signed_at timestamptz,
  refused_at timestamptz,
  refused_reason text,
  file_id uuid,                                   -- deal_files.id do PDF assinado
  file_path text,
  last_event_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS deal_signatures_doc_token_idx
  ON public.deal_signatures (organization_id, doc_token) WHERE doc_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS deal_signatures_deal_idx ON public.deal_signatures (deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS deal_signatures_queue_idx
  ON public.deal_signatures (next_attempt_at) WHERE status = 'queued';
ALTER TABLE public.deal_signatures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_signatures_select ON public.deal_signatures;
CREATE POLICY deal_signatures_select ON public.deal_signatures
  FOR SELECT USING (organization_id IN (SELECT public.user_org_ids(auth.uid())));

CREATE TABLE IF NOT EXISTS public.zapsign_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  doc_token text,
  event_type text,
  dedupe_key text NOT NULL,
  processed boolean NOT NULL DEFAULT false,
  error text,
  payload jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS zapsign_webhook_events_dedupe_idx ON public.zapsign_webhook_events (organization_id, dedupe_key);
ALTER TABLE public.zapsign_webhook_events ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------- Regra: versão
CREATE OR REPLACE FUNCTION crm_internal.signature_rule_before()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_signature_rule_before ON public.stage_signature_rules;
CREATE TRIGGER trg_signature_rule_before
  BEFORE INSERT OR UPDATE ON public.stage_signature_rules
  FOR EACH ROW EXECUTE FUNCTION crm_internal.signature_rule_before();

-- ---------------------------------------------------------------- Entrada na etapa: enfileira
-- UMA vez por lead em cada etapa (já enviado, mesmo que falhou ou foi recusado,
-- não repete sozinho; o envio manual continua possível).
CREATE OR REPLACE FUNCTION crm_internal.signature_on_deal_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id AND NEW.board_id IS NOT DISTINCT FROM OLD.board_id THEN
    RETURN NULL;
  END IF;
  IF NEW.stage_id IS NULL OR NEW.deleted_at IS NOT NULL OR coalesce(NEW.is_won, false) OR coalesce(NEW.is_lost, false) THEN
    RETURN NULL;
  END IF;
  SELECT stage_id, organization_id INTO r
    FROM public.stage_signature_rules
   WHERE stage_id = NEW.stage_id AND enabled AND organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.zapsign_settings WHERE organization_id = NEW.organization_id) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.deal_signatures s
     WHERE s.deal_id = NEW.id AND s.stage_id = NEW.stage_id AND s.origin = 'rule'
  ) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.deal_signatures (organization_id, deal_id, contact_id, stage_id, origin, status)
  VALUES (NEW.organization_id, NEW.id, NEW.contact_id, NEW.stage_id, 'rule', 'queued');
  -- acorda o processador do app (mesmo caminho dos robôs)
  PERFORM public.wa_agents_call_app('/api/wa-agents/tick', '{}'::jsonb);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'signature_on_deal_change falhou: %', SQLERRM;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_signature_on_deal_change ON public.deals;
CREATE TRIGGER trg_signature_on_deal_change
  AFTER INSERT OR UPDATE OF stage_id, board_id ON public.deals
  FOR EACH ROW EXECUTE FUNCTION crm_internal.signature_on_deal_change();

-- ---------------------------------------------------------------- Fila
CREATE OR REPLACE FUNCTION public.deal_signature_claim(p_limit integer DEFAULT 5)
RETURNS SETOF public.deal_signatures
LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $$
  UPDATE public.deal_signatures s
     SET status = 'processing', lock_until = now() + interval '5 minutes', attempts = s.attempts + 1, updated_at = now()
   WHERE s.id IN (
     SELECT id FROM public.deal_signatures
      WHERE (status = 'queued' AND next_attempt_at <= now())
         OR (status = 'processing' AND lock_until < now())
      ORDER BY next_attempt_at
      LIMIT greatest(1, least(p_limit, 50))
      FOR UPDATE SKIP LOCKED
   )
  RETURNING s.*;
$$;
REVOKE ALL ON FUNCTION public.deal_signature_claim(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deal_signature_claim(integer) TO service_role;

-- ---------------------------------------------------------------- Relógio
-- O tick também acorda para assinaturas na fila.
DO $$
DECLARE
  jid bigint;
  cmd text;
  marker text := 'OR EXISTS (SELECT 1 FROM public.deal_followup_schedules WHERE status = ''processing'' AND lock_until < now())';
BEGIN
  SELECT jobid, command INTO jid, cmd FROM cron.job WHERE jobname = 'wa-agents-tick';
  IF jid IS NOT NULL AND cmd NOT LIKE '%deal_signatures%' AND position(marker IN cmd) > 0 THEN
    PERFORM cron.alter_job(jid, command := replace(cmd, marker,
      marker || E'\n          OR EXISTS (SELECT 1 FROM public.deal_signatures WHERE status = ''queued'' AND next_attempt_at <= now())'
             || E'\n          OR EXISTS (SELECT 1 FROM public.deal_signatures WHERE status = ''processing'' AND lock_until < now())'));
  END IF;
END;
$$;
