-- =============================================================================
-- Agentes de IA e Robôs de atendimento NATIVOS (versão BETA por organização)
-- =============================================================================
-- Tudo aqui é ADITIVO. A chave beta é a linha ai_feature_flags(key='wa_agents_beta',
-- enabled=true) da organização. Sem ela, nenhum gatilho novo faz nada e o
-- comportamento atual (agente externo via API pública + pausa manual) fica igual.
--
-- Peças:
--   wa_ai_agents        catálogo de agentes (modelo fixo por agente, roteiro, esteira)
--   wa_ai_agent_runs    histórico de execuções (entrada, resposta, custo, erro)
--   wa_bots / wa_bot_runs  robô de mensagens predefinidas (sem IA) e suas execuções
--   wa_conversations.*  estado do agente na conversa (agente atual, pausa temporária,
--                       trava de execução, aprovação humana pendente)
--   wa_agents_call_app  o banco chama o CRM (pg_net) usando platform_config:
--                       'wa_agents_app_url' e 'wa_agents_internal_secret'
--   trg_wa_ai_agent_ingest  mensagem recebida -> POST /api/wa-agents/ingest
--   trg_wa_bot_on_deal      negócio criado/mudou de etapa -> cria execução do robô
--   cron wa-agents-tick     a cada 30 s (só se houver algo pendente) -> /api/wa-agents/tick
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- -----------------------------------------------------------------------------
-- 1. Agentes
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wa_ai_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  persona_name TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  -- números (wa_connections) em que este agente é o PONTO DE ENTRADA de conversas novas
  connection_ids UUID[] NOT NULL DEFAULT '{}',
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'google')),
  model TEXT NOT NULL,
  temperature NUMERIC(3,2) NOT NULL DEFAULT 0.5 CHECK (temperature >= 0 AND temperature <= 2),
  -- chave própria (opcional); vazio = usa a chave da org em organization_settings
  api_key TEXT,
  system_prompt TEXT NOT NULL DEFAULT '',
  buffer_seconds INTEGER NOT NULL DEFAULT 10 CHECK (buffer_seconds BETWEEN 0 AND 60),
  history_limit INTEGER NOT NULL DEFAULT 40 CHECK (history_limit BETWEEN 5 AND 200),
  line_delay_ms INTEGER NOT NULL DEFAULT 1500 CHECK (line_delay_ms BETWEEN 0 AND 10000),
  -- humano respondeu: pausa por N minutos e retoma sozinho (0 = só retoma manualmente)
  human_pause_minutes INTEGER NOT NULL DEFAULT 30 CHECK (human_pause_minutes BETWEEN 0 AND 1440),
  only_new_conversations BOOLEAN NOT NULL DEFAULT false,
  -- resultados possíveis do encerramento e as ações de cada um (esteira)
  -- [{ key, label, description, actions: [{ type, ... }] }]
  outcomes JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- webhooks por evento: [{ id, event, url, secret, body_template, active }]
  webhooks JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_ai_agents_org_idx ON public.wa_ai_agents(organization_id);
CREATE INDEX IF NOT EXISTS wa_ai_agents_conn_gin ON public.wa_ai_agents USING GIN (connection_ids);
ALTER TABLE public.wa_ai_agents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wa_ai_agents admin select" ON public.wa_ai_agents;
CREATE POLICY "wa_ai_agents admin select" ON public.wa_ai_agents
  FOR SELECT USING (organization_id IN (SELECT public.user_admin_org_ids(auth.uid())));
