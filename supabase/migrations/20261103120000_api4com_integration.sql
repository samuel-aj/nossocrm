-- =============================================================================
-- Integração API4com (telefonia): ligar pelo CRM e registrar a chamada
-- =============================================================================
-- 1) api4com_user_settings: a API4com dá um token e um ramal POR USUÁRIO, então
--    cada vendedor conecta o seu (token, ramal e o webhook cadastrado lá).
-- 2) api4com_calls: cada ligação feita pelo CRM (estado, duração, gravação).
-- 3) api4com_webhook_events: avisos recebidos da API4com (dedupe das repetições).
-- Nada existente muda ao aplicar; começa tudo desligado. Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.api4com_user_settings (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  api_token text NOT NULL,
  api4com_uuid text,
  api4com_name text,
  api4com_email text,
  extension text,                                 -- ramal do usuário na API4com
  domain text,                                    -- domínio SIP da conta (ex.: empresa.api4com.com)
  integration_id text,                            -- id da integração (webhook) criada na API4com
  webhook_url text,
  webhook_secret text NOT NULL,                   -- vai na URL do webhook (a API4com não manda cabeçalho próprio)
  verified_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS api4com_user_settings_secret_idx ON public.api4com_user_settings (webhook_secret);
ALTER TABLE public.api4com_user_settings ENABLE ROW LEVEL SECURITY;
-- Só o servidor (service role) lê e grava: o token nunca sai para o navegador.

CREATE TABLE IF NOT EXISTS public.api4com_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,                          -- quem ligou
  deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  contact_id uuid,
  called text NOT NULL,                           -- número discado (E.164)
  extension text,                                 -- ramal usado
  call_id text,                                   -- id da chamada na API4com
  status text NOT NULL CHECK (status IN ('dialing', 'ringing', 'answered', 'ended', 'failed')),
  result text,                                    -- answered | no_answer | busy | voicemail | invalid | cancelled | failed
  started_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  ended_at timestamptz,
  duration integer,                               -- segundos de conversa
  hangup_cause text,
  hangup_cause_code text,
  record_url text,
  error text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS api4com_calls_call_id_idx ON public.api4com_calls (organization_id, call_id) WHERE call_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS api4com_calls_deal_idx ON public.api4com_calls (deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api4com_calls_user_idx ON public.api4com_calls (organization_id, user_id, created_at DESC);
ALTER TABLE public.api4com_calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS api4com_calls_select ON public.api4com_calls;
CREATE POLICY api4com_calls_select ON public.api4com_calls
  FOR SELECT USING (organization_id IN (SELECT public.user_org_ids(auth.uid())));

CREATE TABLE IF NOT EXISTS public.api4com_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  dedupe_key text NOT NULL,                       -- id da chamada + tipo do evento
  event_type text,
  call_id text,
  processed boolean NOT NULL DEFAULT false,
  error text,
  payload jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS api4com_webhook_events_dedupe_idx ON public.api4com_webhook_events (organization_id, dedupe_key);
ALTER TABLE public.api4com_webhook_events ENABLE ROW LEVEL SECURITY;
