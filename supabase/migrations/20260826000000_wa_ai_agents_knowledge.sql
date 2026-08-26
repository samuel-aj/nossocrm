-- =============================================================================
-- Agentes de IA (beta): base de conhecimento (documentos + busca vetorial/texto),
-- mídias que o agente envia, agentes auxiliares e ferramentas. Tudo aditivo.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE public.wa_ai_agents
  -- agentes que este agente pode consultar durante a conversa (ferramenta consultar_agente)
  ADD COLUMN IF NOT EXISTS helper_agent_ids UUID[] NOT NULL DEFAULT '{}',
  -- ferramentas ligadas: { "calculator": true }
  ADD COLUMN IF NOT EXISTS tools JSONB NOT NULL DEFAULT '{"calculator":true}'::jsonb;

-- Documentos da base de conhecimento
CREATE TABLE IF NOT EXISTS public.wa_ai_agent_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.wa_ai_agents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'error')),
  error TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_ai_agent_documents_agent_idx ON public.wa_ai_agent_documents(agent_id, created_at DESC);
ALTER TABLE public.wa_ai_agent_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wa_ai_agent_documents admin select" ON public.wa_ai_agent_documents;
CREATE POLICY "wa_ai_agent_documents admin select" ON public.wa_ai_agent_documents
  FOR SELECT USING (organization_id IN (SELECT public.user_admin_org_ids(auth.uid())));

-- Trechos (chunks) com busca por texto (tsvector) e por vetor (embedding 1536)
CREATE TABLE IF NOT EXISTS public.wa_ai_agent_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.wa_ai_agents(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.wa_ai_agent_documents(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', content)) STORED,
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_ai_agent_chunks_agent_idx ON public.wa_ai_agent_chunks(agent_id);
CREATE INDEX IF NOT EXISTS wa_ai_agent_chunks_doc_idx ON public.wa_ai_agent_chunks(document_id, idx);
CREATE INDEX IF NOT EXISTS wa_ai_agent_chunks_tsv_idx ON public.wa_ai_agent_chunks USING GIN (tsv);
CREATE INDEX IF NOT EXISTS wa_ai_agent_chunks_embedding_idx ON public.wa_ai_agent_chunks USING hnsw (embedding vector_cosine_ops);
ALTER TABLE public.wa_ai_agent_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wa_ai_agent_chunks admin select" ON public.wa_ai_agent_chunks;
CREATE POLICY "wa_ai_agent_chunks admin select" ON public.wa_ai_agent_chunks
  FOR SELECT USING (organization_id IN (SELECT public.user_admin_org_ids(auth.uid())));

-- Mídias que o agente pode enviar (ferramenta enviar_midia)
CREATE TABLE IF NOT EXISTS public.wa_ai_agent_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.wa_ai_agents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'document')),
  mime TEXT,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_ai_agent_media_agent_idx ON public.wa_ai_agent_media(agent_id, created_at);
ALTER TABLE public.wa_ai_agent_media ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wa_ai_agent_media admin select" ON public.wa_ai_agent_media;
CREATE POLICY "wa_ai_agent_media admin select" ON public.wa_ai_agent_media
  FOR SELECT USING (organization_id IN (SELECT public.user_admin_org_ids(auth.uid())));

-- Bucket PRIVADO dos arquivos dos agentes (documentos e mídias); acesso só pelo servidor
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('wa-agent-files', 'wa-agent-files', false, 52428800)
ON CONFLICT (id) DO NOTHING;

-- Busca vetorial (cosseno) nos trechos de um agente
CREATE OR REPLACE FUNCTION public.wa_ai_match_chunks(p_agent UUID, p_embedding vector(1536), p_limit INTEGER DEFAULT 5)
RETURNS TABLE (id UUID, document_id UUID, idx INTEGER, content TEXT, similarity DOUBLE PRECISION)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.document_id, c.idx, c.content, 1 - (c.embedding <=> p_embedding) AS similarity
  FROM public.wa_ai_agent_chunks c
  JOIN public.wa_ai_agent_documents d ON d.id = c.document_id AND d.status = 'ready'
  WHERE c.agent_id = p_agent AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> p_embedding
  LIMIT GREATEST(1, LEAST(p_limit, 20));
$$;

