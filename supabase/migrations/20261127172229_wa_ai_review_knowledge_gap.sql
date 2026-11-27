-- Aplica a revisão e atualiza a base na mesma transação. As chamadas de IA e o
-- preparo do arquivo já terminaram quando o servidor invoca esta função.
CREATE OR REPLACE FUNCTION public.wa_ai_review_knowledge_gap(
  p_org uuid, p_agent uuid, p_gap uuid, p_user uuid, p_action text,
  p_expected_updated_at timestamptz, p_document uuid DEFAULT NULL,
  p_question text DEFAULT NULL, p_question_key text DEFAULT NULL, p_answer text DEFAULT NULL,
  p_embedding vector(1536) DEFAULT NULL, p_model text DEFAULT NULL,
  p_expected_document_model text DEFAULT NULL, p_chunk_limit integer DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  previous record;
  destination record;
  revised record;
  revision_time timestamptz;
BEGIN
  IF p_user IS NULL OR p_action IS NULL OR p_action NOT IN ('include', 'edit', 'remove') THEN
    RAISE EXCEPTION 'Parâmetros de revisão inválidos' USING ERRCODE = '22023';
  END IF;

  -- Revisões do mesmo agente compartilham o limite de trechos, inclusive quando
  -- se referem a dúvidas e documentos diferentes.
  PERFORM 1 FROM public.wa_ai_agents a
   WHERE a.id = p_agent AND a.organization_id = p_org FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;

  SELECT g.status, g.updated_at, g.document_id INTO previous
    FROM public.wa_ai_agent_knowledge_gaps g
   WHERE g.id = p_gap AND g.agent_id = p_agent AND g.organization_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'NOT_FOUND'); END IF;
  IF previous.updated_at IS DISTINCT FROM p_expected_updated_at OR
     previous.status <> (CASE WHEN p_action = 'include' THEN 'open' ELSE 'included' END) THEN
    RETURN jsonb_build_object('code', 'CONFLICT');
  END IF;

  IF p_action = 'remove' THEN p_document := NULL; END IF;
  PERFORM d.id FROM public.wa_ai_agent_documents d
   WHERE d.organization_id = p_org AND d.agent_id = p_agent AND d.id IN (previous.document_id, p_document)
   ORDER BY d.id FOR NO KEY UPDATE;

  -- O reprocessamento já pode ter lido as respostas que vai reindexar.
  IF EXISTS (SELECT 1 FROM public.wa_ai_agent_documents d WHERE d.id = previous.document_id
             AND d.organization_id = p_org AND d.agent_id = p_agent AND d.status = 'processing') THEN
    RETURN jsonb_build_object('code', 'DOCUMENT_NOT_READY');
  END IF;
  IF p_action <> 'remove' THEN
    SELECT d.status, d.embedding_model INTO destination FROM public.wa_ai_agent_documents d
     WHERE d.id = p_document AND d.organization_id = p_org AND d.agent_id = p_agent;
    IF NOT FOUND THEN RETURN jsonb_build_object('code', 'DOCUMENT_NOT_FOUND'); END IF;
    IF destination.status <> 'ready' THEN RETURN jsonb_build_object('code', 'DOCUMENT_NOT_READY'); END IF;
    IF destination.embedding_model IS DISTINCT FROM p_expected_document_model THEN
      RETURN jsonb_build_object('code', 'CONFLICT');
    END IF;
    IF nullif(btrim(p_question), '') IS NULL OR nullif(btrim(p_question_key), '') IS NULL OR
       nullif(btrim(p_answer), '') IS NULL OR (p_embedding IS NOT NULL AND nullif(btrim(p_model), '') IS NULL) THEN
      RAISE EXCEPTION 'Conteúdo de revisão inválido' USING ERRCODE = '22023';
    END IF;
    -- O limite do editor soma os trechos dos documentos prontos. Mover ou
    -- substituir um trecho já contabilizado não consome outra vaga.
    IF NOT EXISTS (SELECT 1 FROM public.wa_ai_agent_chunks c
                   JOIN public.wa_ai_agent_documents d ON d.id = c.document_id
                   WHERE c.gap_id = p_gap AND c.organization_id = p_org AND c.agent_id = p_agent
                     AND d.organization_id = p_org AND d.agent_id = p_agent AND d.status = 'ready')
       AND (SELECT coalesce(sum(d.chunk_count), 0) FROM public.wa_ai_agent_documents d
            WHERE d.organization_id = p_org AND d.agent_id = p_agent AND d.status = 'ready') >= coalesce(p_chunk_limit, 5000) THEN
      RETURN jsonb_build_object('code', 'CHUNK_LIMIT');
    END IF;
  END IF;

  DELETE FROM public.wa_ai_agent_chunks c
   WHERE c.organization_id = p_org AND c.agent_id = p_agent AND c.gap_id = p_gap;
  IF p_action <> 'remove' THEN
    INSERT INTO public.wa_ai_agent_chunks
      (organization_id, agent_id, document_id, gap_id, idx, content, embedding, embedding_model)
    VALUES (p_org, p_agent, p_document, p_gap, 100000,
            'Pergunta: ' || btrim(p_question) || chr(10) || 'Resposta: ' || btrim(p_answer),
            p_embedding, CASE WHEN p_embedding IS NOT NULL THEN p_model END);
  END IF;

  revision_time := greatest(clock_timestamp(), previous.updated_at + interval '1 microsecond');
  UPDATE public.wa_ai_agent_knowledge_gaps g SET
    status = CASE WHEN p_action = 'remove' THEN 'ignored' ELSE 'included' END,
    document_id = p_document,
    question = CASE WHEN p_action = 'remove' THEN g.question ELSE p_question END,
    question_key = CASE WHEN p_action = 'remove' THEN g.question_key ELSE p_question_key END,
    answer = CASE WHEN p_action = 'remove' THEN g.answer ELSE p_answer END,
    reviewed_by = CASE WHEN p_action = 'remove' THEN g.reviewed_by ELSE p_user END,
    reviewed_at = CASE WHEN p_action = 'remove' THEN g.reviewed_at ELSE revision_time END,
    updated_at = revision_time
   WHERE g.id = p_gap AND g.organization_id = p_org AND g.agent_id = p_agent
   RETURNING g.id, g.organization_id, g.agent_id, g.status, g.question, g.context, g.suggested_answer,
             g.answer, g.document_id, g.suggested_document_id, g.occurrences, g.test_only, g.last_conversation_id,
             g.first_seen_at, g.last_seen_at, g.reviewed_by, g.reviewed_at, g.created_at, g.updated_at INTO revised;

  UPDATE public.wa_ai_agent_documents d
     SET chunk_count = (SELECT count(*) FROM public.wa_ai_agent_chunks c WHERE c.document_id = d.id
                        AND c.organization_id = p_org AND c.agent_id = p_agent), updated_at = revision_time
   WHERE d.organization_id = p_org AND d.agent_id = p_agent AND d.id IN (previous.document_id, p_document);
  RETURN jsonb_build_object('gap', to_jsonb(revised));
END;
$$;

REVOKE ALL ON FUNCTION public.wa_ai_review_knowledge_gap(uuid, uuid, uuid, uuid, text, timestamptz, uuid, text, text, text, vector, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_ai_review_knowledge_gap(uuid, uuid, uuid, uuid, text, timestamptz, uuid, text, text, text, vector, text, text, integer) TO service_role;
