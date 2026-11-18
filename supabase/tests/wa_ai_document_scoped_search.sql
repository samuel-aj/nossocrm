-- Executar após as migrações em uma instância de teste com pgvector.
BEGIN;
DO $$
DECLARE
  org uuid := gen_random_uuid();
  other_org uuid := gen_random_uuid();
  agent uuid := gen_random_uuid();
  other_agent uuid := gen_random_uuid();
  doc uuid := gen_random_uuid();
  other_doc uuid := gen_random_uuid();
  probe vector(1536) := array_fill(1::real, ARRAY[1536])::vector;
  nearby vector(1536) := (array[0::real] || array_fill(1::real, ARRAY[1535]))::vector;
BEGIN
  INSERT INTO public.organizations(id, name) VALUES (org, 'Busca de teste'), (other_org, 'Outra organização');
  INSERT INTO public.wa_ai_agents(id, organization_id, name, provider, model)
    VALUES (agent, org, 'A', 'openai', 'test'), (other_agent, org, 'B', 'openai', 'test');
  INSERT INTO public.wa_ai_agent_documents(id, organization_id, agent_id, name, storage_path, status)
    VALUES (doc, org, agent, 'Produto', 'fixture/produto', 'ready'),
           (other_doc, org, agent, 'Outro produto', 'fixture/outro', 'ready');
  INSERT INTO public.wa_ai_agent_chunks(organization_id, agent_id, document_id, idx, content, embedding, embedding_model)
    VALUES (org, agent, doc, 0, 'O prazo consta na tabela de preços.', nearby, 'modelo'),
           (org, agent, doc, 1, 'A tabela de preços especial.', probe, 'outro-modelo'),
           (org, agent, other_doc, 0, 'preços preços preços preços preços', probe, 'modelo');

  ASSERT (SELECT document_id = doc AND idx = 0 FROM public.wa_ai_match_document_chunks(org, agent, doc, probe, 'modelo', 1)),
    'o melhor vetor global ou de outro modelo ocultou o trecho da base';
  ASSERT (SELECT count(*) = 1 AND bool_and(document_id = doc) FROM public.wa_ai_search_document_chunks(org, agent, doc, 'preços', 1)),
    'a base correta deve ser selecionada antes de limitar a busca por texto';
  ASSERT (SELECT idx = 0 FROM public.wa_ai_search_document_chunks(org, agent, doc, 'prazo inexistente', 1)),
    'reserva por palavra precisa funcionar dentro da mesma base';
  ASSERT NOT EXISTS (SELECT FROM public.wa_ai_search_document_chunks(other_org, agent, doc, 'preços')),
    'documento de outra organização';
  ASSERT NOT EXISTS (SELECT FROM public.wa_ai_match_document_chunks(org, other_agent, doc, probe, 'modelo')),
    'documento de outro agente';
  UPDATE public.wa_ai_agent_documents SET status = 'processing' WHERE id = doc;
  ASSERT NOT EXISTS (SELECT FROM public.wa_ai_search_document_chunks(org, agent, doc, 'preços')),
    'documento em processamento ou substituído por outro na busca por texto';
  ASSERT NOT EXISTS (SELECT FROM public.wa_ai_match_document_chunks(org, agent, doc, probe, 'modelo')),
    'documento em processamento ou substituído por outro na busca vetorial';
END;
$$;
ROLLBACK;