-- Busca por texto (FTS em português; se nada casar, ILIKE nas palavras)
CREATE OR REPLACE FUNCTION public.wa_ai_search_chunks(p_agent UUID, p_query TEXT, p_limit INTEGER DEFAULT 5)
RETURNS TABLE (id UUID, document_id UUID, idx INTEGER, content TEXT, rank DOUBLE PRECISION)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE q tsquery; lim INTEGER := GREATEST(1, LEAST(p_limit, 20)); w TEXT; pattern TEXT;
BEGIN
  q := plainto_tsquery('portuguese', COALESCE(p_query, ''));
  IF q <> ''::tsquery THEN
    RETURN QUERY
      SELECT c.id, c.document_id, c.idx, c.content, ts_rank(c.tsv, q)::DOUBLE PRECISION
      FROM public.wa_ai_agent_chunks c
      JOIN public.wa_ai_agent_documents d ON d.id = c.document_id AND d.status = 'ready'
      WHERE c.agent_id = p_agent AND c.tsv @@ q
      ORDER BY ts_rank(c.tsv, q) DESC
      LIMIT lim;
    IF FOUND THEN RETURN; END IF;
  END IF;
  -- reserva: qualquer palavra com 4+ letras
  FOR w IN SELECT unnest(regexp_split_to_array(lower(COALESCE(p_query, '')), '\s+')) LOOP
    IF length(w) >= 4 THEN pattern := COALESCE(pattern || '|', '') || regexp_replace(w, '[^a-z0-9à-ú]', '', 'g'); END IF;
  END LOOP;
  IF pattern IS NULL OR pattern = '' THEN RETURN; END IF;
  RETURN QUERY
    SELECT c.id, c.document_id, c.idx, c.content, 0.1::DOUBLE PRECISION
    FROM public.wa_ai_agent_chunks c
    JOIN public.wa_ai_agent_documents d ON d.id = c.document_id AND d.status = 'ready'
    WHERE c.agent_id = p_agent AND lower(c.content) ~ pattern
    ORDER BY c.idx
    LIMIT lim;
END;
$$;

-- =============================================================================
-- Correções da revisão (rodada 3). Idempotente: CREATE OR REPLACE, IF NOT EXISTS,
-- REVOKE/GRANT. As RPCs SECURITY DEFINER passam a ser chamadas só pelo servidor
-- (service_role) e a filtrar por organização; a reserva da busca por texto não
-- gera alternativa vazia; embeddings guardam o modelo usado; a trava tem teto e
-- escopo por org; wa_agents_call_app só chama caminhos fixos; beta desligada
-- devolve o comportamento antigo no gatilho de estado; ingest só chama o app em
-- conversa ativa; uso de tokens por org para o orçamento diário.
-- =============================================================================

-- Procedência do embedding (modelo usado) por trecho e por documento
ALTER TABLE public.wa_ai_agent_chunks ADD COLUMN IF NOT EXISTS embedding_model TEXT;
ALTER TABLE public.wa_ai_agent_documents ADD COLUMN IF NOT EXISTS embedding_model TEXT;
-- Cópia da mídia no bucket wa-media (feita uma vez pelo Storage e reutilizada nos envios)
ALTER TABLE public.wa_ai_agent_media ADD COLUMN IF NOT EXISTS outbox_path TEXT;