-- escrita: só service role (rotas /api/wa-agents/*)

-- -----------------------------------------------------------------------------
-- 2. Execuções dos agentes
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wa_ai_agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES public.wa_ai_agents(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.wa_conversations(id) ON DELETE CASCADE,
  -- inbound | resume | manual_start | handoff | approval | bot | test
  trigger TEXT NOT NULL,
  -- ok | skipped | error
  status TEXT NOT NULL,
  reason TEXT,
  input_text TEXT,
  output_text TEXT,
  tool_calls JSONB NOT NULL DEFAULT '[]'::jsonb,
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  usage JSONB,
  model TEXT,
  duration_ms INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_ai_agent_runs_org_created_idx ON public.wa_ai_agent_runs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wa_ai_agent_runs_conv_idx ON public.wa_ai_agent_runs(conversation_id, created_at DESC);
ALTER TABLE public.wa_ai_agent_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wa_ai_agent_runs admin select" ON public.wa_ai_agent_runs;
CREATE POLICY "wa_ai_agent_runs admin select" ON public.wa_ai_agent_runs
  FOR SELECT USING (organization_id IN (SELECT public.user_admin_org_ids(auth.uid())));

-- -----------------------------------------------------------------------------
-- 3. Robôs (mensagens predefinidas, sem IA)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wa_bots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  -- número que envia as mensagens do robô
  connection_id UUID REFERENCES public.wa_connections(id) ON DELETE SET NULL,
  -- { type: 'deal_created' | 'deal_stage_entered' | 'manual', board_id?, stage_id? }
  trigger JSONB NOT NULL DEFAULT '{"type":"manual"}'::jsonb,
  -- passos: [{ id, type: 'send_text'|'wait'|'wait_reply'|'condition'|'move_stage'|'add_tag'|'handoff_agent'|'end', ... }]
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_bots_org_idx ON public.wa_bots(organization_id);
ALTER TABLE public.wa_bots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wa_bots admin select" ON public.wa_bots;
CREATE POLICY "wa_bots admin select" ON public.wa_bots
  FOR SELECT USING (organization_id IN (SELECT public.user_admin_org_ids(auth.uid())));

CREATE TABLE IF NOT EXISTS public.wa_bot_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bot_id UUID NOT NULL REFERENCES public.wa_bots(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.wa_conversations(id) ON DELETE SET NULL,
  phone TEXT,
  step_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'waiting_reply', 'done', 'error', 'cancelled')),
  wake_at TIMESTAMPTZ,
  lock_until TIMESTAMPTZ,
  vars JSONB NOT NULL DEFAULT '{}'::jsonb,
  log JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_bot_runs_due_idx ON public.wa_bot_runs(wake_at) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS wa_bot_runs_waiting_idx ON public.wa_bot_runs(conversation_id) WHERE status = 'waiting_reply';
CREATE INDEX IF NOT EXISTS wa_bot_runs_org_created_idx ON public.wa_bot_runs(organization_id, created_at DESC);
ALTER TABLE public.wa_bot_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wa_bot_runs admin select" ON public.wa_bot_runs;
CREATE POLICY "wa_bot_runs admin select" ON public.wa_bot_runs
  FOR SELECT USING (organization_id IN (SELECT public.user_admin_org_ids(auth.uid())));

-- -----------------------------------------------------------------------------
-- 4. Estado do agente na conversa
-- -----------------------------------------------------------------------------
ALTER TABLE public.wa_conversations
  ADD COLUMN IF NOT EXISTS ai_agent_id UUID REFERENCES public.wa_ai_agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ai_resume_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_state JSONB,
  ADD COLUMN IF NOT EXISTS ai_last_processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_lock_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_approval JSONB;

-- ai_status ganha 'stopped' (parado de vez) e 'awaiting_approval' (aguardando humano aprovar a passagem)
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.wa_conversations'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%ai_status%'
  LOOP
    EXECUTE format('ALTER TABLE public.wa_conversations DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.wa_conversations
  ADD CONSTRAINT wa_conversations_ai_status_check
  CHECK (ai_status IS NULL OR ai_status IN ('active', 'paused', 'stopped', 'awaiting_approval'));

CREATE INDEX IF NOT EXISTS wa_conversations_ai_resume_idx
  ON public.wa_conversations(ai_resume_at) WHERE ai_status = 'paused' AND ai_resume_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS wa_conversations_ai_agent_idx
  ON public.wa_conversations(ai_agent_id) WHERE ai_agent_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 5. Helpers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wa_agents_beta_enabled(p_org UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ai_feature_flags f
    WHERE f.organization_id = p_org AND f.key = 'wa_agents_beta' AND f.enabled = true
  );
$$;

-- O banco chama o CRM. URL e segredo ficam em platform_config (por ambiente):
--   ('wa_agents_app_url', 'https://crm.anunciojuridico.com.br')
--   ('wa_agents_internal_secret', '<mesmo valor do CRON_SECRET da Vercel>')
CREATE OR REPLACE FUNCTION public.wa_agents_call_app(p_path TEXT, p_body JSONB DEFAULT '{}'::jsonb)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE base TEXT; secret TEXT; req BIGINT;
BEGIN
  SELECT value INTO base FROM public.platform_config WHERE key = 'wa_agents_app_url';
  SELECT value INTO secret FROM public.platform_config WHERE key = 'wa_agents_internal_secret';
  IF base IS NULL OR secret IS NULL OR base = '' OR secret = '' THEN RETURN NULL; END IF;
  SELECT net.http_post(
    url := rtrim(base, '/') || p_path,
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Internal-Secret', secret),
    body := COALESCE(p_body, '{}'::jsonb),
    timeout_milliseconds := 20000
  ) INTO req;
  RETURN req;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'wa_agents_call_app falhou: %', SQLERRM;
  RETURN NULL;
END;
$$;

-- Trava de execução por conversa (evita duas respostas ao mesmo tempo)
CREATE OR REPLACE FUNCTION public.wa_ai_claim_lock(p_conversation UUID, p_seconds INTEGER DEFAULT 90)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INTEGER;
BEGIN
  UPDATE public.wa_conversations
    SET ai_lock_until = now() + make_interval(secs => p_seconds)
  WHERE id = p_conversation AND (ai_lock_until IS NULL OR ai_lock_until < now());
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Estado do agente quando alguém ENVIA (recriada; comportamento antigo preservado)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wa_ai_agent_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st TEXT; ag UUID; cur_resume TIMESTAMPTZ; pause_min INTEGER;
BEGIN
  IF NEW.direction <> 'out' THEN RETURN NEW; END IF;
  SELECT ai_status, ai_agent_id, ai_resume_at INTO st, ag, cur_resume
    FROM public.wa_conversations WHERE id = NEW.conversation_id;

  IF ag IS NULL THEN
    -- Comportamento ORIGINAL (agente externo via API pública, ex.: n8n)
    IF NEW.source = 'api' THEN
      IF st IS NULL THEN
        UPDATE public.wa_conversations SET ai_status = 'active', ai_status_changed_at = now() WHERE id = NEW.conversation_id;
      END IF;
    ELSIF NEW.source IN ('crm', 'echo') AND st = 'active' THEN
      UPDATE public.wa_conversations SET ai_status = 'paused', ai_status_changed_at = now(), ai_paused_by = NEW.sent_by WHERE id = NEW.conversation_id;
    END IF;
    RETURN NEW;
  END IF;

  -- Agente NATIVO (beta): humano respondeu -> pausa temporária (ou até retomar, se 0 min)
  IF NEW.source IN ('crm', 'echo') THEN
    SELECT human_pause_minutes INTO pause_min FROM public.wa_ai_agents WHERE id = ag;
    IF st = 'active' THEN
      UPDATE public.wa_conversations
        SET ai_status = 'paused', ai_status_changed_at = now(), ai_paused_by = NEW.sent_by,
            ai_resume_at = CASE WHEN COALESCE(pause_min, 0) > 0 THEN now() + make_interval(mins => pause_min) ELSE NULL END
      WHERE id = NEW.conversation_id;
    ELSIF st = 'paused' AND cur_resume IS NOT NULL AND COALESCE(pause_min, 0) > 0 THEN
      -- humano continua falando durante a pausa: o relógio da retomada reinicia
      UPDATE public.wa_conversations SET ai_resume_at = now() + make_interval(mins => pause_min) WHERE id = NEW.conversation_id;
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'wa_ai_agent_state falhou: %', SQLERRM;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_wa_ai_agent_state ON public.wa_messages;
CREATE TRIGGER trg_wa_ai_agent_state BEFORE INSERT ON public.wa_messages
  FOR EACH ROW EXECUTE FUNCTION public.wa_ai_agent_state();

-- -----------------------------------------------------------------------------
-- 7. Mensagem RECEBIDA -> avisa o CRM (só orgs beta, só quando há agente/robô interessado)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wa_ai_agent_ingest()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE conv RECORD; should BOOLEAN := false;
BEGIN
  IF NEW.direction <> 'in' THEN RETURN NEW; END IF;
  IF NOT public.wa_agents_beta_enabled(NEW.organization_id) THEN RETURN NEW; END IF;

  SELECT id, connection_id, ai_agent_id, ai_status INTO conv
    FROM public.wa_conversations WHERE id = NEW.conversation_id;
  IF conv.id IS NULL THEN RETURN NEW; END IF;

  IF conv.ai_agent_id IS NOT NULL THEN
    should := true;
  ELSIF conv.ai_status IS NULL AND conv.connection_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.wa_ai_agents a
    WHERE a.organization_id = NEW.organization_id AND a.enabled = true AND conv.connection_id = ANY(a.connection_ids)
  ) THEN
    should := true;
  END IF;
  IF NOT should AND EXISTS (
    SELECT 1 FROM public.wa_bot_runs r WHERE r.conversation_id = conv.id AND r.status = 'waiting_reply'
  ) THEN
    should := true;
  END IF;

  IF should THEN
    PERFORM public.wa_agents_call_app(
      '/api/wa-agents/ingest',
      jsonb_build_object('organization_id', NEW.organization_id, 'conversation_id', NEW.conversation_id, 'message_id', NEW.id)
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'wa_ai_agent_ingest falhou: %', SQLERRM;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_wa_ai_agent_ingest ON public.wa_messages;
CREATE TRIGGER trg_wa_ai_agent_ingest AFTER INSERT ON public.wa_messages
  FOR EACH ROW EXECUTE FUNCTION public.wa_ai_agent_ingest();

-- -----------------------------------------------------------------------------
-- 8. Negócio criado / entrou numa etapa -> cria execução do robô
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wa_bot_on_deal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b RECORD; created INTEGER := 0;
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.organization_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN RETURN NEW; END IF;
  IF NOT public.wa_agents_beta_enabled(NEW.organization_id) THEN RETURN NEW; END IF;

  FOR b IN
    SELECT id FROM public.wa_bots
    WHERE organization_id = NEW.organization_id AND enabled = true AND (
      (TG_OP = 'INSERT' AND trigger->>'type' = 'deal_created'
        AND (NULLIF(trigger->>'board_id', '') IS NULL OR (trigger->>'board_id')::uuid = NEW.board_id))
      OR (trigger->>'type' = 'deal_stage_entered' AND NULLIF(trigger->>'stage_id', '') IS NOT NULL
        AND (trigger->>'stage_id')::uuid = NEW.stage_id)
    )
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.wa_bot_runs r
      WHERE r.bot_id = b.id AND r.deal_id = NEW.id AND r.status IN ('running', 'waiting_reply')
    ) THEN
      INSERT INTO public.wa_bot_runs (organization_id, bot_id, deal_id, contact_id, status, wake_at)
      VALUES (NEW.organization_id, b.id, NEW.id, NEW.contact_id, 'running', now());
      created := created + 1;
    END IF;
  END LOOP;

  IF created > 0 THEN
    PERFORM public.wa_agents_call_app('/api/wa-agents/tick', jsonb_build_object('organization_id', NEW.organization_id));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'wa_bot_on_deal falhou: %', SQLERRM;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_wa_bot_on_deal ON public.deals;
CREATE TRIGGER trg_wa_bot_on_deal AFTER INSERT OR UPDATE OF stage_id ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.wa_bot_on_deal();

-- -----------------------------------------------------------------------------
-- 9. Relógio: retomada de pausas e passos do robô (só chama o CRM se houver algo pendente)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'wa-agents-tick';
  PERFORM cron.schedule(
    'wa-agents-tick',
    '30 seconds',
    $cron$
      SELECT public.wa_agents_call_app('/api/wa-agents/tick', '{}'::jsonb)
      WHERE EXISTS (SELECT 1 FROM public.ai_feature_flags WHERE key = 'wa_agents_beta' AND enabled = true)
        AND (
          EXISTS (SELECT 1 FROM public.wa_bot_runs WHERE status = 'running' AND wake_at IS NOT NULL AND wake_at <= now())
          OR EXISTS (SELECT 1 FROM public.wa_conversations WHERE ai_status = 'paused' AND ai_resume_at IS NOT NULL AND ai_resume_at <= now())
        )
    $cron$
  );
END $$;
