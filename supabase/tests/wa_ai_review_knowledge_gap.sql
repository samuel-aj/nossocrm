-- Teste em um banco PostgreSQL descartável e vazio com pgvector instalado:
-- psql -X -v ON_ERROR_STOP=1 -f supabase/tests/wa_ai_review_knowledge_gap.sql
\set ON_ERROR_STOP on
BEGIN;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE TABLE public.organizations (id uuid PRIMARY KEY);
CREATE TABLE public.profiles (id uuid PRIMARY KEY);
CREATE TABLE public.wa_ai_agents (id uuid PRIMARY KEY, organization_id uuid NOT NULL);
CREATE TABLE public.wa_conversations (id uuid PRIMARY KEY, organization_id uuid NOT NULL);
CREATE TABLE public.wa_ai_agent_documents (
  id uuid PRIMARY KEY, agent_id uuid NOT NULL, organization_id uuid NOT NULL,
  status text NOT NULL, chunk_count integer NOT NULL DEFAULT 0, embedding_model text, updated_at timestamptz
);
CREATE TABLE public.wa_ai_agent_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid NOT NULL, organization_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES public.wa_ai_agent_documents, idx integer NOT NULL,
  content text NOT NULL, embedding vector(1536), embedding_model text
);
GRANT SELECT, UPDATE ON public.wa_ai_agents, public.wa_ai_agent_documents TO service_role;
GRANT SELECT, INSERT, DELETE ON public.wa_ai_agent_chunks TO service_role;
\ir ../migrations/20261127171912_wa_ai_agent_knowledge_gaps.sql
\ir ../migrations/20261127172229_wa_ai_review_knowledge_gap.sql

-- Chaves sintéticas para repetir o teste sob o papel do servidor.
CREATE TEMP TABLE fixture AS SELECT gen_random_uuid() AS org, gen_random_uuid() AS other_org,
  gen_random_uuid() AS agent, gen_random_uuid() AS other_agent, gen_random_uuid() AS reviewer,
  gen_random_uuid() AS doc, gen_random_uuid() AS dest, gen_random_uuid() AS foreign_doc,
  gen_random_uuid() AS gap;
INSERT INTO public.organizations SELECT org FROM fixture UNION ALL SELECT other_org FROM fixture;
INSERT INTO public.profiles SELECT reviewer FROM fixture;
INSERT INTO public.wa_ai_agents SELECT agent, org FROM fixture UNION ALL SELECT other_agent, other_org FROM fixture;
INSERT INTO public.wa_ai_agent_documents (id, organization_id, agent_id, status, chunk_count, embedding_model)
  SELECT doc, org, agent, 'ready', 1, NULL FROM fixture UNION ALL
  SELECT dest, org, agent, 'ready', 0, 'modelo-teste' FROM fixture UNION ALL
  SELECT foreign_doc, other_org, other_agent, 'ready', 0, NULL FROM fixture UNION ALL
  SELECT gen_random_uuid(), org, agent, 'error', 100, NULL FROM fixture;
INSERT INTO public.wa_ai_agent_chunks (agent_id, organization_id, document_id, idx, content)
  SELECT agent, org, doc, 0, 'Arquivo original' FROM fixture;
INSERT INTO public.wa_ai_agent_knowledge_gaps (id, organization_id, agent_id, question, question_key)
  SELECT gap, org, agent, 'Pergunta?', 'pergunta' FROM fixture;
GRANT SELECT ON fixture TO service_role;