-- -----------------------------------------------------------------------------
-- Busca vetorial: escopo por org, só trechos do mesmo modelo de embedding
-- (embedding_model NULL = trechos indexados antes desta coluna; reprocesse os documentos)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wa_ai_match_chunks(
  p_org UUID, p_agent UUID, p_embedding vector(1536), p_limit INTEGER DEFAULT 5, p_model TEXT DEFAULT NULL
)
RETURNS TABLE (id UUID, document_id UUID, idx INTEGER, content TEXT, similarity DOUBLE PRECISION)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.document_id, c.idx, c.content, 1 - (c.embedding <=> p_embedding) AS similarity
  FROM public.wa_ai_agent_chunks c
  JOIN public.wa_ai_agent_documents d
    ON d.id = c.document_id AND d.organization_id = p_org AND d.status = 'ready'
  WHERE c.organization_id = p_org AND c.agent_id = p_agent AND c.embedding IS NOT NULL
    AND (p_model IS NULL OR c.embedding_model IS NULL OR c.embedding_model = p_model)
  ORDER BY c.embedding <=> p_embedding
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 5), 20));
$$;
REVOKE ALL ON FUNCTION public.wa_ai_match_chunks(uuid, uuid, vector, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_ai_match_chunks(uuid, uuid, vector, integer, text) TO service_role;

-- Assinatura antiga (sem org): só o servidor pode chamar; delega com a org do agente.
-- Mantida para o código já publicado até o deploy desta rodada.
CREATE OR REPLACE FUNCTION public.wa_ai_match_chunks(p_agent UUID, p_embedding vector(1536), p_limit INTEGER DEFAULT 5)
RETURNS TABLE (id UUID, document_id UUID, idx INTEGER, content TEXT, similarity DOUBLE PRECISION)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, m.document_id, m.idx, m.content, m.similarity
  FROM public.wa_ai_agents a
  CROSS JOIN LATERAL public.wa_ai_match_chunks(a.organization_id, a.id, p_embedding, p_limit, NULL) m
  WHERE a.id = p_agent;
$$;
REVOKE ALL ON FUNCTION public.wa_ai_match_chunks(uuid, vector, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_ai_match_chunks(uuid, vector, integer) TO service_role;

-- -----------------------------------------------------------------------------
-- Busca por texto: escopo por org; reserva por palavra INTEIRA com 4+ letras/dígitos
-- depois de limpa (emojis e pontuação não viram alternativa vazia no padrão)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wa_ai_search_chunks(p_org UUID, p_agent UUID, p_query TEXT, p_limit INTEGER DEFAULT 5)
RETURNS TABLE (id UUID, document_id UUID, idx INTEGER, content TEXT, rank DOUBLE PRECISION)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE q tsquery; lim INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 5), 20)); w TEXT; pattern TEXT;
BEGIN
  q := plainto_tsquery('portuguese', COALESCE(p_query, ''));
  IF q <> ''::tsquery THEN
    RETURN QUERY
      SELECT c.id, c.document_id, c.idx, c.content, ts_rank(c.tsv, q)::DOUBLE PRECISION
      FROM public.wa_ai_agent_chunks c
      JOIN public.wa_ai_agent_documents d
        ON d.id = c.document_id AND d.organization_id = p_org AND d.status = 'ready'
      WHERE c.organization_id = p_org AND c.agent_id = p_agent AND c.tsv @@ q
      ORDER BY ts_rank(c.tsv, q) DESC
      LIMIT lim;
    IF FOUND THEN RETURN; END IF;
  END IF;
  -- reserva: palavras limpas (só letras/dígitos) com 4+ caracteres, casadas como palavra inteira
  FOR w IN SELECT unnest(regexp_split_to_array(lower(COALESCE(p_query, '')), '\s+')) LOOP
    w := regexp_replace(w, '[^a-z0-9à-ú]', '', 'g');
    IF length(w) >= 4 THEN
      pattern := COALESCE(pattern || '|', '') || '\m' || w || '\M';
    END IF;
  END LOOP;
  IF pattern IS NULL OR pattern = '' THEN RETURN; END IF;
  RETURN QUERY
    SELECT c.id, c.document_id, c.idx, c.content, 0.1::DOUBLE PRECISION
    FROM public.wa_ai_agent_chunks c
    JOIN public.wa_ai_agent_documents d
      ON d.id = c.document_id AND d.organization_id = p_org AND d.status = 'ready'
    WHERE c.organization_id = p_org AND c.agent_id = p_agent AND lower(c.content) ~ pattern
    ORDER BY c.idx
    LIMIT lim;
