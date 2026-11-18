-- Consultas configuradas no agente devem classificar apenas trechos do documento escolhido.
CREATE OR REPLACE FUNCTION public.wa_ai_match_document_chunks(
  p_org uuid, p_agent uuid, p_document uuid, p_embedding vector(1536), p_model text, p_limit integer DEFAULT 5
)
RETURNS TABLE (id uuid, document_id uuid, idx integer, content text, similarity double precision)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, extensions AS $$
  -- O índice HNSW global seleciona candidatos antes dos filtros. Aqui calculamos
  -- a distância exata apenas nos trechos do documento, sem perder correspondências.
  WITH candidates AS MATERIALIZED (
    SELECT c.id, c.document_id, c.idx, c.content, 1 - (c.embedding <=> p_embedding) AS similarity
    FROM public.wa_ai_agent_chunks c
    JOIN public.wa_ai_agent_documents d
      ON d.id = c.document_id AND d.organization_id = c.organization_id AND d.agent_id = c.agent_id
    WHERE c.organization_id = p_org AND c.agent_id = p_agent AND c.document_id = p_document
      AND d.status = 'ready' AND c.embedding IS NOT NULL AND c.embedding_model = p_model
  )
  SELECT * FROM candidates ORDER BY similarity DESC, idx
  LIMIT greatest(1, least(coalesce(p_limit, 5), 20));
$$;

CREATE OR REPLACE FUNCTION public.wa_ai_search_document_chunks(
  p_org uuid, p_agent uuid, p_document uuid, p_query text, p_limit integer DEFAULT 5
)
RETURNS TABLE (id uuid, document_id uuid, idx integer, content text, rank double precision)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, extensions AS $$
  WITH words AS (
    SELECT regexp_replace(word, '[^a-z0-9à-ú]', '', 'g') AS word
    FROM regexp_split_to_table(lower(coalesce(p_query, '')), '\s+') AS word
  ), terms AS (
    SELECT plainto_tsquery('portuguese', coalesce(p_query, '')) AS query,
           string_agg('\m' || word || '\M', '|') AS pattern
    FROM words WHERE length(word) >= 4
  ), matches AS (
    SELECT c.id, c.document_id, c.idx, c.content, c.tsv @@ t.query AS full_match,
           ts_rank(c.tsv, t.query)::double precision AS score
    FROM public.wa_ai_agent_chunks c
    JOIN public.wa_ai_agent_documents d
      ON d.id = c.document_id AND d.organization_id = c.organization_id AND d.agent_id = c.agent_id
    CROSS JOIN terms t
    WHERE c.organization_id = p_org AND c.agent_id = p_agent AND c.document_id = p_document
      AND d.status = 'ready' AND (c.tsv @@ t.query OR lower(c.content) ~ t.pattern)
  )
  SELECT id, document_id, idx, content, CASE WHEN full_match THEN score ELSE 0.1 END AS rank
  FROM matches
  WHERE full_match OR NOT EXISTS (SELECT 1 FROM matches WHERE full_match)
  ORDER BY rank DESC, idx
  LIMIT greatest(1, least(coalesce(p_limit, 5), 20));
$$;

REVOKE ALL ON FUNCTION public.wa_ai_match_document_chunks(uuid, uuid, uuid, vector, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wa_ai_search_document_chunks(uuid, uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_ai_match_document_chunks(uuid, uuid, uuid, vector, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.wa_ai_search_document_chunks(uuid, uuid, uuid, text, integer) TO service_role;
