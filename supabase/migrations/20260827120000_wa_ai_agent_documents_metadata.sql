-- =============================================================================
-- Base de conhecimento: metadados por documento (título, descrição, etiquetas).
-- Entram no cabeçalho de cada trecho na hora de vetorizar ("Documento: título. descrição
-- [etiquetas]" + trecho) e na lista de documentos que o agente enxerga no prompt.
-- Aditivo e idempotente. Sem esta migração o app continua funcionando; só a edição de
-- metadados devolve erro pedindo para rodá-la.
-- =============================================================================
ALTER TABLE public.wa_ai_agent_documents
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