END;
$$;
REVOKE ALL ON FUNCTION public.wa_ai_search_chunks(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_ai_search_chunks(uuid, uuid, text, integer) TO service_role;

-- Assinatura antiga (sem org): só o servidor; delega com a org do agente
CREATE OR REPLACE FUNCTION public.wa_ai_search_chunks(p_agent UUID, p_query TEXT, p_limit INTEGER DEFAULT 5)
RETURNS TABLE (id UUID, document_id UUID, idx INTEGER, content TEXT, rank DOUBLE PRECISION)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.document_id, s.idx, s.content, s.rank
  FROM public.wa_ai_agents a
  CROSS JOIN LATERAL public.wa_ai_search_chunks(a.organization_id, a.id, p_query, p_limit) s
  WHERE a.id = p_agent;
$$;
REVOKE ALL ON FUNCTION public.wa_ai_search_chunks(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_ai_search_chunks(uuid, text, integer) TO service_role;

-- -----------------------------------------------------------------------------
-- Trava de execução por conversa: escopo por org e teto de 900 s
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wa_ai_claim_lock(p_org UUID, p_conversation UUID, p_seconds INTEGER DEFAULT 90)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INTEGER; secs INTEGER := LEAST(GREATEST(COALESCE(p_seconds, 90), 1), 900);
BEGIN
  UPDATE public.wa_conversations
    SET ai_lock_until = now() + make_interval(secs => secs)
  WHERE id = p_conversation AND organization_id = p_org
    AND (ai_lock_until IS NULL OR ai_lock_until < now());
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.wa_ai_claim_lock(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_ai_claim_lock(uuid, uuid, integer) TO service_role;

-- Assinatura antiga (sem org): só o servidor; teto aplicado; org lida da conversa
CREATE OR REPLACE FUNCTION public.wa_ai_claim_lock(p_conversation UUID, p_seconds INTEGER DEFAULT 90)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org UUID;
BEGIN
  SELECT organization_id INTO org FROM public.wa_conversations WHERE id = p_conversation;
  IF org IS NULL THEN RETURN false; END IF;
  RETURN public.wa_ai_claim_lock(org, p_conversation, p_seconds);
END;
$$;
REVOKE ALL ON FUNCTION public.wa_ai_claim_lock(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_ai_claim_lock(uuid, integer) TO service_role;

-- -----------------------------------------------------------------------------
-- O banco chama o CRM: só caminhos fixos e só de dentro do banco (nada pelo PostgREST)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wa_agents_call_app(p_path TEXT, p_body JSONB DEFAULT '{}'::jsonb)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE base TEXT; secret TEXT; req BIGINT;
BEGIN
  -- Lista fixa: p_path livre permitiria exfiltrar o segredo ou forjar chamadas ao CRM
  IF p_path IS NULL OR p_path NOT IN ('/api/wa-agents/ingest', '/api/wa-agents/tick') THEN
    RAISE WARNING 'wa_agents_call_app: caminho não permitido (%)', p_path;
    RETURN NULL;
  END IF;
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
REVOKE ALL ON FUNCTION public.wa_agents_call_app(text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.wa_agents_beta_enabled(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_agents_beta_enabled(uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- Uso de tokens da org (orçamento diário no motor): soma usage.totalTokens desde p_since
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wa_ai_agent_usage_tokens(p_org UUID, p_since TIMESTAMPTZ)
RETURNS BIGINT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM((r.usage->>'totalTokens')::numeric), 0)::bigint
  FROM public.wa_ai_agent_runs r
  WHERE r.organization_id = p_org
    AND r.created_at >= p_since
    AND r.usage IS NOT NULL
    AND (r.usage->>'totalTokens') ~ '^[0-9]+(\.[0-9]+)?$';
$$;
REVOKE ALL ON FUNCTION public.wa_ai_agent_usage_tokens(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_ai_agent_usage_tokens(uuid, timestamptz) TO service_role;

-- -----------------------------------------------------------------------------
-- Estado do agente quando alguém ENVIA: com a beta desligada, conversas que ainda
-- carregam ai_agent_id seguem o comportamento original (agente externo via API)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wa_ai_agent_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st TEXT; ag UUID; cur_resume TIMESTAMPTZ; pause_min INTEGER; lock_until TIMESTAMPTZ;
BEGIN
  IF NEW.direction <> 'out' THEN RETURN NEW; END IF;
  SELECT ai_status, ai_agent_id, ai_resume_at, ai_lock_until INTO st, ag, cur_resume, lock_until
    FROM public.wa_conversations WHERE id = NEW.conversation_id;

  -- Beta desligada: o agente nativo não conta
  IF ag IS NOT NULL AND NOT public.wa_agents_beta_enabled(NEW.organization_id) THEN ag := NULL; END IF;

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

  -- Agente NATIVO (beta): eco do envio do PRÓPRIO agente (trava ativa) não muda estado
  IF NEW.source = 'echo' AND lock_until IS NOT NULL AND lock_until > now() THEN
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

-- -----------------------------------------------------------------------------
-- Mensagem RECEBIDA -> ingest: conversa com agente nativo só chama o app quando está
-- ativa (parada, pausada ou aguardando aprovação não gera invocação nem execução 'skipped')
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
    should := COALESCE(conv.ai_status, 'active') = 'active';
  ELSIF conv.ai_status IS NULL AND conv.connection_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.wa_ai_agents a
    WHERE a.organization_id = NEW.organization_id AND a.enabled = true AND conv.connection_id = ANY(a.connection_ids)
      AND COALESCE(a.triggers->'inbound'->>'mode', 'any') <> 'none'
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