CREATE FUNCTION pg_temp.check_result(ok boolean, detail text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Falha: %', detail; END IF;
END;
$$;

SET LOCAL ROLE service_role;
DO $test$
DECLARE
  f record;
  version_before timestamptz;
  version_after timestamptz;
  r jsonb;
  test_vector vector(1536) := array_fill(0::real, ARRAY[1536])::vector;
  review oid := 'public.wa_ai_review_knowledge_gap(uuid,uuid,uuid,uuid,text,timestamptz,uuid,text,text,text,vector,text,text,integer)'::regprocedure;
BEGIN
  SELECT * INTO STRICT f FROM fixture;
  PERFORM pg_temp.check_result(has_function_privilege('service_role', review, 'EXECUTE')
    AND NOT has_function_privilege('anon', review, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', review, 'EXECUTE'), 'permissões da função');
  SELECT updated_at INTO version_before FROM public.wa_ai_agent_knowledge_gaps WHERE id = f.gap;

  r := public.wa_ai_review_knowledge_gap(f.other_org, f.agent, f.gap, f.reviewer, 'include', version_before);
  PERFORM pg_temp.check_result(r->>'code' = 'NOT_FOUND', 'agente de outro escritório');
  r := public.wa_ai_review_knowledge_gap(f.org, f.agent, f.gap, f.reviewer, 'include', version_before,
    f.foreign_doc, 'Pergunta?', 'pergunta', 'Resposta');
  PERFORM pg_temp.check_result(r->>'code' = 'DOCUMENT_NOT_FOUND', 'documento de outro escritório');
  r := public.wa_ai_review_knowledge_gap(f.org, f.agent, f.gap, f.reviewer, 'include', version_before,
    f.doc, 'Pergunta?', 'pergunta', 'Resposta', p_chunk_limit => 1);
  PERFORM pg_temp.check_result(r->>'code' = 'CHUNK_LIMIT', 'limite inclui trechos comuns');

  r := public.wa_ai_review_knowledge_gap(f.org, f.agent, f.gap, f.reviewer, 'include', version_before,
    f.doc, 'Pergunta?', 'pergunta', 'Resposta', p_chunk_limit => 2);
  PERFORM pg_temp.check_result(r->'gap'->>'status' = 'included' AND (r->'gap'->>'reviewed_by')::uuid = f.reviewer
    AND NOT (r->'gap' ? 'question_embedding'), 'resposta pública da revisão');
  version_before := (r->'gap'->>'updated_at')::timestamptz;
  PERFORM pg_temp.check_result((SELECT chunk_count = 2 FROM public.wa_ai_agent_documents WHERE id = f.doc), 'contagem da inclusão');
  r := public.wa_ai_review_knowledge_gap(f.org, f.agent, f.gap, f.reviewer, 'edit', version_before,
    f.dest, 'Pergunta?', 'pergunta', 'Nova', test_vector, 'modelo-teste', 'modelo-antigo');
  PERFORM pg_temp.check_result(r->>'code' = 'CONFLICT', 'modelo do destino mudou');

  -- Falha após a substituição do trecho deve desfazer toda a revisão.
  BEGIN
    PERFORM public.wa_ai_review_knowledge_gap(f.org, f.agent, f.gap, gen_random_uuid(), 'edit', version_before,
      f.dest, 'Pergunta?', 'pergunta', 'Descartar', test_vector, 'modelo-teste', 'modelo-teste');
    RAISE EXCEPTION 'Esperava violação da referência do revisor';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  PERFORM pg_temp.check_result((SELECT count(*) = 1 FROM public.wa_ai_agent_chunks
    WHERE gap_id = f.gap AND document_id = f.doc AND content LIKE '%Resposta: Resposta'), 'erro preserva trecho anterior');
  PERFORM pg_temp.check_result((SELECT updated_at = version_before AND answer = 'Resposta'
    FROM public.wa_ai_agent_knowledge_gaps WHERE id = f.gap), 'erro preserva a revisão');

  r := public.wa_ai_review_knowledge_gap(f.org, f.agent, f.gap, f.reviewer, 'edit', version_before,
    f.dest, 'Pergunta nova?', 'pergunta nova', 'Nova', test_vector, 'modelo-teste', 'modelo-teste', 2);
  version_after := (r->'gap'->>'updated_at')::timestamptz;
  PERFORM pg_temp.check_result(version_after > version_before, 'nova versão após a edição');
  -- Dois editores partiram da mesma versão. O segundo chega à trava após o primeiro.
  r := public.wa_ai_review_knowledge_gap(f.org, f.agent, f.gap, f.reviewer, 'edit', version_before,
    f.doc, 'Pergunta antiga?', 'pergunta antiga', 'Ignorar');
  PERFORM pg_temp.check_result(r->>'code' = 'CONFLICT', 'edição com versão anterior');
  r := public.wa_ai_review_knowledge_gap(f.org, f.agent, f.gap, f.reviewer, 'remove', version_before);
  PERFORM pg_temp.check_result(r->>'code' = 'CONFLICT', 'remoção com versão anterior');
  PERFORM pg_temp.check_result((SELECT count(*) = 1 FROM public.wa_ai_agent_chunks WHERE gap_id = f.gap
    AND document_id = f.dest AND embedding_model = 'modelo-teste' AND embedding IS NOT NULL
    AND content = 'Pergunta: Pergunta nova?' || chr(10) || 'Resposta: Nova'), 'edição preserva um trecho fiel à revisão');
  PERFORM pg_temp.check_result((SELECT chunk_count = 1 FROM public.wa_ai_agent_documents WHERE id = f.doc)
    AND (SELECT chunk_count = 1 FROM public.wa_ai_agent_documents WHERE id = f.dest), 'contagens ao mover');

  UPDATE public.wa_ai_agent_documents SET status = 'processing' WHERE id = f.dest;
  r := public.wa_ai_review_knowledge_gap(f.org, f.agent, f.gap, f.reviewer, 'remove', version_after);
  PERFORM pg_temp.check_result(r->>'code' = 'DOCUMENT_NOT_READY', 'proteção durante reprocessamento');
  UPDATE public.wa_ai_agent_documents SET status = 'ready' WHERE id = f.dest;
  r := public.wa_ai_review_knowledge_gap(f.org, f.agent, f.gap, f.reviewer, 'remove', version_after);
  PERFORM pg_temp.check_result(r->'gap'->>'status' = 'ignored' AND r->'gap'->>'answer' = 'Nova'
    AND r->'gap'->>'document_id' IS NULL, 'remoção guarda a resposta');
  PERFORM pg_temp.check_result((SELECT count(*) = 0 FROM public.wa_ai_agent_chunks WHERE gap_id = f.gap)
    AND (SELECT chunk_count = 0 FROM public.wa_ai_agent_documents WHERE id = f.dest)
    AND (SELECT count(*) = 1 FROM public.wa_ai_agent_chunks WHERE content = 'Arquivo original'), 'remoção só do aprendizado');
END;
$test$;
ROLLBACK;
