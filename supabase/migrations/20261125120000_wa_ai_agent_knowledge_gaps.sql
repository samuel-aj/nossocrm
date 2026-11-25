-- =============================================================================
-- Agentes de IA: dúvidas sem resposta (aprendizado). Tudo aditivo.
-- O agente registra a pergunta que não achou no roteiro nem na base (ferramenta
-- registrar_duvida_sem_resposta); o administrador responde e a resposta vira um
-- trecho extra do documento escolhido (wa_ai_agent_chunks.gap_id).
-- Acesso só pelo servidor (service_role).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.wa_ai_agent_knowledge_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.wa_ai_agents(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ignored', 'included')),
  question text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 300),
  question_key text NOT NULL,
  question_embedding vector(1536),
  embedding_model text,
  context text CHECK (context IS NULL OR char_length(context) <= 800),
  suggested_answer text CHECK (suggested_answer IS NULL OR char_length(suggested_answer) <= 2000),
  answer text CHECK (answer IS NULL OR char_length(answer) <= 4000),
  document_id uuid REFERENCES public.wa_ai_agent_documents(id) ON DELETE SET NULL,
  suggested_document_id uuid REFERENCES public.wa_ai_agent_documents(id) ON DELETE SET NULL,
  occurrences integer NOT NULL DEFAULT 1 CHECK (occurrences >= 1),
  test_only boolean NOT NULL DEFAULT false,
  last_source_key text,
  last_conversation_id uuid REFERENCES public.wa_conversations(id) ON DELETE SET NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wa_ai_agent_knowledge_gaps_included_answer CHECK (status <> 'included' OR answer IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS wa_ai_agent_knowledge_gaps_list_idx
  ON public.wa_ai_agent_knowledge_gaps (organization_id, agent_id, status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS wa_ai_agent_knowledge_gaps_key_idx
  ON public.wa_ai_agent_knowledge_gaps (agent_id, question_key);
CREATE INDEX IF NOT EXISTS wa_ai_agent_knowledge_gaps_document_idx
  ON public.wa_ai_agent_knowledge_gaps (document_id) WHERE document_id IS NOT NULL;

ALTER TABLE public.wa_ai_agent_knowledge_gaps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wa_ai_agent_knowledge_gaps FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_ai_agent_knowledge_gaps TO service_role;

-- Resposta incluída = trecho extra do documento, apagado junto com a dúvida
ALTER TABLE public.wa_ai_agent_chunks ADD COLUMN IF NOT EXISTS gap_id uuid REFERENCES public.wa_ai_agent_knowledge_gaps(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS wa_ai_agent_chunks_gap_idx ON public.wa_ai_agent_chunks (gap_id) WHERE gap_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Registro atômico: soma uma ocorrência à dúvida de mesmo texto ou de mesmo
-- sentido (embedding acima do limite, no mesmo modelo) ou cria uma dúvida aberta.
-- A mesma origem (conversa ou sessão de teste) conta uma vez a cada 24 h.
-- Devolve vazio quando o agente já tem p_open_limit dúvidas abertas.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wa_ai_record_knowledge_gap(
  p_org uuid,
  p_agent uuid,
  p_question text,
  p_question_key text,
  p_embedding vector(1536),
  p_model text,
  p_threshold double precision,
  p_context text,
  p_suggested_answer text,
  p_suggested_document uuid,
  p_source_key text,
  p_conversation uuid,
  p_test boolean,
  p_open_limit integer DEFAULT 200
)
RETURNS TABLE (gap_id uuid, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_match uuid;
  v_document uuid;
  v_conversation uuid;
  v_open integer;
  v_id uuid;
BEGIN
  IF p_org IS NULL OR p_agent IS NULL OR COALESCE(btrim(p_question), '') = '' OR COALESCE(p_question_key, '') = '' THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wa_ai_agents a WHERE a.id = p_agent AND a.organization_id = p_org) THEN
    RETURN;
  END IF;

  -- Uma gravação por vez por agente: duas perguntas iguais ao mesmo tempo não viram duas linhas
  PERFORM pg_advisory_xact_lock(hashtextextended('wa_ai_knowledge_gap:' || p_agent::text, 0));

  -- Só referências do mesmo agente e da mesma organização
  SELECT d.id INTO v_document FROM public.wa_ai_agent_documents d
   WHERE d.id = p_suggested_document AND d.organization_id = p_org AND d.agent_id = p_agent;
  SELECT c.id INTO v_conversation FROM public.wa_conversations c
   WHERE c.id = p_conversation AND c.organization_id = p_org;

  SELECT g.id INTO v_match FROM public.wa_ai_agent_knowledge_gaps g
   WHERE g.organization_id = p_org AND g.agent_id = p_agent AND g.question_key = p_question_key
   ORDER BY g.last_seen_at DESC
   LIMIT 1;

  IF v_match IS NULL AND p_embedding IS NOT NULL AND p_model IS NOT NULL AND p_threshold IS NOT NULL THEN
    SELECT g.id INTO v_match FROM public.wa_ai_agent_knowledge_gaps g
     WHERE g.organization_id = p_org AND g.agent_id = p_agent
       AND g.question_embedding IS NOT NULL AND g.embedding_model = p_model
       AND 1 - (g.question_embedding <=> p_embedding) >= p_threshold
     ORDER BY g.question_embedding <=> p_embedding
     LIMIT 1;
  END IF;

  IF v_match IS NOT NULL THEN
    UPDATE public.wa_ai_agent_knowledge_gaps g SET
      occurrences = g.occurrences + CASE
        WHEN g.last_source_key IS DISTINCT FROM p_source_key OR g.last_seen_at < now() - interval '24 hours' THEN 1
        ELSE 0
      END,
      last_seen_at = now(),
      last_source_key = p_source_key,
      last_conversation_id = COALESCE(v_conversation, g.last_conversation_id),
      test_only = g.test_only AND COALESCE(p_test, false),
      suggested_document_id = COALESCE(v_document, g.suggested_document_id),
      context = COALESCE(left(p_context, 800), g.context),
      suggested_answer = COALESCE(left(p_suggested_answer, 2000), g.suggested_answer),
      updated_at = now()
    WHERE g.id = v_match;
    RETURN QUERY SELECT v_match, false;
    RETURN;
  END IF;

  SELECT count(*) INTO v_open FROM public.wa_ai_agent_knowledge_gaps g
   WHERE g.organization_id = p_org AND g.agent_id = p_agent AND g.status = 'open';
  IF v_open >= GREATEST(COALESCE(p_open_limit, 200), 1) THEN
    RETURN;
  END IF;

  INSERT INTO public.wa_ai_agent_knowledge_gaps AS g (
    organization_id, agent_id, question, question_key, question_embedding, embedding_model,
    context, suggested_answer, suggested_document_id, last_source_key, last_conversation_id, test_only
  ) VALUES (
    p_org, p_agent, left(btrim(p_question), 300), p_question_key, p_embedding,
    CASE WHEN p_embedding IS NULL THEN NULL ELSE p_model END,
    left(p_context, 800), left(p_suggested_answer, 2000), v_document, p_source_key, v_conversation, COALESCE(p_test, false)
  )
  RETURNING g.id INTO v_id;
  RETURN QUERY SELECT v_id, true;
END;
$$;
REVOKE ALL ON FUNCTION public.wa_ai_record_knowledge_gap(uuid, uuid, text, text, vector, text, double precision, text, text, uuid, text, uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_ai_record_knowledge_gap(uuid, uuid, text, text, vector, text, double precision, text, text, uuid, text, uuid, boolean, integer) TO service_role;
