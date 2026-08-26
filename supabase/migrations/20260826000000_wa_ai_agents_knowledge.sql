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
